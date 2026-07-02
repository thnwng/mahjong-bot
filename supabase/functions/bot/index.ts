// Supabase Edge Function: the live Telegram bot (webhook).
//
// This is what makes @jpgmahjongbot "awake": Telegram POSTs every update here and
// we reply. It mirrors CoconutSplit's pattern:
//   - /start, /open (and being added to a group) -> reply with an "Open Mahjong"
//     button whose deep link carries this group's short code.
//   - /help -> a short how-to.
//   - Each Telegram group is bound to its own mahjong group (a row in `trackers`
//     keyed by tg_chat_id). First time -> a blank stub the Mini App turns into a
//     "Create New Group" form; afterwards the same code reopens that group.
//
// One-time wiring (no token typed by hand): GET this function with
//   ?action=setup&secret=<WEBHOOK_SECRET>
// and it calls Telegram's setWebhook (pointing back here, with a secret header)
// and setMyCommands (so the commands button shows) using the BOT_TOKEN secret.
//
// Deploys automatically from git via .github/workflows/deploy-functions.yml
// (verify_jwt=false comes from supabase/config.toml). Do NOT paste-deploy from
// the dashboard — if code isn't in git, it isn't deployed.
// Secrets needed: BOT_TOKEN (already set), WEBHOOK_SECRET (any random string).
// (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// Where the Mini App lives + its /newapp short name. Tap-to-open deep links are
// `${APP_LINK}?startapp=<code>`.
const APP_LINK = "https://t.me/jpgmahjongbot/jpg";

const TG = (method: string) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

async function tg(method: string, payload: unknown) {
  const res = await fetch(TG(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function openButton(param?: string) {
  const url = param ? `${APP_LINK}?startapp=${param}` : APP_LINK;
  return { inline_keyboard: [[{ text: "32fei no money", url }]] };
}

async function replyOpen(chatId: number, isGroup: boolean) {
  // In a group, the deep link carries the group's id (g<chatId>) so the app
  // opens this group's home — its groups + create/join. In private, no param.
  const param = isGroup ? `g${chatId}` : undefined;
  const text = isGroup
    ? "Tap below to open Mahjong for this group — see its groups, or create a new one."
    : "Tap below to open Mahjong.";
  await tg("sendMessage", { chat_id: chatId, text, reply_markup: openButton(param) });
}

const HELP = [
  "Mahjong helper bot.",
  "",
  "In a group:",
  "• /start or /open — open this group's shared tracker (Singaporean payouts: Hu / Zimo / Gang / Yao).",
  "  Everyone in the group sees the same running balances on their own phone.",
  "",
  "In private chat:",
  "• /start — open the app. Singaporean tracker + a Riichi hand calculator.",
  "",
  "Each Telegram group keeps its own players, history and balances.",
].join("\n");

// ----------------------------------------------------------------- update handler

async function handleUpdate(u: Record<string, unknown>) {
  // Bot added to / removed from a group.
  const mcm = u.my_chat_member as Record<string, unknown> | undefined;
  if (mcm) {
    const chat = mcm.chat as { id: number; title?: string; type: string };
    const status = (mcm.new_chat_member as { status?: string })?.status;
    if ((chat.type === "group" || chat.type === "supergroup") && (status === "member" || status === "administrator")) {
      await replyOpen(chat.id, true);
    }
    return;
  }

  const msg = u.message as Record<string, unknown> | undefined;
  if (!msg) return;
  const chat = msg.chat as { id: number; title?: string; type: string };
  const text = String(msg.text || "");
  if (!text.startsWith("/")) return;

  // /command@botname -> /command
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  const isGroup = chat.type === "group" || chat.type === "supergroup";

  if (cmd === "/start" || cmd === "/open" || cmd === "/mahjong") {
    await replyOpen(chat.id, isGroup);
  } else if (cmd === "/help") {
    await tg("sendMessage", { chat_id: chat.id, text: HELP });
  }
}

// ----------------------------------------------------------------- one-time setup

async function doSetup(): Promise<unknown> {
  const webhookUrl = `${SUPABASE_URL}/functions/v1/bot`;
  const set = await tg("setWebhook", {
    url: webhookUrl,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "my_chat_member"],
  });
  const commands = [
    { command: "start", description: "Open the mahjong tracker" },
    { command: "open", description: "Open this group's tracker" },
    { command: "help", description: "How to use this bot" },
  ];
  const c1 = await tg("setMyCommands", { commands, scope: { type: "all_private_chats" } });
  const c2 = await tg("setMyCommands", { commands, scope: { type: "all_group_chats" } });
  return { webhookUrl, setWebhook: set, setMyCommands: { private: c1, group: c2 } };
}

// ----------------------------------------------------------------- entry

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // One-time setup (GET ?action=setup&secret=<WEBHOOK_SECRET>).
  if (req.method === "GET" && url.searchParams.get("action") === "setup") {
    if (url.searchParams.get("secret") !== WEBHOOK_SECRET || !WEBHOOK_SECRET) {
      return json({ error: "bad or missing secret" }, 403);
    }
    return json(await doSetup());
  }

  if (req.method !== "POST") return json({ ok: true, hint: "Telegram webhook endpoint" });

  // Telegram authenticity: it echoes our secret token in this header.
  // FAIL CLOSED: a missing WEBHOOK_SECRET rejects everything (an unset secret
  // must never silently accept forged updates that can post as the bot).
  if (!WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  // Always 200 quickly so Telegram doesn't retry; do the work but swallow errors.
  try {
    await handleUpdate(update);
  } catch (e) {
    console.error("handleUpdate error:", (e as Error).message || e);
  }
  return json({ ok: true });
});
