"use client";

// Client layer for the group-synced tracker. All calls go to the Supabase
// `track` Edge Function, which validates Telegram initData server-side.

import { Transfer, PayoutConfig } from "./payout";

const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL || "";

export interface Tracker {
  id: string;
  code: string;
  game: string;
  name: string;
  players: string[];
  bases: PayoutConfig;
  default_type?: string; // what this group usually plays ('sg4' | 'my3')
}

// One sitting at the table. Money tallies per session; ended sessions feed the
// group's running debt counter. Auto-ends 24h after start (server-enforced).
export interface Session {
  id: string;
  mahjong_type: string;              // 'sg4' | 'my3' (my3 = WIP)
  players: string[];                 // the 3-4 roster names actually playing this sitting
  bases: PayoutConfig | null;
  settle: boolean;                   // false = "ownself settle" (no payout tracking)
  started_by?: string | null;
  started_at: string;
  ended_at?: string | null;
}

// Structured action so the log can render CURRENT seat names (rename rewrites
// the role fields in meta). `summary` stays as a fallback for pre-meta rows.
export type ActionMeta =
  | { k: "hu"; tai: number; winner: string; discarder: string }
  | { k: "zimo"; tai: number; winner: string }
  // mode: "zimo" = drawn/added kong (everyone pays), "shoot" = kong off a
  // discard (that one person pays the full 3x), "an" = concealed (everyone
  // pays double). Optional so pre-existing rows still parse.
  | { k: "gang"; konger: string; payer: string | null; mode?: "zimo" | "shoot" | "an" }
  // concealed = anyao (bite paid at double). Optional for back-compat.
  | { k: "yao"; biter: string; target: string | null; concealed?: boolean };

export interface RemoteAction {
  id: string;
  actioner: string;
  summary: string;
  transfers: Transfer[];
  meta?: ActionMeta | null;
  created_at: string;
}

export interface TrackerState {
  tracker: Tracker;
  actions: RemoteAction[];   // the ACTIVE session's actions ([] when no session)
  session?: Session | null;  // the active session, if one is running
  debts?: Record<string, number>; // net per player from everything already ended
  me?: string | null;        // the seat THIS account claimed (null = in the group but unseated)
  isMember?: boolean;        // you're in the group (opened its link), seated or not
  claimedNames?: string[];   // seats already taken (so the roster can hide them)
}

export const syncEnabled = () => Boolean(TRACK_URL);

function initData(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initData || "";
}

async function call<T>(op: string, payload: Record<string, unknown>): Promise<T> {
  if (!TRACK_URL) throw new Error("Sync isn't configured (NEXT_PUBLIC_TRACK_URL not set).");
  const res = await fetch(TRACK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, initData: initData(), ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `request failed (${res.status})`);
  return data as T;
}

export interface GroupSummary {
  code: string;
  name: string;
  players: number;
  myName?: string | null;    // your seat in this group
  myNet?: number;            // your net balance there (all sessions)
  lastActivity?: string;     // ISO time of the last recorded action
  hasActive?: boolean;       // a session is currently running
}

// The mahjong types the app knows about (first-run checklist / home dropdown).
// Keep in sync with GAME_TYPES in supabase/functions/track/index.ts.
export type GameType = "sg4" | "my3" | "riichi";
export const GAME_TYPES: { v: GameType; label: string; wip?: boolean }[] = [
  { v: "sg4", label: "Singaporean (4 player)" },
  { v: "my3", label: "Malaysian (3 player)", wip: true },
  { v: "riichi", label: "Riichi (hand calculator)" },
];

export interface PayoutPreset {
  name: string;
  cfg: PayoutConfig;
}

/** Built-in payout schemes offered in the scheme dropdowns (group setup +
 *  session start), before the account's own saved presets. */
export const BUILTIN_PRESETS: PayoutPreset[] = [
  { name: "10¢/20¢", cfg: { tai: 0.4, zimo: 0.2, yao: 0.1, gang: 0.1, maxTai: 10 } },
  { name: "20¢/40¢", cfg: { tai: 0.8, zimo: 0.4, yao: 0.2, gang: 0.2, maxTai: 10 } },
  // 30¢/60¢ is an irregular house table (tai 1-3 are rounded, not pure
  // doubling), so store the exact per-tai amounts. tai/zimo are the row-1 bases.
  { name: "30¢/60¢", cfg: {
      tai: 4, zimo: 2, yao: 2, gang: 3, maxTai: 10,
      zimoTable: [2, 3, 5, 10, 20, 40, 80, 160, 320, 640],
      discardTable: [4, 7, 11, 20, 40, 80, 160, 320, 640, 1280],
    } },
  { name: "50¢/$1", cfg: { tai: 4, zimo: 2, yao: 3, gang: 3, maxTai: 10 } },
  { name: "$1/$2", cfg: { tai: 8, zimo: 4, yao: 5, gang: 5, maxTai: 10 } },
];

export interface Profile {
  username: string;              // display name (the DB column is still `username`; not unique)
  gameTypes?: GameType[] | null; // null = first-run checklist not done yet
  presets?: PayoutPreset[];      // saved payout presets
}

/** The one client-side copy of the display-name rule (the server enforces the
 *  same — keep in sync with validName in supabase/functions/track/index.ts).
 *  A display name is any 1-30 char label with no control characters. */
export const NAME_MAX = 30;
export const NAME_HINT = "1–30 characters.";
export function validDisplayName(s: string): boolean {
  const t = s.trim();
  if (t.length < 1 || t.length > NAME_MAX) return false;
  for (const ch of t) { const c = ch.codePointAt(0) ?? 0; if (c < 0x20 || c === 0x7f) return false; }
  return true;
}

/** This account's global username (null on first ever use) + an available
 *  suggestion to pre-fill the "pick a username" gate. `hasHandle` is false when
 *  the account has no Telegram @username (so the UI asks them to make one). */
export const getMe = () =>
  call<{ profile: Profile | null; suggested: string; hasHandle?: boolean }>("me", {});

/** Set this account's display name (not unique — op name kept for wire compat). */
export const setDisplayName = (username: string) => call<{ profile: Profile }>("set-username", { username });

/** Save which mahjong types this account plays (first-run checklist / settings). */
export const setPrefs = (gameTypes: GameType[]) => call<{ gameTypes: GameType[] }>("set-prefs", { gameTypes });

/** Save (or overwrite by name) a payout preset on this account. */
export const savePreset = (name: string, cfg: PayoutConfig) =>
  call<{ presets: PayoutPreset[] }>("save-preset", { name, cfg });

/** Start a session in a group (409 if one is already running). `players` is the
 *  subset of the roster actually playing this sitting (4 for sg4, 3 for my3). */
export const startSession = (code: string, opts: { mahjongType: string; players: string[]; settle: boolean; bases?: PayoutConfig }) =>
  call<TrackerState>("start-session", { code, ...opts });

/** End the group's active session; its actions freeze into the debt counter. */
export const endSession = (code: string) => call<TrackerState>("end-session", { code });

/** Rename your own seat in a group (your per-group display name). Rewrites the
 *  roster + past transfers server-side so balances stay correct. Throws "that
 *  name is taken in this group" (409) if another seat already uses it. */
export const renameSeat = (code: string, name: string) => call<TrackerState>("rename-seat", { code, name });

/** Create a group. It starts with an empty roster and a share code; names and
 *  payouts are added afterwards (names on the group page, payouts per session).
 *  If `tgChatId` is set (launched from a Telegram group), the group is bound to
 *  it and the bot posts a join button. `defaultType` = the usual mahjong type. */
export const createTracker = (name: string, tgChatId?: number, defaultType?: GameType) =>
  call<TrackerState>("create", { name, tgChatId, defaultType });

/** Groups bound to a Telegram group (so members can see + join them). */
export const listByChat = (tgChatId: number) =>
  call<{ groups: GroupSummary[] }>("list-by-chat", { tgChatId });

/** Open a group by code: this JOINS you to the group (unseated) and returns its
 *  state — the roster, whether you've claimed a seat (me), and which seats are
 *  taken (claimedNames). Claiming a seat / adding names happens on the group page. */
export const openGroup = (code: string) => call<TrackerState>("open", { code });

/** Add a placeholder name (a seat linked to no account) to the group roster.
 *  Anyone already in the group can do this. */
export const addName = (code: string, name: string) => call<TrackerState>("add-name", { code, name });

/** Take over an existing (unclaimed) player seat — links your account to it. */
export const claimSeat = (code: string, player: string) => call<TrackerState>("claim", { code, player });

/** Join as a brand-new player named `name` (adds it to the roster and claims it). */
export const joinNew = (code: string, name: string) => call<TrackerState>("join-new", { code, name });

/** Every group this Telegram account belongs to (any device). */
export const myGroups = () => call<{ groups: GroupSummary[] }>("my-groups", {});

export const getState = (code: string) => call<TrackerState>("state", { code });

/** Record an action. `sessionId` echoes the session the money was computed
 *  against — the server 409s if it changed, so amounts computed under old
 *  rules can never land in a different session. */
export const addRemoteAction = (code: string, summary: string, transfers: Transfer[], meta?: ActionMeta, sessionId?: string) =>
  call<TrackerState>("action", { code, summary, transfers, meta, sessionId });

/** Parse the launch deep-link param Telegram passes via ?startapp=<x>:
 *  - `g<chatId>` (lowercase g) → opened from a Telegram group; returns its id.
 *  - a 6-char code → a direct group-join link.
 *  - nothing → opened from a private chat / menu button. */
export function parseStartParam(): { tgChatId?: number; code?: string } {
  if (typeof window === "undefined") return {};
  const raw = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (!raw) return {};
  if (/^g-?\d+$/.test(raw)) return { tgChatId: parseInt(raw.slice(1), 10) };
  return { code: String(raw).toUpperCase() };
}

// "Your groups" cache — instant paint before the server responds. Keyed PER
// TELEGRAM ACCOUNT so two accounts on the same phone/browser never share it.
function cacheKey(): string {
  const uid =
    typeof window !== "undefined" ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id : undefined;
  return `mahjong-groups:${uid ?? "anon"}`;
}
export function localGroups(): GroupSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey()) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function rememberGroup(g: GroupSummary): void {
  if (typeof window === "undefined") return;
  const list = [g, ...localGroups().filter((x) => x.code !== g.code)].slice(0, 50);
  localStorage.setItem(cacheKey(), JSON.stringify(list));
}
export function forgetGroup(code: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(cacheKey(), JSON.stringify(localGroups().filter((x) => x.code !== code)));
}
/** Replace the cached group list (e.g. with the account's server-side groups). */
export function setLocalGroups(list: GroupSummary[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(cacheKey(), JSON.stringify(list.slice(0, 50)));
}

// Per-chat "last opened group" memory: so re-launching the app from a Telegram
// group chat jumps straight back into the group opened there last. Keyed per
// account + per chat; on-device only (a convenience — the chat<->group binding
// on the server is the source of truth).
function chatLastKey(cid: number): string {
  const uid =
    typeof window !== "undefined" ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id : undefined;
  return `mahjong-lastgroup:${uid ?? "anon"}:${cid}`;
}
export function lastGroupForChat(cid: number): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(chatLastKey(cid)) || null; } catch { return null; }
}
export function rememberGroupForChat(cid: number, code: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(chatLastKey(cid), code); } catch { /* ignore */ }
}

/** Bot username for building shareable deep links. Override via env if needed. */
export const BOT_APP_LINK = process.env.NEXT_PUBLIC_BOT_APP_LINK || "https://t.me/jpgmahjongbot/jpg";
