"use client";

// OFFLINE TEST BACKEND. This fork replaces the Supabase `track` Edge Function
// with a localStorage-backed reimplementation of the same ops, so the whole
// group/session/debt flow can be exercised in a plain browser with no Telegram
// and no network. It mirrors supabase/functions/track/index.ts closely enough
// that the UI behaves the same. A dev toolbar (components/DevBar.tsx) switches
// the "logged-in" fake player, so seat-claiming and multi-user sessions are
// testable too. NOT part of the production app.

import { PayoutConfig, Transfer } from "./payout";

const SESSION_MS = 24 * 3600 * 1000;
const GAME_TYPES = ["sg4", "my3", "riichi"];
const NAME_MAX = 30;
const ROSTER_MAX = 12; // a group can hold more names than one table seats
const seatsFor = (mahjongType: string) => (mahjongType === "my3" ? 3 : 4);
// Fallback payout used only until a session picks its own — payouts are now set
// per session, not at group creation.
const DEFAULT_BASES: PayoutConfig = { tai: 0.4, zimo: 0.2, yao: 0.1, gang: 0.1, maxTai: 10 };
const DB_KEY = "mahjong-offline-db";
const UID_KEY = "mahjong-offline-uid";

// Fake players you can switch between via the dev toolbar.
export const OFFLINE_USERS = [
  { id: 1, first_name: "Alice", username: "alice" },
  { id: 2, first_name: "Bob", username: "bob" },
  { id: 3, first_name: "Cara", username: "cara" },
  { id: 4, first_name: "Dave", username: "dave" },
];

// A tracker's `players` is now the full ROSTER of names (placeholders + claimed),
// which can hold more names than a single table seats — each session records the
// 3-4 who actually played. A member's `name` is null until they claim a seat.
type Tracker = { id: string; code: string; game: string; name: string; players: string[]; bases: PayoutConfig; tg_chat_id: number | null; default_type: string; tai_scores?: Record<string, string> | null; created_at: string };
type Member = { tracker_id: string; user_id: number; name: string | null; created_at: string };
type Meta = Record<string, unknown> | null;
type Action = { id: string; tracker_id: string; session_id: string | null; actioner: string; summary: string; transfers: Transfer[]; meta: Meta; created_at: string };
type Session = { id: string; tracker_id: string; mahjong_type: string; players: string[]; bases: PayoutConfig | null; settle: boolean; name?: string | null; started_by: string | null; started_at: string; ended_at: string | null };
type Profile = { username: string; auto_sync: boolean; game_types: string[] | null; payout_presets: { name: string; cfg: PayoutConfig }[] };
type DB = { trackers: Tracker[]; members: Member[]; actions: Action[]; sessions: Session[]; profiles: Record<number, Profile> };

function load(): DB {
  if (typeof window === "undefined") return { trackers: [], members: [], actions: [], sessions: [], profiles: {} };
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch { /* corrupt -> reset */ }
  return { trackers: [], members: [], actions: [], sessions: [], profiles: {} };
}
function save(db: DB) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* quota */ } }

export function activeUserId(): number {
  if (typeof window === "undefined") return OFFLINE_USERS[0].id;
  const v = Number(localStorage.getItem(UID_KEY));
  return OFFLINE_USERS.some((u) => u.id === v) ? v : OFFLINE_USERS[0].id;
}
export function setActiveUser(id: number) { try { localStorage.setItem(UID_KEY, String(id)); } catch { /* ignore */ } }
export function resetOffline() { try { localStorage.removeItem(DB_KEY); } catch { /* ignore */ } }
function currentUser() { const id = activeUserId(); return OFFLINE_USERS.find((u) => u.id === id) || OFFLINE_USERS[0]; }

const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now());
const nowIso = () => new Date().toISOString();
function randomCode(n = 6): string {
  const alpha = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < n; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

function tgDisplayName(u: { first_name?: string; last_name?: string; username?: string }): string {
  const name = [u.first_name, u.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ").trim();
  if (name) return name.slice(0, NAME_MAX);
  const h = String(u.username ?? "").trim();
  return h ? h.slice(0, NAME_MAX) : "Player" + Math.floor(1000 + Math.random() * 9000);
}
function validName(s: unknown): boolean {
  const t = String(s ?? "").trim();
  if (t.length < 1 || t.length > NAME_MAX) return false;
  for (const ch of t) { const c = ch.codePointAt(0) ?? 0; if (c < 0x20 || c === 0x7f) return false; }
  return true;
}

const err = (msg: string) => { throw new Error(msg); };

function autoEndStale(db: DB, trackerId: string) {
  const cutoff = Date.now() - SESSION_MS;
  for (const s of db.sessions) {
    if (s.tracker_id === trackerId && !s.ended_at && new Date(s.started_at).getTime() < cutoff) s.ended_at = nowIso();
  }
}
const activeSession = (db: DB, trackerId: string): Session | null =>
  db.sessions.find((s) => s.tracker_id === trackerId && !s.ended_at) || null;

function seatInfo(db: DB, trackerId: string, uid: number) {
  const rows = db.members.filter((m) => m.tracker_id === trackerId);
  const mine = rows.find((r) => r.user_id === uid);
  return {
    me: mine?.name ?? null,                                   // your claimed seat (null = unseated)
    isMember: !!mine,                                         // you're in the group (may be unseated)
    claimedNames: rows.map((r) => r.name).filter((n): n is string => !!n),
  };
}

const isSettle = (a: Action) => !!a.meta && (a.meta as Record<string, unknown>).k === "settle";

function groupState(db: DB, tracker: Tracker, uid: number) {
  autoEndStale(db, tracker.id);
  const session = activeSession(db, tracker.id);
  const rows = db.actions.filter((a) => a.tracker_id === tracker.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const actions = session ? rows.filter((a) => a.session_id === session.id) : rows;
  // Two running totals over everything EXCEPT the live session (which is still
  // in play). `debts` = what's still OUTSTANDING (includes settlement payments,
  // so paying someone back zeroes it). `allTime` = career win/loss, which a
  // settlement must NOT move (repaying a debt isn't winning/losing a game).
  const debts: Record<string, number> = {};
  const allTime: Record<string, number> = {};
  for (const a of rows) {
    if (session && a.session_id === session.id) continue;
    const settle = isSettle(a);
    for (const t of a.transfers || []) {
      debts[t.payer] = (debts[t.payer] || 0) - t.amount;
      debts[t.payee] = (debts[t.payee] || 0) + t.amount;
      if (!settle) {
        allTime[t.payer] = (allTime[t.payer] || 0) - t.amount;
        allTime[t.payee] = (allTime[t.payee] || 0) + t.amount;
      }
    }
  }
  // Per session: GAME net (for the history display) and OUTSTANDING (games +
  // that session's own repayments — session-tagged settlements — for the $ tab's
  // per-session settle). Legacy null-session settlements sit in neither.
  const netBySession: Record<string, Record<string, number>> = {};
  const outBySession: Record<string, Record<string, number>> = {};
  for (const a of rows) {
    if (!a.session_id) continue;
    const ob = outBySession[a.session_id] || (outBySession[a.session_id] = {});
    for (const t of a.transfers || []) { ob[t.payer] = (ob[t.payer] || 0) - t.amount; ob[t.payee] = (ob[t.payee] || 0) + t.amount; }
    if (isSettle(a)) continue;
    const nb = netBySession[a.session_id] || (netBySession[a.session_id] = {});
    for (const t of a.transfers || []) { nb[t.payer] = (nb[t.payer] || 0) - t.amount; nb[t.payee] = (nb[t.payee] || 0) + t.amount; }
  }
  const games: Record<string, number> = {};
  const sessions = db.sessions
    .filter((s) => s.tracker_id === tracker.id)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .map((s) => {
      if (s.ended_at) for (const p of s.players || []) games[p] = (games[p] || 0) + 1;
      return { id: s.id, name: s.name ?? null, players: s.players || [], settle: s.settle, started_by: s.started_by, started_at: s.started_at, ended_at: s.ended_at, net: netBySession[s.id] || {}, outstanding: outBySession[s.id] || {} };
    });
  // A short audit trail of settlements so a repayment isn't invisible money.
  const settlements = rows
    .filter(isSettle)
    .map((a) => {
      const m = a.meta as Record<string, unknown>;
      const tr = (a.transfers || [])[0];
      return { from: String(m.from ?? ""), to: String(m.to ?? ""), amount: tr ? tr.amount : 0, at: a.created_at };
    })
    .slice(-10)
    .reverse();
  const info = seatInfo(db, tracker.id, uid);
  return { tracker, actions, session, debts, allTime, games, sessions, settlements, me: info.me, isMember: info.isMember, claimedNames: info.claimedNames };
}

// Greedy who-owes-who from net balances (mirrors the track function).
function settleUpPairs(net: Record<string, number>): Array<{ from: string; to: string; amount: number }> {
  const EPS = 0.004;
  const debtors = Object.entries(net).filter(([, v]) => v < -EPS).map(([n, v]) => ({ n, v: -v })).sort((a, b) => b.v - a.v);
  const creditors = Object.entries(net).filter(([, v]) => v > EPS).map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v);
  const out: Array<{ from: string; to: string; amount: number }> = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].v, creditors[j].v);
    out.push({ from: debtors[i].n, to: creditors[j].n, amount: pay });
    debtors[i].v -= pay; creditors[j].v -= pay;
    if (debtors[i].v <= EPS) i++;
    if (creditors[j].v <= EPS) j++;
  }
  return out;
}

// The one entry point remote.ts calls in offline mode. Throws Error(message) on
// failure (remote's call() surfaces the message just like a failed fetch).
export async function localCall<T>(op: string, payload: Record<string, unknown>): Promise<T> {
  const db = load();
  const user = currentUser();
  const uid = user.id;
  const actioner = user.first_name;
  const out = (v: unknown): T => { save(db); return v as T; };

  if (op === "me") {
    const p = db.profiles[uid];
    const tgName = tgDisplayName(user);
    if (!p) return out({ profile: null, suggested: tgName, hasHandle: true });
    if (p.auto_sync && tgName && tgName !== p.username) p.username = tgName;
    return out({ profile: { username: p.username, gameTypes: p.game_types ?? null, presets: p.payout_presets ?? [] }, suggested: p.username, hasHandle: true });
  }

  if (op === "set-username") {
    const raw = String(payload.username || "").trim();
    if (!validName(raw)) err(`name must be 1-${NAME_MAX} characters`);
    const existing = db.profiles[uid];
    const prof: Profile = existing || { username: raw, auto_sync: true, game_types: null, payout_presets: [] };
    prof.username = raw;
    prof.auto_sync = raw === tgDisplayName(user);
    db.profiles[uid] = prof;
    return out({ profile: { username: raw, gameTypes: prof.game_types ?? null, presets: prof.payout_presets ?? [] } });
  }

  if (op === "set-prefs") {
    const p = db.profiles[uid];
    if (!p) err("set your name first");
    const raw = payload.gameTypes;
    const types = [...new Set((Array.isArray(raw) ? raw : []).map(String).filter((t) => GAME_TYPES.includes(t)))];
    if (!types.length) err("pick at least one game type");
    p!.game_types = types;
    return out({ gameTypes: types });
  }

  if (op === "save-preset") {
    const p = db.profiles[uid];
    if (!p) err("set your name first");
    const name = String(payload.name || "").trim().slice(0, 30);
    const cfg = payload.cfg;
    if (!name) err("give the preset a name");
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) err("bad preset values");
    const list = (p!.payout_presets || []).filter((x) => x && x.name !== name);
    p!.payout_presets = [...list, { name, cfg: cfg as PayoutConfig }].slice(-20);
    return out({ presets: p!.payout_presets });
  }

  if (op === "create") {
    // A group now starts as just a name + share code with an EMPTY roster.
    // Names (placeholders) are added afterwards; payouts are chosen per session.
    const name = String(payload.name || "").trim().slice(0, NAME_MAX) || "Mahjong";
    if (!validName(name)) err(`name must be 1-${NAME_MAX} characters, no control characters`);
    const dtype = payload.defaultType === "my3" ? "my3" : "sg4";
    let code = randomCode();
    while (db.trackers.some((t) => t.code === code)) code = randomCode();
    const tracker: Tracker = { id: uuid(), code, game: "sg", name, players: [], bases: DEFAULT_BASES, tg_chat_id: null, default_type: dtype, created_at: nowIso() };
    db.trackers.push(tracker);
    // The creator joins the group immediately (unseated) so it's "theirs" and
    // they can add names / start a session without first claiming a seat.
    db.members.push({ tracker_id: tracker.id, user_id: uid, name: null, created_at: nowIso() });
    return out(groupState(db, tracker, uid));
  }

  if (op === "my-groups") {
    const mine = db.members.filter((m) => m.user_id === uid);
    const groups = mine.map((m) => {
      const t = db.trackers.find((x) => x.id === m.tracker_id);
      if (!t) return null; // a group can be empty (no names yet) and still be yours
      const acts = db.actions.filter((a) => a.tracker_id === t.id);
      const net: Record<string, number> = {};
      let last = "";
      for (const a of acts) {
        for (const tr of a.transfers || []) { net[tr.payer] = (net[tr.payer] || 0) - tr.amount; net[tr.payee] = (net[tr.payee] || 0) + tr.amount; }
        if (a.created_at > last) last = a.created_at;
      }
      const s = activeSession(db, t.id);
      const live = !!s && new Date(s.started_at).getTime() >= Date.now() - SESSION_MS;
      return { code: t.code, name: t.name, players: t.players.length, myName: m.name, myNet: m.name ? (net[m.name] || 0) : 0, lastActivity: last, hasActive: live };
    }).filter(Boolean).sort((a, b) => (b!.lastActivity || "").localeCompare(a!.lastActivity || ""));
    return out({ groups });
  }

  if (op === "list-by-chat") return out({ groups: [] }); // no Telegram chat binding offline

  const byCode = (): Tracker => {
    const code = String(payload.code || "").toUpperCase();
    const t = db.trackers.find((x) => x.code === code);
    if (!t) err("group not found");
    return t!;
  };

  if (op === "open") {
    const tracker = byCode();
    // Opening a group's link puts you in it (unseated) so you can add names,
    // claim a seat, or start a session.
    if (!db.members.some((m) => m.tracker_id === tracker.id && m.user_id === uid)) {
      db.members.push({ tracker_id: tracker.id, user_id: uid, name: null, created_at: nowIso() });
    }
    return out(groupState(db, tracker, uid));
  }

  if (op === "add-name") {
    // Anyone in the group can add a placeholder name (not linked to any account).
    const tracker = byCode();
    if (!db.members.some((m) => m.tracker_id === tracker.id && m.user_id === uid)) err("join the group first");
    const raw = String(payload.name || "").trim();
    if (!validName(raw)) err(`name must be 1-${NAME_MAX} characters`);
    if (tracker.players.includes(raw)) err("that name is already in the group");
    if (tracker.players.length >= ROSTER_MAX) err(`this group already has ${ROSTER_MAX} names`);
    tracker.players = [...tracker.players, raw];
    return out(groupState(db, tracker, uid));
  }

  if (op === "claim" || op === "join-new") {
    // Take a seat: an existing placeholder name (claim) or a brand-new one
    // (join-new). If you're already an unseated member, this fills your seat.
    const tracker = byCode();
    const mine = db.members.find((m) => m.tracker_id === tracker.id && m.user_id === uid);
    if (mine && mine.name) err("you already have a seat in this group");
    let seat: string;
    if (op === "claim") {
      seat = String(payload.player || "");
      if (!tracker.players.includes(seat)) err("no such player");
      if (db.members.some((m) => m.tracker_id === tracker.id && m.name === seat)) err("that name is already taken");
    } else {
      seat = String(payload.name || "").trim();
      if (!validName(seat)) err(`name must be 1-${NAME_MAX} characters`);
      if (tracker.players.includes(seat)) err("that name is already in the group");
      if (tracker.players.length >= ROSTER_MAX) err(`this group already has ${ROSTER_MAX} names`);
      tracker.players = [...tracker.players, seat];
    }
    if (mine) mine.name = seat;
    else db.members.push({ tracker_id: tracker.id, user_id: uid, name: seat, created_at: nowIso() });
    return out(groupState(db, tracker, uid));
  }

  if (op === "start-session" || op === "end-session") {
    const tracker = byCode();
    const info = seatInfo(db, tracker.id, uid);
    if (!info.isMember) err("join the group first");
    if (op === "start-session") {
      autoEndStale(db, tracker.id);
      const mt = String(payload.mahjongType || tracker.default_type || "sg4");
      if (mt !== "sg4" && mt !== "my3") err("unknown mahjong type");
      // A session records exactly the 3-4 roster names actually playing it.
      const need = seatsFor(mt);
      const players = [...new Set((Array.isArray(payload.players) ? payload.players : []).map(String))];
      if (players.length !== need) err(`pick exactly ${need} players`);
      const roster = new Set(tracker.players);
      if (players.some((p) => !roster.has(p))) err("a chosen player isn't in the group");
      const settle = payload.settle !== false;
      if (activeSession(db, tracker.id)) err("a session is already running");
      const sName = String(payload.name || "").trim().slice(0, 40) || null;
      db.sessions.push({ id: uuid(), tracker_id: tracker.id, mahjong_type: mt, players, bases: settle ? ((payload.bases as PayoutConfig) ?? tracker.bases) : null, settle, name: sName, started_by: info.me ?? actioner, started_at: nowIso(), ended_at: null });
    } else {
      const s = activeSession(db, tracker.id);
      if (!s) err("no active session");
      s!.ended_at = nowIso();
    }
    return out(groupState(db, tracker, uid));
  }

  if (op === "rename-seat") {
    const tracker = byCode();
    const newName = String(payload.name || "").trim();
    if (!newName) err("name required");
    const mem = db.members.find((m) => m.tracker_id === tracker.id && m.user_id === uid);
    const oldName = mem?.name ?? null;
    if (!oldName) err("you haven't joined this group");
    if (oldName !== newName) {
      if (tracker.players.includes(newName)) err("that name is taken in this group");
      mem!.name = newName;
      tracker.players = tracker.players.map((p) => (p === oldName ? newName : p));
      for (const a of db.actions.filter((x) => x.tracker_id === tracker.id)) {
        a.transfers = (a.transfers || []).map((t) => ({
          ...t,
          payer: t.payer === oldName ? newName : t.payer,
          payee: t.payee === oldName ? newName : t.payee,
        }));
        if (a.meta) {
          const m = a.meta as Record<string, unknown>;
          // 'from'/'to' = settlement labels, so the Settled-up list follows renames.
          for (const k of ["winner", "discarder", "konger", "payer", "biter", "target", "from", "to"]) {
            if (m[k] === oldName) m[k] = newName;
          }
        }
      }
      // A rename mid-session must follow into the session's playing list too.
      for (const s of db.sessions.filter((x) => x.tracker_id === tracker.id)) {
        s.players = (s.players || []).map((p) => (p === oldName ? newName : p));
        if (s.started_by === oldName) s.started_by = newName;
      }
    }
    return out(groupState(db, tracker, uid));
  }

  if (op === "settle") {
    // Record that a real-life repayment cleared (part of) a debt. It's a normal
    // action with a REVERSE transfer (creditor -> debtor) tagged meta.k="settle",
    // so it nets out of the debt counter but is skipped by the all-time tally.
    // Only a party to the debt may record it, and never for more than is owed.
    const tracker = byCode();
    const info = seatInfo(db, tracker.id, uid);
    if (!info.isMember) err("join the group first");
    const from = String(payload.from || "");   // the debtor (owes money)
    const to = String(payload.to || "");        // the creditor (is owed money)
    const amount = Number(payload.amount);
    const sessionId = String(payload.sessionId || ""); // which session's debt (per-session settle)
    if (!from || !to || from === to) err("bad settlement");
    if (info.me !== from && info.me !== to) err("you can only settle a debt you're part of");
    if (!(amount > 0)) err("amount must be positive");
    // Outstanding net to clamp against. Per-session (sessionId given): only that
    // ended session's rows. Legacy fallback (no sessionId): every ended session's,
    // excluding the live one. The repayment carries session_id so deleting the
    // session later removes it cleanly.
    const live = activeSession(db, tracker.id);
    if (sessionId) {
      const sess = db.sessions.find((x) => x.id === sessionId && x.tracker_id === tracker.id);
      if (!sess) err("session not found");
      if (!sess!.ended_at) err("end the session before settling it");
    }
    const net: Record<string, number> = {};
    for (const a of db.actions.filter((x) => x.tracker_id === tracker.id)) {
      if (sessionId ? a.session_id !== sessionId : !!(live && a.session_id === live.id)) continue;
      for (const t of a.transfers || []) { net[t.payer] = (net[t.payer] || 0) - t.amount; net[t.payee] = (net[t.payee] || 0) + t.amount; }
    }
    const cap = Math.min(-(net[from] || 0), net[to] || 0); // how much `from` owes AND `to` is owed
    if (cap <= 0.004) err("nothing outstanding between them");
    const amt = Math.min(amount, cap);
    db.actions.push({
      id: uuid(), tracker_id: tracker.id, session_id: sessionId || null, actioner,
      summary: `${from} settled up with ${to} (${amt.toFixed(2)})`,
      transfers: [{ payer: to, payee: from, amount: amt }],
      meta: { k: "settle", from, to }, created_at: nowIso(),
    });
    return out(groupState(db, tracker, uid));
  }

  if (op === "rename-group") {
    const tracker = byCode();
    const info = seatInfo(db, tracker.id, uid);
    if (!info.isMember) err("join the group first");
    const newName = String(payload.name || "").trim();
    if (!validName(newName)) err(`name must be 1-${NAME_MAX} characters, no control characters`);
    tracker.name = newName;
    return out(groupState(db, tracker, uid));
  }

  if (op === "remove-player") {
    const tracker = byCode();
    const info = seatInfo(db, tracker.id, uid);
    if (!info.isMember) err("join the group first");
    const target = String(payload.name || "").trim();
    if (!target) err("name required");
    if (!tracker.players.includes(target)) err("no such player");
    const active = activeSession(db, tracker.id);
    if (active && (active.players || []).includes(target)) err(`${target} is in the running session — end it first`);
    const st = groupState(db, tracker, uid);
    const net = (st.debts as Record<string, number>)[target] || 0;
    if (Math.abs(net) > 0.004) err(`settle ${target}'s balance first — they're ${net > 0 ? "owed" : "owing"} money`);
    tracker.players = tracker.players.filter((p) => p !== target);
    db.members = db.members.filter((m) => !(m.tracker_id === tracker.id && m.name === target));
    return out(groupState(db, tracker, uid));
  }

  if (op === "delete-session") {
    const tracker = byCode();
    const info = seatInfo(db, tracker.id, uid);
    if (!info.isMember) err("join the group first");
    if (!info.me) err("claim a seat in the group first");
    const sid = String(payload.sessionId || "");
    if (!sid) err("session required");
    const s = db.sessions.find((x) => x.id === sid && x.tracker_id === tracker.id);
    if (!s) err("session not found");
    if (!s!.ended_at) {
      // active session: cancel it (its actions never reached the debt counter)
      db.actions = db.actions.filter((a) => !(a.tracker_id === tracker.id && a.session_id === sid));
    } else {
      // ended: allow once THIS session is squared up (its games + its own
      // repayments net to zero), OR the whole group is square (legacy fallback for
      // pre-0008 aggregate repayments). Then delete every row tagged with this
      // session — games AND its own repayments together (both carry session_id) —
      // so nothing is orphaned. Never touches other sessions' or legacy
      // session-agnostic rows. Mirror of the server op.
      const st = groupState(db, tracker, uid);
      const sess = st.sessions.find((x) => x.id === sid);
      const sessOwed = Object.values((sess?.outstanding || {}) as Record<string, number>).some((v) => Math.abs(v) > 0.004);
      const groupOwed = Object.values(st.debts as Record<string, number>).some((v) => Math.abs(v) > 0.004);
      if (sessOwed && groupOwed) err("settle this session's debts first — it can only be deleted once its money is squared up");
      db.actions = db.actions.filter((a) => !(a.tracker_id === tracker.id && a.session_id === sid));
    }
    db.sessions = db.sessions.filter((x) => x.id !== sid);
    return out(groupState(db, tracker, uid));
  }

  if (op === "settle-all") {
    const tracker = byCode();
    const info = seatInfo(db, tracker.id, uid);
    if (!info.isMember) err("join the group first");
    if (!info.me) err("claim a seat in the group first");
    const st = groupState(db, tracker, uid);
    for (const p of settleUpPairs(st.debts as Record<string, number>)) {
      db.actions.push({
        id: uuid(), tracker_id: tracker.id, session_id: null, actioner,
        summary: `${p.from} settled up with ${p.to} (${p.amount.toFixed(2)})`,
        transfers: [{ payer: p.to, payee: p.from, amount: p.amount }],
        meta: { k: "settle", from: p.from, to: p.to }, created_at: nowIso(),
      });
    }
    return out(groupState(db, tracker, uid));
  }

  if (op === "announce") {
    // No Telegram in offline mode — succeed as a no-op.
    const tracker = byCode();
    return out(groupState(db, tracker, uid));
  }

  if (op === "set-tai") {
    // Save this group's winning-hand tai scoring (shared by all members),
    // mirroring the track function's set-tai op.
    const tracker = byCode();
    const info = seatInfo(db, tracker.id, uid);
    if (!info.isMember) err("join the group first");
    const raw = payload.scores;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) err("bad scoring values");
    const scores: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 64)) {
      if (typeof k === "string" && k.length && k.length <= 40) scores[k] = String(v).slice(0, 8);
    }
    tracker.tai_scores = scores;
    return out(groupState(db, tracker, uid));
  }

  if (op === "state" || op === "action") {
    const tracker = byCode();
    if (op === "action") {
      const summary = String(payload.summary || "");
      const transfers = (payload.transfers as Transfer[]) || [];
      if (!summary || !Array.isArray(transfers)) err("summary + transfers required");
      autoEndStale(db, tracker.id);
      const session = activeSession(db, tracker.id);
      // Money only moves among the session's chosen players (fallback: roster).
      const playing = new Set(session?.players?.length ? session.players : tracker.players);
      const stale = transfers.flatMap((t) => [t.payer, t.payee]).find((n) => n && !playing.has(n));
      if (stale) err("players changed — refresh and try again");
      const claimedSid = String(payload.sessionId || "");
      if (claimedSid && (!session || session.id !== claimedSid)) err("the session changed — refresh and try again");
      const tx = session && session.settle === false ? [] : transfers;
      db.actions.push({ id: uuid(), tracker_id: tracker.id, session_id: session?.id ?? null, actioner, summary, transfers: tx, meta: (payload.meta as Meta) ?? null, created_at: nowIso() });
    }
    return out(groupState(db, tracker, uid));
  }

  err(`unknown op: ${op}`);
  return undefined as unknown as T;
}
