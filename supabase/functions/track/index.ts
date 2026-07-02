// Supabase Edge Function: group-synced mahjong trackers.
// Deploy:  supabase functions deploy track --no-verify-jwt
// Secrets: supabase secrets set BOT_TOKEN=<your bot token>
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)
//
// The client calls this with { op, initData, ...payload }. We validate the
// Telegram initData (HMAC with the bot token) on every call, then use the
// service role to touch the DB. No DB keys are ever exposed to the client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function hmac(key: ArrayBuffer | Uint8Array, msg: Uint8Array): Promise<ArrayBuffer> {
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
  sb: ReturnType<typeof createClient>,
  trackerId: string,
  userId: number,
): Promise<{ me: string | null; claimedNames: string[] }> {
  const { data } = await sb.from("members").select("user_id,name").eq("tracker_id", trackerId);
  const rows = (data || []) as Array<{ user_id: number; name: string | null }>;
  return {
    me: rows.find((r) => Number(r.user_id) === userId)?.name ?? null,
    claimedNames: rows.map((r) => r.name).filter((n): n is string => !!n),
  };
}

// --- Usernames (one global handle per Telegram account) ----------------------
// 3-20 chars, letters/digits/underscore; unique case-insensitively (functional
// index on lower(username)).
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

// Strip a Telegram name to a valid handle fragment ([a-z0-9_]). Folds accents
// first so "José" -> "jose" instead of being lost.
function handleFragment(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15);
}

// The account that owns `name` (case-insensitively), or null if free. Escapes
// LIKE metacharacters so an underscore in the handle isn't treated as a wildcard.
async function usernameOwner(sb: ReturnType<typeof createClient>, name: string): Promise<number | null> {
  const esc = name.replace(/[\\%_]/g, "\\$&");
  const { data } = await sb.from("profiles").select("user_id,username").ilike("username", esc);
  const row = (data || []).find((r) => String((r as { username: string }).username).toLowerCase() === name.toLowerCase());
  return row ? Number((row as { user_id: number }).user_id) : null;
}

// Suggest an AVAILABLE username from the user's Telegram handle (or first name),
// appending a number if the base is taken.
async function suggestUsername(sb: ReturnType<typeof createClient>, user: Record<string, unknown>): Promise<string> {
  let base = handleFragment(user.username) || handleFragment(user.first_name);
  if (base.length < 3) base = `player${Math.floor(1000 + Math.random() * 9000)}`;
  const likeBase = base.replace(/[\\%_]/g, "\\$&");
  const { data } = await sb.from("profiles").select("username").ilike("username", `${likeBase}%`);
  const taken = new Set((data || []).map((r) => String((r as { username: string }).username).toLowerCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) { const c = `${base}${i}`; if (!taken.has(c)) return c; }
  return `${base}${Math.floor(Math.random() * 1e6)}`;
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

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (op === "me") {
      // The account's global username (null on first ever use) + an available
      // suggestion to pre-fill the "pick a username" gate. While auto_sync is on
      // we mirror the current Telegram @handle: adopt it if it changed and is free.
      if (!userId) return json({ profile: null, suggested: "", hasHandle: false });
      const handle = handleFragment((user as { username?: unknown }).username);
      const hasHandle = handle.length >= 3;
      const { data: p, error: pe } = await sb.from("profiles").select("username,auto_sync").eq("user_id", userId).maybeSingle();
      if (pe) throw pe; // don't swallow: a missing table / DB blip must surface as a retryable error, never silently force the gate
      if (!p) {
        const suggested = await suggestUsername(sb, user as Record<string, unknown>);
        return json({ profile: null, suggested, hasHandle });
      }
      let username = (p as { username: string }).username;
      const autoSync = (p as { auto_sync?: boolean }).auto_sync !== false;
      if (autoSync && hasHandle && handle !== username.toLowerCase()) {
        const owner = await usernameOwner(sb, handle);
        if (owner === null || owner === userId) {
          const { error: ue } = await sb.from("profiles")
            .update({ username: handle, updated_at: new Date().toISOString() }).eq("user_id", userId);
          if (!ue) username = handle;
        }
      }
      return json({ profile: { username }, suggested: username, hasHandle });
    }

    if (op === "set-username") {
      // Claim or change the account's unique username. Keeps mirroring the
      // Telegram handle only when the chosen name IS that handle.
      if (!userId) return json({ error: "no account" }, 401);
      const raw = String((body as { username?: string }).username || "").trim();
      if (!USERNAME_RE.test(raw)) return json({ error: "username must be 3-20 letters, numbers or underscores" }, 400);
      const owner = await usernameOwner(sb, raw);
      if (owner !== null && owner !== userId) return json({ error: "that username is taken" }, 409);
      const handle = handleFragment((user as { username?: unknown }).username);
      const autoSync = raw.toLowerCase() === handle && handle.length >= 3;
      const { data: existing } = await sb.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
      const now = new Date().toISOString();
      const { error: we } = existing
        ? await sb.from("profiles").update({ username: raw, auto_sync: autoSync, updated_at: now }).eq("user_id", userId)
        : await sb.from("profiles").insert({ user_id: userId, username: raw, auto_sync: autoSync });
      if (we) {
        if ((we as { code?: string }).code === "23505") return json({ error: "that username is taken" }, 409);
        throw we;
      }
      return json({ profile: { username: raw } });
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
        if (re) return json({ error: re.code === "23505" ? "that name is taken in this group" : re.message }, re.code === "23505" ? 409 : 500);
      }
      const { data: t2 } = await sb.from("trackers").select().eq("code", code).single();
      const { data: actions, error: e3 } = await sb
        .from("actions").select().eq("tracker_id", tracker.id).order("created_at", { ascending: true });
      if (e3) throw e3;
      const info = await seatInfo(sb, tracker.id, userId);
      return json({ tracker: t2 || tracker, actions: actions || [], me: info.me, claimedNames: info.claimedNames });
    }

    if (op === "create") {
      const { name, players, bases, tgChatId } = body as unknown as {
        name: string; players: string[]; bases: unknown; tgChatId?: number;
      };
      if (!name || !Array.isArray(players) || players.length < 2) return json({ error: "name + >=2 players required" }, 400);
      if (players.length > 4) return json({ error: "max 4 players per group" }, 400);
      const chat = typeof tgChatId === "number" && Number.isFinite(tgChatId) ? tgChatId : null;
      let code = randomCode();
      for (let i = 0; i < 3; i++) {
        const { data, error } = await sb
          .from("trackers")
          .insert({ code, name, players, bases, tg_chat_id: chat })
          .select()
          .single();
        if (!error) {
          if (chat) await announceGroup(chat, name, actioner, code); // invite the group
          return json({ tracker: data, actions: [], me: null, claimedNames: [] }); // creator claims a seat next
        }
        if (error.code === "23505") code = randomCode(); // code collision, retry
        else throw error;
      }
      return json({ error: "could not allocate code" }, 500);
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
        .filter((t) => Array.isArray(t.players) && t.players.length >= 2)
        .map((t) => ({ code: t.code, name: t.name, players: (t.players as string[]).length }));
      return json({ groups });
    }

    if (op === "open" || op === "claim" || op === "join-new") {
      // open  = look at a group (no membership change) -> returns whether you've
      //         claimed a seat (me) and which seats are taken (claimedNames).
      // claim = take over an existing unclaimed player seat.
      // join-new = add yourself as a brand-new player.
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);

      let joinedName: string | null = null; // set on a successful claim/join, then announced
      if (op === "claim") {
        const player = String((body as { player?: string }).player || "");
        const players: string[] = Array.isArray(tracker.players) ? tracker.players : [];
        if (!players.includes(player)) return json({ error: "no such player" }, 400);
        const { error: ce } = await sb.from("members").insert({ tracker_id: tracker.id, user_id: userId, name: player });
        if (ce) return json({ error: ce.code === "23505" ? "you already joined this group, or that player is taken" : ce.message }, 409);
        joinedName = player;
      } else if (op === "join-new") {
        const raw = String((body as { name?: string }).name || "").trim();
        if (!raw) return json({ error: "name required" }, 400);
        const players: string[] = Array.isArray(tracker.players) ? tracker.players : [];
        if (players.length >= 4) return json({ error: "this group is full (max 4 players)" }, 400);
        // Claim the seat FIRST: if this fails (already joined, or name taken) we
        // return 409 having touched nothing — no orphan player can be created.
        const { error: ie } = await sb.from("members").insert({ tracker_id: tracker.id, user_id: userId, name: raw });
        if (ie) return json({ error: ie.code === "23505" ? "you already joined this group, or that name is taken" : ie.message }, 409);
        // Then ensure the player exists in the roster. add_player appends
        // atomically (guarded by `not (players ? raw)`), so concurrent joins
        // can't lose each other's seats.
        if (!players.includes(raw)) {
          const { error: re } = await sb.rpc("add_player", { p_id: tracker.id, p_name: raw });
          if (re) throw re;
          tracker.players = [...players, raw];
        }
        joinedName = raw;
      }

      // Notify the bound Telegram group that this seat is now claimed.
      const chatId = Number((tracker as { tg_chat_id?: number }).tg_chat_id);
      if (joinedName && Number.isFinite(chatId) && chatId) await announceJoin(chatId, joinedName);

      const { data: actions, error: e3 } = await sb
        .from("actions").select().eq("tracker_id", tracker.id).order("created_at", { ascending: true });
      if (e3) throw e3;
      const info = await seatInfo(sb, tracker.id, userId);
      return json({ tracker, actions: actions || [], me: info.me, claimedNames: info.claimedNames });
    }

    if (op === "my-groups") {
      // Every group this account belongs to (works on any device).
      if (!userId) return json({ groups: [] });
      const { data, error } = await sb
        .from("members")
        .select("created_at, trackers(code,name,players)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const groups = (data || [])
        .map((m) => (m as { trackers: { code: string; name: string; players: string[] } | null }).trackers)
        .filter((t) => t && Array.isArray(t.players) && t.players.length >= 2)
        .map((t) => ({ code: t!.code, name: t!.name, players: t!.players.length }));
      return json({ groups });
    }

    if (op === "setup-group") {
      // Fill in an existing (bot-created) group stub: name + players + bases.
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { name, players, bases } = body as unknown as { name: string; players: string[]; bases: unknown };
      if (!name || !Array.isArray(players) || players.length < 2) return json({ error: "name + >=2 players required" }, 400);
      const { data: tracker, error: e1 } = await sb
        .from("trackers")
        .update({ name, players, bases })
        .eq("code", code)
        .select()
        .single();
      if (e1 || !tracker) return json({ error: "group not found" }, 404);
      return json({ tracker, actions: [], me: null, claimedNames: [] });
    }

    if (op === "state" || op === "action") {
      const code = String((body as { code?: string }).code || "").toUpperCase();
      const { data: tracker, error: e1 } = await sb.from("trackers").select().eq("code", code).single();
      if (e1 || !tracker) return json({ error: "tracker not found" }, 404);

      if (op === "action") {
        const { summary, transfers, meta } = body as unknown as { summary: string; transfers: Array<{ payer?: string; payee?: string }>; meta?: unknown };
        if (!summary || !Array.isArray(transfers)) return json({ error: "summary + transfers required" }, 400);
        // Reject transfers that name a seat no longer in the roster — e.g. a
        // rename landed while this client still held the old name. Otherwise the
        // money would attach to a ghost name and balances wouldn't sum to zero.
        const roster = new Set(Array.isArray(tracker.players) ? tracker.players : []);
        const stale = transfers.flatMap((t) => [t.payer, t.payee]).find((n) => n && !roster.has(n));
        if (stale) return json({ error: "roster changed — refresh and try again" }, 409);
        const { error: e2 } = await sb.from("actions").insert({ tracker_id: tracker.id, actioner, summary, transfers, meta: meta ?? null });
        if (e2) throw e2;
      }

      const { data: actions, error: e3 } = await sb
        .from("actions")
        .select()
        .eq("tracker_id", tracker.id)
        .order("created_at", { ascending: true });
      if (e3) throw e3;
      const info = await seatInfo(sb, tracker.id, userId);
      return json({ tracker, actions, me: info.me, claimedNames: info.claimedNames });
    }

    return json({ error: `unknown op: ${op}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
