# Group-synced trackers — Supabase setup

The synced Singaporean tracker stores each game on Supabase and lets everyone
see the same balances on their own phone. All access goes through one Edge
Function (`track`) that validates Telegram `initData` server-side; no database
keys are shipped in the app.

## One-time setup

1. **Create a project** at https://supabase.com (free tier). Note the project ref.

2. **Create the schema**: open the project's **SQL Editor**, paste the contents
   of [`supabase/schema.sql`](supabase/schema.sql), and run it.

3. **Install the CLI and link** (in this folder):
   ```
   npm i -g supabase
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

4. **Set the bot token secret** (used to validate initData):
   ```
   supabase secrets set BOT_TOKEN=8708366926:AAF...   # @jpgmahjongbot token
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

5. **Deploy the function** (public — it does its own initData auth):
   ```
   supabase functions deploy track --no-verify-jwt
   ```
   This prints the function URL, e.g.
   `https://<ref>.supabase.co/functions/v1/track`.

6. **Tell the app the URL**: in the GitHub repo →
   **Settings → Secrets and variables → Actions → Variables**, add:
   - `TRACK_URL` = the function URL from step 5
   - `BOT_APP_LINK` = your Mini App deep link, e.g. `https://t.me/jpgmahjongbot/jpg`
     (from the `/newapp` short name)

   Re-run the **Deploy to GitHub Pages** workflow so the values are baked in.

## The live bot (groups, /start, /help)

A second Edge Function, [`bot`](supabase/functions/bot/index.ts), is the actual
Telegram bot (a webhook). It makes the bot reply to `/start`, `/open`, `/help`,
and to being added to a group, and it binds each Telegram group to its own
mahjong group (a row in `trackers` keyed by `tg_chat_id`).

1. **Schema**: re-run [`supabase/schema.sql`](supabase/schema.sql) (it adds the
   `tg_chat_id` column and relaxes the `name`/`players` defaults so the bot can
   create blank group stubs).
2. **Deploy** the `bot` function (dashboard → Edge Functions → Deploy a new
   function → Via Editor → paste, name it `bot`) and turn **Verify JWT OFF** in
   its Settings (Telegram sends no JWT).
3. **Secret**: add `WEBHOOK_SECRET` (any random string) in Edge Function Secrets.
   `BOT_TOKEN` is reused from the synced-tracker setup above.
4. **Register** the webhook + commands in one shot — open this once in a browser:
   `https://<ref>.supabase.co/functions/v1/bot?action=setup&secret=<WEBHOOK_SECRET>`
   It calls Telegram's `setWebhook` (pointing back at the `bot` function, with
   the secret in the `X-Telegram-Bot-Api-Secret-Token` header) and `setMyCommands`
   for private + group chats (so the commands button appears).
5. Add **@jpgmahjongbot** to a group and send `/start` — it replies with an
   **Open Mahjong** button. First open in a group → **Create New Group**;
   afterwards the same button reopens that group's balances.

## How it works

- **Create**: in the app, Singaporean → Synced group → Create → set players +
  base values. You get a 6-char **code** and a share link
  `t.me/<bot>/<app>?startapp=<code>`.
- **Join**: other players open that link (the Mini App reads `start_param` and
  loads the tracker) or enter the code manually.
- **Record**: any action posts to `track` (validated by your Telegram identity);
  every device polls every ~2.5s and updates. Balances are derived from the
  action log, so they always reconcile to zero.

## Notes / next steps

- Sync is **polling** (~2.5s) for simplicity. Swap to Supabase Realtime later
  for instant updates.
- The actioner name comes from the Telegram user who entered each action.
- "Dummy" players (non-Telegram people at the table) are just names in the
  player list — anyone in the group can record for them.
