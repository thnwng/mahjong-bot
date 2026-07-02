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
  | { k: "gang"; konger: string; payer: string | null }
  | { k: "yao"; biter: string; target: string | null };

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
  me?: string | null;        // the player seat THIS account has claimed (null = not joined yet)
  claimedNames?: string[];   // seats already taken (so the join screen can hide them)
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

export interface Profile {
  username: string;
  gameTypes?: GameType[] | null; // null = first-run checklist not done yet
  presets?: PayoutPreset[];      // saved payout presets
}

/** The one client-side copy of the username rule (the server enforces the same
 *  regex — keep in sync with USERNAME_RE in supabase/functions/track/index.ts). */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const USERNAME_HINT = "3–20 letters, numbers or underscores.";

/** This account's global username (null on first ever use) + an available
 *  suggestion to pre-fill the "pick a username" gate. `hasHandle` is false when
 *  the account has no Telegram @username (so the UI asks them to make one). */
export const getMe = () =>
  call<{ profile: Profile | null; suggested: string; hasHandle?: boolean }>("me", {});

/** Claim or change this account's unique username. Throws "that username is
 *  taken" (409) if another account already has it. */
export const setUsername = (username: string) => call<{ profile: Profile }>("set-username", { username });

/** Save which mahjong types this account plays (first-run checklist / settings). */
export const setPrefs = (gameTypes: GameType[]) => call<{ gameTypes: GameType[] }>("set-prefs", { gameTypes });

/** Save (or overwrite by name) a payout preset on this account. */
export const savePreset = (name: string, cfg: PayoutConfig) =>
  call<{ presets: PayoutPreset[] }>("save-preset", { name, cfg });

/** Start a session in a group (409 if one is already running). */
export const startSession = (code: string, opts: { mahjongType: string; settle: boolean; bases?: PayoutConfig }) =>
  call<TrackerState>("start-session", { code, ...opts });

/** End the group's active session; its actions freeze into the debt counter. */
export const endSession = (code: string) => call<TrackerState>("end-session", { code });

/** Rename your own seat in a group (your per-group display name). Rewrites the
 *  roster + past transfers server-side so balances stay correct. Throws "that
 *  name is taken in this group" (409) if another seat already uses it. */
export const renameSeat = (code: string, name: string) => call<TrackerState>("rename-seat", { code, name });

/** Create a group. If `tgChatId` is set (launched from a Telegram group), the
 *  group is bound to it and the bot posts a join button into that chat.
 *  `defaultType` = what the group usually plays (prefills each session). */
export const createTracker = (name: string, players: string[], bases: Tracker["bases"], tgChatId?: number, defaultType?: GameType) =>
  call<TrackerState>("create", { name, players, bases, tgChatId, defaultType });

/** Groups bound to a Telegram group (so members can see + join them). */
export const listByChat = (tgChatId: number) =>
  call<{ groups: GroupSummary[] }>("list-by-chat", { tgChatId });

/** Look at a group: returns whether you've claimed a seat (me) and which seats
 *  are taken (claimedNames). Does NOT join you — claiming a seat does that. */
export const openGroup = (code: string) => call<TrackerState>("open", { code });

/** Take over an existing (unclaimed) player seat — links your account to it. */
export const claimSeat = (code: string, player: string) => call<TrackerState>("claim", { code, player });

/** Join as a brand-new player named `name`. */
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
