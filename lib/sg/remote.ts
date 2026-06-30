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
}

export interface RemoteAction {
  id: string;
  actioner: string;
  summary: string;
  transfers: Transfer[];
  created_at: string;
}

export interface TrackerState {
  tracker: Tracker;
  actions: RemoteAction[];
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
}

/** Create a group. If `tgChatId` is set (launched from a Telegram group), the
 *  group is bound to it and the bot posts a join button into that chat. */
export const createTracker = (name: string, players: string[], bases: Tracker["bases"], tgChatId?: number) =>
  call<TrackerState>("create", { name, players, bases, tgChatId });

/** Groups bound to a Telegram group (so members can see + join them). */
export const listByChat = (tgChatId: number) =>
  call<{ groups: GroupSummary[] }>("list-by-chat", { tgChatId });

/** Open a group AND record this account as a member (follows you across
 *  devices). Use when entering a group; polling uses getState (read-only). */
export const openGroup = (code: string) => call<TrackerState>("open", { code });

/** Every group this Telegram account belongs to (any device). */
export const myGroups = () => call<{ groups: GroupSummary[] }>("my-groups", {});

/** Fill in a bot-created group stub (code already exists, players still empty). */
export const setupGroup = (code: string, name: string, players: string[], bases: Tracker["bases"]) =>
  call<TrackerState>("setup-group", { code, name, players, bases });

export const getState = (code: string) => call<TrackerState>("state", { code });

export const addRemoteAction = (code: string, summary: string, transfers: Transfer[]) =>
  call<TrackerState>("action", { code, summary, transfers });

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

/** Bot username for building shareable deep links. Override via env if needed. */
export const BOT_APP_LINK = process.env.NEXT_PUBLIC_BOT_APP_LINK || "https://t.me/jpgmahjongbot/jpg";
