// Supabase Edge Function: group-synced mahjong trackers.
// Deploys automatically from git via .github/workflows/deploy-functions.yml
// (verify_jwt=false comes from supabase/config.toml). Do NOT paste-deploy from
// the dashboard — if code isn't in git, it isn't deployed.
// Secrets: supabase secrets set BOT_TOKEN=<your bot token>
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)
//
// The client calls this with { op, initData, ...payload }. We validate the
// Telegram initData (HMAC with the bot token) on every call, then use the
// service role to touch the DB. No DB keys are ever exposed to the client.

// Pinned exact version: an esm.sh-side bump of a floating "@2" could change
// the resolved types and turn the CI `deno check` gate red with no code change.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

// The concrete client instance type (what createClient(url, key) returns), for
// typing helpers that take the client. `ReturnType<typeof createClient>` would
// resolve the UN-instantiated generic defaults instead and fail deno check.
const makeClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type SB = ReturnType<typeof makeClient>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: BufferSource, msg: BufferSource): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, msg);
}

// Validate Telegram Mini App initData. Returns the user object or null.
async function validateInitData(initData: string, botToken: string): Promise<Record<string, unknown> | null> {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const enc = new TextEncoder();
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secretKey = await hmac(enc.encode("WebAppData"), enc.encode(botToken));
  const computed = toHex(await hmac(secretKey, enc.encode(dataCheckString)));
  if (computed !== hash) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null; // 24h freshness
  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

const randomCode = (n = 6) => {
  const alpha = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => alpha[b % alpha.length]).join("");
};

const APP_LINK = "https://t.me/jpgmahjongbot/jpg";

// Post a "tap to join" button into the Telegram group a new group is bound to.
// Best-effort: failures (bot not in chat, etc.) never block group creation.
async function announceGroup(chatId: number, name: string, by: string, code: string): Promise<void> {
  const token = Deno.env.get("BOT_TOKEN");
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${by} started a mahjong group: "${name}". Tap to join — everyone sees the same balances.`,
        reply_markup: { inline_keyboard: [[{ text: `Join ${name}`, url: `${APP_LINK}?startapp=${code}` }]] },
      }),
    });
  } catch (_) {
    /* ignore */
  }
}

// Tell the bound Telegram group when an account claims a seat.
// Best-effort: a failed post never blocks the join.
async function announceJoin(chatId: number, nickname: string): Promise<void> {
  const token = Deno.env.get("BOT_TOKEN");
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `${nickname} joined the group.` }),
    });
  } catch (_) {
    /* ignore */
  }
}

// Which player seat each account has claimed in a group. Used to gate the
// "Join Group" screen and greet the user by their seat.
async function seatInfo(
  sb: SB,
  trackerId: string,
  userId: number,
): Promise<{ me: string | null; isMember: boolean; claimedNames: string[] }> {
  const { data } = await sb.from("members").select("user_id,name").eq("tracker_id", trackerId);
  const rows = (data || []) as Array<{ user_id: number; name: string | null }>;
  return {
    me: rows.find((r) => Number(r.user_id) === userId)?.name ?? null,   // your claimed seat (null = unseated)
    isMember: rows.some((r) => Number(r.user_id) === userId),           // you're in the group (may be unseated)
    claimedNames: rows.map((r) => r.name).filter((n): n is string => !!n),
  };
}

// --- Sessions (one sitting at the table) --------------------------------------
// Money is tallied per session; ended sessions feed the group's running debt
// counter. At most one active session per group (partial unique index), and a
// session lazily auto-ends 24h after it started (no cron needed).

const SESSION_MS = 24 * 3600 * 1000;
// Keep in sync with GAME_TYPES in lib/sg/remote.ts (the client copy).
const GAME_TYPES = ["sg4", "my3", "riichi"];
const ROSTER_MAX = 12; // a group holds more names than one table seats
const seatsFor = (mahjongType: string) => (mahjongType === "my3" ? 3 : 4);

type SessionRow = {
  id: string; mahjong_type: string; players: unknown; bases: unknown; settle: boolean;
  started_by: string | null; started_at: string; ended_at: string | null;
};

async function autoEndStale(sb: SB, trackerId: string): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_MS).toISOString();
  await sb.from("sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("tracker_id", trackerId).is("ended_at", null).lt("started_at", cutoff);
}

async function activeSession(sb: SB, trackerId: string): Promise<SessionRow | null> {
  const { data } = await sb.from("sessions").select()
    .eq("tracker_id", trackerId).is("ended_at", null).maybeSingle();
  return (data as SessionRow | null) || null;
}

// Belt-and-suspenders for the 0004 deploy window: if a session is active with no
// frozen player list (e.g. one started by the pre-0004 function, which didn't set
// players), pin its players to `roster` BEFORE the caller grows the roster — so a
// name added mid-session can never leak into that in-flight sitting's money. A
// no-op for new-function sessions (which always carry their 3-4 players).
async function freezeStaleSession(sb: SB, trackerId: string, roster: string[]): Promise<void> {
  if (!roster.length) return;
  const s = await activeSession(sb, trackerId);
  const sp = Array.isArray((s as SessionRow | null)?.players) ? (s as unknown as { players: unknown[] }).players : [];
  if (s && sp.length === 0) {
    await sb.from("sessions").update({ players: roster }).eq("id", s.id);
  }
}

// PostgREST silently caps any select at 1000 rows — fatal for money queries
// that sum a whole history. Page with .range() until a short page. The queries
// MUST have a stable ORDER BY for the pages to be consistent.
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const SIZE = 1000;
  const out: T[] = [];
  for (let i = 0; i < 50; i++) { // 50k rows = far beyond hobby scale
    const { data, error } = await page(i * SIZE, (i + 1) * SIZE - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < SIZE) return out;
  }
  return out;
}

// The full canonical state every group op returns: the active session (if any)
// with ITS actions, plus the debt tally summed from everything already ended
// (ended sessions + legacy pre-session actions with session_id null).
async function groupState(sb: SB, tracker: Record<string, unknown>, userId: number) {
  const tid = String(tracker.id);
  await autoEndStale(sb, tid);
  const session = await activeSession(sb, tid);
  const rows = await allRows<{ session_id: string | null; transfers: Array<{ payer: string; payee: string; amount: number }>; meta: Record<string, unknown> | null; created_at: string }>(
    (from, to) => sb.from("actions")
      .select("id, actioner, summary, transfers, meta, created_at, session_id")
      .eq("tracker_id", tid).order("created_at", { ascending: true }).range(from, to),
  );
  // With a session running, `actions` is that session's log. With none, return
  // the FULL history (legacy shape): pre-session client bundles compute their
  // balances from `actions`, and this keeps them correct instead of showing
  // everyone $0.00 during the deploy window. The new client only reads
  // `actions` inside a live session, so it never sees the difference.
  const actions = session ? rows.filter((a) => a.session_id === session.id) : rows;
  // Two running totals over everything EXCEPT the live session. `debts` = what's
  // still OUTSTANDING (a settlement repayment nets it toward zero). `allTime` =
  // career win/loss, which settlements must NOT move (repaying isn't a game
  // result), so it skips actions tagged meta.k="settle".
  const isSettle = (a: { meta: Record<string, unknown> | null }) => !!a.meta && (a.meta as { k?: string }).k === "settle";
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
  // All sessions (newest first) for the history tab, each with its own net (from
  // its actions, already in `rows`), plus the games-played count per name.
  const { data: sess } = await sb.from("sessions")
    .select("id, name, players, settle, started_by, started_at, ended_at")
    .eq("tracker_id", tid).order("started_at", { ascending: false });
  // GAME net (history display) and OUTSTANDING (games + that session's own
  // repayments — session-tagged settlements — for the $ tab's per-session
  // settle). Legacy null-session settlements sit in neither.
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
  const sessions = ((sess || []) as Array<{ id: string; name: string | null; players: unknown; settle: boolean; started_by: string | null; started_at: string; ended_at: string | null }>).map((s) => {
    if (s.ended_at && Array.isArray(s.players)) for (const p of s.players as string[]) games[p] = (games[p] || 0) + 1;
    return {
      id: s.id, name: s.name, players: Array.isArray(s.players) ? s.players : [],
      settle: s.settle, started_by: s.started_by, started_at: s.started_at, ended_at: s.ended_at,
      net: netBySession[s.id] || {}, outstanding: outBySession[s.id] || {},
    };
  });
  // A short audit trail of settlements so a repayment isn't invisible money.
  const settlements = rows
    .filter(isSettle)
    .map((a) => {
      const m = a.meta as { from?: unknown; to?: unknown };
      const tr = (a.transfers || [])[0];
      return { from: String(m.from ?? ""), to: String(m.to ?? ""), amount: tr ? tr.amount : 0, at: a.created_at };
    })
    .slice(-10)
    .reverse();
  const info = await seatInfo(sb, tid, userId);
  return { tracker, actions, session, debts, allTime, games, sessions, settlements, me: info.me, isMember: info.isMember, claimedNames: info.claimedNames };
}

// Greedy who-owes-who from net balances (biggest debtor pays biggest creditor
// until square). Shared shape with the client's settleUp in components/sg/Group.tsx.
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

// --- Display names (one per Telegram account; NOT unique) ---------------------
// A plain label seeded from the user's Telegram display name. Two people may
// share one (the old global-uniqueness rule + its index were dropped in
// migration 0003). The DB column is still called `username`.
// 1-30 chars, no control characters. Keep in sync with validName in
// lib/sg/remote.ts (the client copy).
const NAME_MAX = 30;
function validName(s: unknown): boolean {
  const t = String(s ?? "").trim();
  if (t.length < 1 || t.length > NAME_MAX) return false;
  for (const ch of t) { const c = ch.codePointAt(0) ?? 0; if (c < 0x20 || c === 0x7f) return false; }
  return true;
}

// The user's Telegram display name (first + last), the seed for a new profile
// and the value auto_sync mirrors. Falls back to the @handle, then a random id.
function tgDisplayName(user: Record<string, unknown>): string {
  const parts = [user.first_name, user.last_name].map((x) => String(x ?? "").trim()).filter(Boolean);
  const name = parts.join(" ").trim();
  if (name) return name.slice(0, NAME_MAX);
  const handle = String(user.username ?? "").trim();
  if (handle) return handle.slice(0, NAME_MAX);
  return `Player${Math.floor(1000 + Math.random() * 9000)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const { op, initData } = body as { op: string; initData: string };
  const user = await validateInitData(initData, Deno.env.get("BOT_TOKEN") || "");
  if (!user) return json({ error: "invalid initData" }, 401);
  const actioner = String(user.first_name || user.username || user.id || "?");
  const userId = Number((user as { id?: number }).id) || 0; // Telegram account id

  const sb = makeClient();

  try {
    if (op === "me") {
      // The account's display name (null on first ever use) + a suggestion (the
      // Telegram display name) to pre-fill the first-run gate. While auto_sync is
      // on we mirror the current Telegram display name: adopt it if it changed.
      // (`hasHandle` kept for client compat; a Telegram user always has a name.)
      if (!userId) return json({ profile: null, suggested: "", hasHandle: false });
      const tgName = tgDisplayName(user as Record<string, unknown>);
      const { data: p, error: pe } = await sb.from("profiles")
        .select("username,auto_sync,game_types,payout_presets").eq("user_id", userId).maybeSingle();
      if (pe) throw pe; // don't swallow: a missing table / DB blip must surface as a retryable error, never silently force the gate
      if (!p) return json({ profile: null, suggested: tgName, hasHandle: true });
      let username = (p as { username: string }).username;
      const autoSync = (p as { auto_sync?: boolean }).auto_sync !== false;
      // No uniqueness anymore, so mirroring just adopts the latest Telegram name.
      if (autoSync && tgName && tgName !== username) {
        const { error: ue } = await sb.from("profiles")
          .update({ username: tgName, updated_at: new Date().toISOString() }).eq("user_id", userId);
        if (!ue) username = tgName;
      }
      const gameTypes = (p as { game_types?: unknown }).game_types ?? null; // null -> first-run checklist
      const presets = (p as { payout_presets?: unknown }).payout_presets ?? [];
      return json({ profile: { username, gameTypes, presets }, suggested: username, hasHandle: true });
    }

    if (op === "set-prefs") {
      // First-run checklist / settings: which mahjong types this account plays.
      if (!userId) return json({ error: "no account" }, 401);
      const raw = (body as unknown as { gameTypes?: unknown }).gameTypes;
      const types = [...new Set((Array.isArray(raw) ? raw : []).map(String).filter((t) => GAME_TYPES.includes(t)))];
      if (!types.length) return json({ error: "pick at least one game type" }, 400);
      const { data: upd, error: e } = await sb.from("profiles")
        .update({ game_types: types, updated_at: new Date().toISOString() })
        .eq("user_id", userId).select("user_id");
      if (e) throw e;
      if (!upd || !upd.length) return json({ error: "set your name first" }, 409);
      return json({ gameTypes: types });
    }

    if (op === "save-preset") {
      // Save a named payout preset to this account (session-setup dropdown).
      if (!userId) return json({ error: "no account" }, 401);
      const name = String((body as { name?: string }).name || "").trim().slice(0, 30);
      const cfg = (body as unknown as { cfg?: unknown }).cfg;
      if (!name) return json({ error: "give the preset a name" }, 400);
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return json({ error: "bad preset values" }, 400);
      const { data: p, error: pe } = await sb.from("profiles").select("payout_presets").eq("user_id", userId).maybeSingle();
      if (pe) throw pe;
      if (!p) return json({ error: "set your name first" }, 409);
      const list = (Array.isArray((p as { payout_presets?: unknown }).payout_presets)
        ? (p as { payout_presets: Array<{ name?: string }> }).payout_presets : []);
      const next = [...list.filter((x) => x && x.name !== name), { name, cfg }].slice(-20); // replace same name; cap 20
      const { error: we } = await sb.from("profiles")
        .update({ payout_presets: next, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (we) throw we;
      return json({ presets: next });
    }

    if (op === "set-username") {
      // Set the account's display name (not unique). auto_sync stays on only
      // while the chosen name IS the current Telegram display name, so accepting
      // the suggestion keeps it in sync and typing a custom one pins it.
      if (!userId) return json({ error: "no account" }, 401);
      const raw = String((body as { username?: string }).username || "").trim();
      if (!validName(raw)) return json({ error: `name must be 1-${NAME_MAX} characters` }, 400);
      const autoSync = raw === tgDisplayName(user as Record<string, unknown>);
      const { data: existing } = await sb.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
      const now = new Date().toISOString();
      const { error: we } = existing
        ? await sb.from("profiles").update({ username: raw, auto_sync: autoSync, updated_at: now }).eq("user_id", userId)
        : await sb.from("profiles").insert({ user_id: userId, username: raw, auto_sync: autoSync });
      if (we) throw we;
      const { data: p2 } = await sb.from("profiles").select("game_types,payout_presets").eq("user_id", userId).maybeSingle();
      return json({ profile: {
        username: raw,
        gameTypes: (p2 as { game_types?: unknown } | null)?.game_types ?? null,
        presets: (p2 as { payout_presets?: unknown } | null)?.payout_presets ?? [],
      } });
    }

    if (op === "rename-seat") {
      // Rename the caller's own seat (their per-group display name). Atomically
      // rewrites the roster + every transfer via rename_player so balances stay
      // attributed to the renamed player.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const newName = String((body as { name?: string }).name || "").trim();
      if (!newName) return json({ error: "name required" }, 400);
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const { data: mem } = await sb.from("members").select("name").eq("tracker_id", tracker.id).eq("user_id", userId).maybeSingle();
      const oldName = mem ? (mem as { name: string }).name : null;
      if (!oldName) return json({ error: "you haven't joined this group" }, 400);
      if (oldName !== newName) {
        const players: string[] = Array.isArray(tracker.players) ? tracker.players : [];
        if (players.includes(newName)) return json({ error: "that name is taken in this group" }, 409);
        const { error: re } = await sb.rpc("rename_player", { p_id: tracker.id, p_user: userId, p_old: oldName, p_new: newName });
        if (re) {
          if (re.code === "23505") return json({ error: "that name is taken in this group" }, 409);
          throw re;
        }
      }
      const { data: t2 } = await sb.from("trackers").select().eq("code", code).single();
      return json(await groupState(sb, t2 || tracker, userId));
    }

    if (op === "create") {
      // A group starts as just a name + share code with an EMPTY roster. Names
      // (placeholders) are added on the group page; payouts are chosen per
      // session. The creator joins immediately (unseated) so the group is theirs.
      if (!userId) return json({ error: "no account" }, 401);
      const { name: rawName, tgChatId, defaultType } = body as unknown as {
        name?: string; tgChatId?: number; defaultType?: string;
      };
      const name = String(rawName || "").trim().slice(0, NAME_MAX) || "Mahjong";
      if (!validName(name)) return json({ error: `name must be 1-${NAME_MAX} characters, no control characters` }, 400);
      const chat = typeof tgChatId === "number" && Number.isFinite(tgChatId) ? tgChatId : null;
      // What this group usually plays; prefills each session's type.
      const dtype = defaultType === "my3" ? "my3" : "sg4";
      let code = randomCode();
      for (let i = 0; i < 3; i++) {
        const { data, error } = await sb
          .from("trackers")
          .insert({ code, name, players: [], tg_chat_id: chat, default_type: dtype })
          .select()
          .single();
        if (!error) {
          // The creator becomes an unseated member (name null) so they own the
          // group and can add names / start a session without first claiming.
          const { error: me } = await sb.from("members").insert({ tracker_id: data.id, user_id: userId, name: null });
          if (me && me.code !== "23505") throw me; // 23505 = already a member (shouldn't happen on a fresh tracker)
          if (chat) await announceGroup(chat, name, actioner, code); // invite the group
          return json(await groupState(sb, data, userId));
        }
        if (error.code === "23505") code = randomCode(); // code collision, retry
        else throw error;
      }
      return json({ error: "could not allocate code" }, 500);
    }

    if (op === "start-session" || op === "end-session") {
      // Sessions: one sitting at the table. Any member (seated or not) may start/end.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);

      if (op === "start-session") {
        await autoEndStale(sb, tracker.id);
        const mt = String((body as { mahjongType?: string }).mahjongType || tracker.default_type || "sg4");
        if (mt !== "sg4" && mt !== "my3") return json({ error: "unknown mahjong type" }, 400);
        // A session records exactly the 3-4 roster names actually playing it.
        const need = seatsFor(mt);
        const rawPlayers = (body as { players?: unknown }).players;
        const players = [...new Set((Array.isArray(rawPlayers) ? rawPlayers : []).map(String))];
        if (players.length !== need) return json({ error: `pick exactly ${need} players` }, 400);
        const roster = new Set(Array.isArray(tracker.players) ? tracker.players : []);
        if (players.some((p) => !roster.has(p))) return json({ error: "a chosen player isn't in the group" }, 400);
        const settle = (body as unknown as { settle?: boolean }).settle !== false;
        const bases = settle ? ((body as unknown as { bases?: unknown }).bases ?? tracker.bases) : null;
        const sName = String((body as { name?: string }).name || "").trim().slice(0, 40) || null;
        // The one-active-per-group rule is the partial unique index, so a racing
        // second start loses with 23505 — never two live sessions.
        const { data: inserted, error: se } = await sb.from("sessions")
          .insert({ tracker_id: tracker.id, mahjong_type: mt, players, bases, settle, name: sName, started_by: info.me ?? actioner })
          .select("id").single();
        if (se) {
          if ((se as { code?: string }).code === "23505") return json({ error: "a session is already running" }, 409);
          throw se;
        }
        // TOCTOU guard: a rename that committed between the roster read above and
        // this insert would pin a now-nonexistent name into sessions.players (the
        // rename's own sessions rewrite can't touch a not-yet-inserted row). Re-read
        // BOTH the roster and this session's stored players FROM THE DB (a rename
        // that lands after the insert already rewrote the row, so trusting the
        // insert-time value would falsely condemn a valid session). If the fresh
        // session still holds a name no longer in the roster, undo it and ask the
        // client to retry — by then the rename is settled. Only act on a positive
        // divergence, so a transient read never deletes a valid session.
        const sid = (inserted as { id: string }).id;
        const [{ data: freshS }, { data: freshT }] = await Promise.all([
          sb.from("sessions").select("players").eq("id", sid).maybeSingle(),
          sb.from("trackers").select("players").eq("id", tracker.id).maybeSingle(),
        ]);
        if (freshS && freshT) {
          const freshRoster = new Set(Array.isArray(freshT.players) ? freshT.players : []);
          const sPlayers = Array.isArray(freshS.players) ? freshS.players as string[] : [];
          if (sPlayers.some((p) => !freshRoster.has(p))) {
            await sb.from("sessions").delete().eq("id", sid);
            return json({ error: "roster changed — refresh and try again" }, 409);
          }
        }
      } else {
        // End the active session; its actions freeze into the debt counter.
        const { data: ended, error: ee } = await sb.from("sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("tracker_id", tracker.id).is("ended_at", null).select("id");
        if (ee) throw ee;
        if (!ended || !ended.length) return json({ error: "no active session" }, 409);
      }
      return json(await groupState(sb, tracker, userId));
    }

    if (op === "list-by-chat") {
      // Groups bound to a Telegram group, so members can see + join them.
      const tgChatId = (body as unknown as { tgChatId?: number }).tgChatId;
      if (typeof tgChatId !== "number" || !Number.isFinite(tgChatId)) return json({ groups: [] });
      const { data, error } = await sb
        .from("trackers")
        .select("code,name,players")
        .eq("tg_chat_id", tgChatId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const groups = (data || [])
        .filter((t) => Array.isArray(t.players))
        .map((t) => ({ code: t.code, name: t.name, players: (t.players as string[]).length }));
      return json({ groups });
    }

    if (op === "open") {
      // Opening a group's link puts you IN it (unseated member, name null) so you
      // can add names, claim a seat, or start a session. Idempotent: if you're
      // already a member (seated or not) it changes nothing.
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      if (userId) {
        const { error: ie } = await sb.from("members").insert({ tracker_id: tracker.id, user_id: userId, name: null });
        if (ie && ie.code !== "23505") throw ie; // 23505 = already a member; keep their existing (maybe seated) row
      }
      return json(await groupState(sb, tracker, userId));
    }

    if (op === "add-name") {
      // Add a placeholder name (a seat linked to no account) to the roster.
      // Anyone already in the group can do this. Capped at ROSTER_MAX.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);
      const raw = String((body as { name?: string }).name || "").trim();
      if (!validName(raw)) return json({ error: `name must be 1-${NAME_MAX} characters` }, 400);
      const players: string[] = Array.isArray(tracker.players) ? tracker.players : [];
      if (players.includes(raw)) return json({ error: "that name is already in the group" }, 409);
      if (players.length >= ROSTER_MAX) return json({ error: `this group already has ${ROSTER_MAX} names` }, 400);
      await freezeStaleSession(sb, tracker.id, players); // pin any in-flight sitting before the roster grows
      // add_player appends atomically (guarded by `not (players ? raw)`).
      const { error: re } = await sb.rpc("add_player", { p_id: tracker.id, p_name: raw });
      if (re) throw re;
      tracker.players = [...players, raw];
      return json(await groupState(sb, tracker, userId));
    }

    if (op === "claim" || op === "join-new") {
      // Take a seat: an existing placeholder name (claim) or a brand-new one
      // (join-new, which also adds it to the roster). If you're already an
      // unseated member, this FILLS your seat; otherwise it inserts a member row.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);

      const { data: memRow } = await sb.from("members").select("id,name")
        .eq("tracker_id", tracker.id).eq("user_id", userId).maybeSingle();
      const mem = memRow as { id: string; name: string | null } | null;
      if (mem && mem.name) return json({ error: "you already have a seat in this group" }, 409);
      const players: string[] = Array.isArray(tracker.players) ? tracker.players : [];

      let seat: string;
      if (op === "claim") {
        seat = String((body as { player?: string }).player || "");
        if (!players.includes(seat)) return json({ error: "no such player" }, 400);
      } else {
        seat = String((body as { name?: string }).name || "").trim();
        if (!validName(seat)) return json({ error: `name must be 1-${NAME_MAX} characters` }, 400);
        if (players.includes(seat)) return json({ error: "that name is already in the group" }, 409);
        if (players.length >= ROSTER_MAX) return json({ error: `this group already has ${ROSTER_MAX} names` }, 400);
      }

      // Set the seat: fill an existing unseated member, or insert a new member
      // row. The unique (tracker_id, name) constraint makes concurrent claims of
      // the same seat race-safe — the loser gets 23505.
      if (mem) {
        const { data: upd, error: ue } = await sb.from("members")
          .update({ name: seat }).eq("tracker_id", tracker.id).eq("user_id", userId).is("name", null).select("id");
        if (ue) {
          if (ue.code === "23505") return json({ error: "that name is already taken" }, 409);
          throw ue;
        }
        if (!upd || !upd.length) {
          // Our unseated row was filled by a concurrent call. If it landed on the
          // seat we wanted, treat as success; otherwise report it's taken.
          const { data: re } = await sb.from("members").select("name")
            .eq("tracker_id", tracker.id).eq("user_id", userId).maybeSingle();
          if ((re as { name?: string } | null)?.name !== seat) return json({ error: "that name is already taken" }, 409);
        }
      } else {
        const { error: ie } = await sb.from("members").insert({ tracker_id: tracker.id, user_id: userId, name: seat });
        if (ie) {
          if (ie.code === "23505") return json({ error: "you already joined this group, or that name is taken" }, 409);
          throw ie;
        }
      }

      // For join-new, add the new name to the roster — AFTER the seat is set, so a
      // failed claim never leaves an orphan roster name. add_player is idempotent.
      if (op === "join-new" && !players.includes(seat)) {
        await freezeStaleSession(sb, tracker.id, players); // pin any in-flight sitting before the roster grows
        const { error: re } = await sb.rpc("add_player", { p_id: tracker.id, p_name: seat });
        if (re) throw re;
        tracker.players = [...players, seat];
      }

      // Notify the bound Telegram group that this seat is now claimed.
      const chatId = Number((tracker as { tg_chat_id?: number }).tg_chat_id);
      if (Number.isFinite(chatId) && chatId) await announceJoin(chatId, seat);

      return json(await groupState(sb, tracker, userId));
    }

    if (op === "my-groups") {
      // Every group this account belongs to (works on any device), enriched for
      // the home screen: your seat + net balance there, whether a session is
      // running, and last activity (the default sort).
      if (!userId) return json({ groups: [] });
      const { data, error } = await sb
        .from("members")
        .select("name, created_at, trackers(id,code,name,players)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      type Row = { name: string | null; trackers: { id: string; code: string; name: string; players: string[] } | null };
      const rows = ((data || []) as unknown as Row[])
        .filter((m) => m.trackers && Array.isArray(m.trackers.players));
      const ids = rows.map((m) => m.trackers!.id);
      const acts = new Map<string, { net: Map<string, number>; last: string }>();
      const live = new Set<string>();
      if (ids.length) {
        const [aData, { data: sData }] = await Promise.all([
          allRows<{ tracker_id: string; transfers: Array<{ payer: string; payee: string; amount: number }>; created_at: string }>(
            (from, to) => sb.from("actions").select("tracker_id, transfers, created_at").in("tracker_id", ids)
              .order("created_at", { ascending: true }).range(from, to),
          ),
          sb.from("sessions").select("tracker_id, started_at").in("tracker_id", ids).is("ended_at", null),
        ]);
        for (const a of aData) {
          const e = acts.get(a.tracker_id) || { net: new Map<string, number>(), last: "" };
          for (const t of a.transfers || []) {
            e.net.set(t.payer, (e.net.get(t.payer) || 0) - t.amount);
            e.net.set(t.payee, (e.net.get(t.payee) || 0) + t.amount);
          }
          if (a.created_at > e.last) e.last = a.created_at;
          acts.set(a.tracker_id, e);
        }
        const cutoff = new Date(Date.now() - SESSION_MS).toISOString();
        for (const s of (sData || []) as Array<{ tracker_id: string; started_at: string }>) {
          if (s.started_at >= cutoff) live.add(s.tracker_id); // expired ones just haven't been lazily ended yet
        }
      }
      const groups = rows.map((m) => {
        const t = m.trackers!;
        const e = acts.get(t.id);
        return {
          code: t.code, name: t.name, players: t.players.length,
          myName: m.name, myNet: m.name && e ? (e.net.get(m.name) || 0) : 0,
          lastActivity: e?.last || "", hasActive: live.has(t.id),
        };
      }).sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
      return json({ groups });
    }

    // NOTE: the old "setup-group" op was removed 2026-07-02 — it let anyone with
    // a group code overwrite a live group's roster/stakes with no auth and no
    // stub-state precondition. Nothing in the client calls it. Do not re-add it
    // without a userId check AND a "players is still empty" WHERE clause.

    if (op === "settle") {
      // Record a real-life repayment that clears (part of) a debt. The atomic
      // net-read + clamp + insert lives in the settle_debt() SQL function, which
      // serializes per tracker (a transaction advisory lock) so two people
      // settling the SAME debt at once can't both read the pre-insert net and
      // over-settle it. Here we only gate on identity (the DB can't see who the
      // Telegram caller is): they must be a member AND a party to the debt.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);
      const from = String((body as { from?: string }).from || "");   // the debtor (owes)
      const to = String((body as { to?: string }).to || "");          // the creditor (is owed)
      const amount = Number((body as { amount?: unknown }).amount);
      const sessionId = String((body as { sessionId?: string }).sessionId || "");
      if (!from || !to || from === to) return json({ error: "bad settlement" }, 400);
      if (info.me !== from && info.me !== to) return json({ error: "you can only settle a debt you're part of" }, 403);
      if (!(amount > 0)) return json({ error: "amount must be positive" }, 400);
      // Per-session settle (0008): clear ONE session's debt, so the repayment
      // carries its session_id and is removed with the session on delete. Passing
      // p_session selects the 6-arg overload; omitting it uses the legacy
      // aggregate one (an old client mid-deploy). settle_debt returns the amount
      // actually settled (0 = nothing outstanding, so nothing was inserted).
      const params: Record<string, unknown> = { p_tracker: tracker.id, p_from: from, p_to: to, p_amount: amount, p_actioner: actioner };
      if (sessionId) {
        const { data: s } = await sb.from("sessions").select("id, ended_at").eq("id", sessionId).eq("tracker_id", tracker.id).maybeSingle();
        if (!s) return json({ error: "session not found" }, 404);
        if (!(s as { ended_at?: string | null }).ended_at) return json({ error: "end the session before settling it" }, 409);
        params.p_session = sessionId;
      }
      const { data: settled, error: se } = await sb.rpc("settle_debt", params);
      if (se) throw se;
      if (!(Number(settled) > 0.004)) return json({ error: "nothing outstanding between them" }, 409);
      return json(await groupState(sb, tracker, userId));
    }

    if (op === "rename-group") {
      // Rename the group (its display name). Any member may.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const newName = String((body as { name?: string }).name || "").trim();
      if (!validName(newName)) return json({ error: `name must be 1-${NAME_MAX} characters, no control characters` }, 400);
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);
      const { error: ue } = await sb.from("trackers").update({ name: newName }).eq("id", tracker.id);
      if (ue) throw ue;
      const { data: t2 } = await sb.from("trackers").select().eq("code", code).single();
      return json(await groupState(sb, t2 || tracker, userId));
    }

    if (op === "remove-player") {
      // Remove a name from the group. Guarded so the books stay balanced: only
      // when their balance is settled (net ~0) and they're not in the running
      // session ("deconflict money first"). Drops the roster name + claimed seat.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const target = String((body as { name?: string }).name || "").trim();
      if (!target) return json({ error: "name required" }, 400);
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);
      const players: string[] = Array.isArray(tracker.players) ? tracker.players : [];
      if (!players.includes(target)) return json({ error: "no such player" }, 404);
      const active = await activeSession(sb, tracker.id);
      const ap = Array.isArray((active as SessionRow | null)?.players) ? (active as unknown as { players: string[] }).players : [];
      if (active && ap.includes(target)) return json({ error: `${target} is in the running session — end it first` }, 409);
      const st = await groupState(sb, tracker, userId);
      const net = (st.debts as Record<string, number>)[target] || 0;
      if (Math.abs(net) > 0.004) return json({ error: `settle ${target}'s balance first — they're ${net > 0 ? "owed" : "owing"} money` }, 409);
      const { error: re } = await sb.rpc("remove_player", { p_id: tracker.id, p_name: target });
      if (re) throw re;
      // Drop the claimed seat too (they can rejoin via the link if needed).
      await sb.from("members").delete().eq("tracker_id", tracker.id).eq("name", target);
      const { data: t2 } = await sb.from("trackers").select().eq("code", code).single();
      return json(await groupState(sb, t2 || tracker, userId));
    }

    if (op === "delete-session") {
      // Delete a session and its money. Balances are derived from the action log,
      // so this removes rows and lets them recompute. Decision flow:
      //
      //   ACTIVE session ......................... cancel: delete its game rows
      //                                            (its money never reached debts).
      //   ENDED session:
      //   ├─ this session's OWN debt settled? ── YES → clean delete: remove EVERY
      //   │                                        row tagged session_id=sid (games
      //   │                                        AND its repayments) → nothing left.
      //   ├─ else, is the WHOLE GROUP square? ── YES → delete anyway (offsetting or
      //   │                                        legacy); any real debt from OTHER
      //   │                                        sessions stays visible (correct).
      //   └─ else ─────────────────────────────── REFUSE 409 "settle this session's
      //                                            debts first" (client shows it
      //                                            inline; settle it in $ then delete).
      //
      // "settled" = this session's `outstanding` (its games + its own repayments,
      // all carrying session_id) nets to zero. Deleting by session_id takes a
      // session's repayments with it, so no session-agnostic settlement is ever
      // orphaned. HARD LESSON (2026-07-11 review, briefly-deployed then reverted):
      // never delete BEYOND this session's rows — a version that wiped ALL
      // settlements behind an aggregate post-check could erase a real debt and
      // lock offsetting sessions (regression tests: localBackend.delete.test.ts).
      // actions.session_id is ON DELETE SET NULL, so delete the actions FIRST,
      // then the session row. Any SEATED member may (LINK-FIRST peer trust).
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const sid = String((body as { sessionId?: string }).sessionId || "");
      if (!sid) return json({ error: "session required" }, 400);
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);
      if (!info.me) return json({ error: "claim a seat in the group first" }, 403);
      const { data: s } = await sb.from("sessions").select("id, ended_at").eq("id", sid).eq("tracker_id", tracker.id).maybeSingle();
      if (!s) return json({ error: "session not found" }, 404);
      if (!(s as { ended_at?: string | null }).ended_at) {
        // ACTIVE session: cancel it — its actions never reach the debt counter.
        const { error: de } = await sb.from("actions").delete().eq("tracker_id", tracker.id).eq("session_id", sid);
        if (de) throw de;
      } else {
        // ENDED session (see the flowchart above): gate on this session's own
        // outstanding, with a whole-group-square fallback, then delete every row
        // tagged with it (games + its own repayments).
        const st = await groupState(sb, tracker, userId);
        const sess = (st.sessions as Array<{ id: string; outstanding?: Record<string, number> }>).find((x) => x.id === sid);
        const sessOwed = Object.values(sess?.outstanding || {}).some((v) => Math.abs(v) > 0.004);
        const groupOwed = Object.values(st.debts as Record<string, number>).some((v) => Math.abs(v) > 0.004);
        if (sessOwed && groupOwed) {
          return json({ error: "settle this session's debts first — it can only be deleted once its money is squared up" }, 409);
        }
        const { error: de } = await sb.from("actions").delete().eq("tracker_id", tracker.id).eq("session_id", sid);
        if (de) throw de;
      }
      const { error: xe } = await sb.from("sessions").delete().eq("id", sid).eq("tracker_id", tracker.id);
      if (xe) throw xe;
      return json(await groupState(sb, tracker, userId));
    }

    if (op === "settle-all") {
      // Record a repayment for every outstanding who-owes-who line at once, each
      // via the atomic settle_debt RPC (clamps to what's actually outstanding).
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);
      if (!info.me) return json({ error: "claim a seat in the group first" }, 403);
      const st = await groupState(sb, tracker, userId);
      const pairs = settleUpPairs(st.debts as Record<string, number>);
      for (const p of pairs) {
        const { error: se } = await sb.rpc("settle_debt", { p_tracker: tracker.id, p_from: p.from, p_to: p.to, p_amount: p.amount, p_actioner: actioner });
        if (se) throw se;
      }
      return json(await groupState(sb, tracker, userId));
    }

    if (op === "announce") {
      // Re-post the group's "tap to join" button into the Telegram chat it's
      // bound to (the group this app was opened in). Member-only.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);
      const chatId = Number((tracker as { tg_chat_id?: number }).tg_chat_id);
      if (!Number.isFinite(chatId) || !chatId) return json({ error: "this group isn't linked to a Telegram chat" }, 400);
      await announceGroup(chatId, tracker.name || "Mahjong", actioner, tracker.code);
      return json(await groupState(sb, tracker, userId));
    }

    if (op === "set-tai") {
      // Save this group's winning-hand tai scoring (shared by every member). Any
      // member may edit it; stored as a jsonb map { handId: value } on the tracker,
      // returned to clients on the tracker object. Client values are sanitized (a
      // shared record on a money app): string->string, short keys/values, capped
      // count, so a hostile client can't bloat the row or inject huge blobs.
      // CONCURRENCY: last-writer-wins — the update is a full-column overwrite with
      // no version guard, so two members saving scoring at the same time, the
      // later save silently wins. Accepted at hobby scale (scoring is edited rarely,
      // unlike money actions). Adopt optimistic concurrency (an updated_at/version
      // predicate returning 409, like start-session) only if real conflicts appear.
      if (!userId) return json({ error: "no account" }, 401);
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      const info = await seatInfo(sb, tracker.id, userId);
      if (!info.isMember) return json({ error: "join the group first" }, 403);
      const raw = (body as unknown as { scores?: unknown }).scores;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "bad scoring values" }, 400);
      const scores: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 64)) {
        if (typeof k === "string" && k.length && k.length <= 40) scores[k] = String(v).slice(0, 8);
      }
      const { error: ue } = await sb.from("trackers").update({ tai_scores: scores }).eq("id", tracker.id);
      if (ue) throw ue;
      const { data: t2 } = await sb.from("trackers").select().eq("code", code).single();
      return json(await groupState(sb, t2 || tracker, userId));
    }

    if (op === "state" || op === "action") {
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "tracker not found" }, 404);

      if (op === "action") {
        const { summary, transfers, meta } = body as unknown as { summary: string; transfers: Array<{ payer?: string; payee?: string }>; meta?: unknown };
        if (!summary || !Array.isArray(transfers)) return json({ error: "summary + transfers required" }, 400);
        await autoEndStale(sb, tracker.id);
        const session = await activeSession(sb, tracker.id);
        // Money only moves among the session's chosen players (fallback: the full
        // roster for a session-less bundle). Reject transfers naming anyone else —
        // e.g. a rename landed, or a name isn't in this sitting — so amounts can't
        // attach to a ghost name and balances always sum to zero.
        const sPlayers = Array.isArray((session as SessionRow | null)?.players)
          ? ((session as unknown as { players: string[] }).players) : [];
        const playing = new Set(sPlayers.length ? sPlayers : (Array.isArray(tracker.players) ? tracker.players : []));
        const stale = transfers.flatMap((t) => [t.payer, t.payee]).find((n) => n && !playing.has(n));
        if (stale) return json({ error: "players changed — refresh and try again" }, 409);
        // New clients echo the session they computed the money against; if it
        // ended (or was replaced) in the meantime, refuse rather than attach
        // amounts computed under different rules.
        const claimedSid = String((body as { sessionId?: string }).sessionId || "");
        if (claimedSid && (!session || session.id !== claimedSid)) {
          return json({ error: "the session changed — refresh and try again" }, 409);
        }
        // A log-only session (settle=false) must never accumulate money — a
        // stale pre-session bundle still computes transfers, so blank them
        // server-side (the log line itself is still worth keeping).
        const tx = session && session.settle === false ? [] : transfers;
        // No session at all (only possible for pre-session bundles, which never
        // send sessionId): keep legacy behavior — the row goes straight into
        // the group's history/debt tally.
        const { error: e2 } = await sb.from("actions")
          .insert({ tracker_id: tracker.id, session_id: session?.id ?? null, actioner, summary, transfers: tx, meta: meta ?? null });
        if (e2) throw e2;
      }

      return json(await groupState(sb, tracker, userId));
    }

    return json({ error: `unknown op: ${op}` }, 400);
  } catch (e) {
    // Client-visible errors are hand-written sentences; the real error goes to
    // the function logs only (never leak Postgres/table details to users).
    console.error(`track op=${op} failed:`, (e as Error)?.message || e);
    return json({ error: "something went wrong — please try again" }, 500);
  }
});
