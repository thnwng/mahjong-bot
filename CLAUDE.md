# mahjong-web — project map & rules

Telegram Mini App for mahjong: a **group-synced Singaporean tracker** (shared
balances, real money) + a **Riichi hand calculator** (fully client-side).
Live at https://thnwng.github.io/mahjong-bot/ · bot **@jpgmahjongbot** · Mini App
short name **jpg** (deep links: `https://t.me/jpgmahjongbot/jpg?startapp=...`).

Follows the workspace standard: `E:\Claude\telegram-mini-app-standard.md`
(this project is its reference implementation). The phased improvement plan is
[IMPROVEMENT-PLAN.md](IMPROVEMENT-PLAN.md).

## Structure

| Path | What |
|---|---|
| `app/` | Next.js 15 App Router shell; `globals.css` = all styling (Telegram `--tg-theme-*` vars + dark fallbacks) |
| `components/SGGame.tsx` | Tracker **router + home** (boot gates: username → game-types checklist; game-type dropdown; groups w/ balances + manual reorder; deep links; screen union) |
| `components/sg/` | Screens: `Identity` (username + game-types gates), `Settings`, `Join`, `Setup` (create group + usual-type + default payouts), `Group` (**debt counter + session banner + session setup w/ payout presets**), `Play` (session balances, log, **record-action wizard**) |
| `components/RiichiCalculator.tsx`, `TilesMode.tsx`, `ResultCard.tsx` | Riichi calculator UI |
| `lib/telegram.ts` | The one Telegram wrapper (typed CDN script: haptics, back-button stack, closing confirmation). **Do not migrate to @telegram-apps/sdk-react** — see the decision comment at its top |
| `lib/sg/payout.ts` | SG money engine (pure; unit-tested in `payout.test.ts`) |
| `lib/sg/remote.ts` | Client API layer: `{op, initData}` calls to the `track` function; localStorage caches; `USERNAME_RE` (the single client copy) |
| `lib/riichi/` | Riichi engine: `analyze.ts` (hand decomposition), `yaku.ts`, `scoring.ts` (unit-tested) |
| `supabase/functions/track/` | THE backend: validates Telegram initData (HMAC) on every call, service-role DB access |
| `supabase/functions/bot/` | Webhook bot (@jpgmahjongbot): /start /open /help, group binding, fail-closed secret check |
| `supabase/schema.sql` | Complete reference schema (mirror of all applied migrations) |
| `supabase/migrations/` | Numbered migrations (0001 = baseline, 0002 = sessions/prefs/presets); apply new ones in the SQL editor BEFORE the matching function deploys |

## How each layer deploys

- **Front-end**: push to `main` → `.github/workflows/deploy.yml` → engine tests →
  `next build` (static export) → GitHub Pages. Env baked at build time from repo
  **variables** `TRACK_URL`, `BOT_APP_LINK` (+ `NEXT_PUBLIC_BASE_PATH=/mahjong-bot`).
- **Edge Functions**: push to `main` touching `supabase/**` →
  `.github/workflows/deploy-functions.yml` → `deno check` → `supabase functions
  deploy track bot` (needs repo secret `SUPABASE_ACCESS_TOKEN`; `verify_jwt=false`
  comes from `supabase/config.toml`). **Never paste-deploy from the dashboard.**
- **Schema**: paste SQL in the dashboard SQL editor (Supabase project ref
  `oybilfaofgekcscaoovg`). Keep `schema.sql` updated in the same commit.
- **Deploy order for coordinated changes: schema → function → front-end.**
  The client treats an "unknown op" error as version skew and degrades.

## Client–server contract

Every request is `POST { op, initData, ...payload }` to the `track` function;
the server validates `initData` (HMAC with the bot token, 24h freshness) and
derives the account id from it — nothing client-claimed is trusted. Every group
op returns the full canonical `TrackerState` (tracker + the ACTIVE session and
its actions + `debts` summed from everything ended + me + claimedNames), so the
client never merges deltas. Identity = Telegram account id; one global unique
`profiles.username` (auto-synced to the Telegram @handle until customized) +
`profiles.game_types` (first-run checklist; null = not chosen) +
`profiles.payout_presets`, plus a renamable per-group seat name in `members`.
Money lives in SESSIONS: one active per group (partial unique index), started
with its own payout config (or `settle=false` = log-only), ended manually or
lazily 24h after start; ended sessions freeze into the group debt counter.

## Gotchas / history

- Three identity-model pivots live in git history (`3a146e3` username →
  `975aac5` rename-only → `351bcef` username again + auto-sync). Balances are
  derived from the actions log, so they always sum to zero.
- `Play` polls every 2.5s (visibility-gated) with a **mutation epoch** guard —
  don't add a second write path that skips `record()`/`doRename()`.
- The bot's `TELEGRAM_BOT_TOKEN`-style secrets live in **Supabase function
  secrets** (`BOT_TOKEN`, `WEBHOOK_SECRET`), never in this repo or global env.
- `startapp` params are prefix-typed: `g<chatId>` = launched from a Telegram
  group; bare 6-char code = direct join link (alphabet excludes 0/O/1/I/L).
- Standing DON'Ts (with triggers) are at the end of
  [IMPROVEMENT-PLAN.md](IMPROVEMENT-PLAN.md): no state library, no Supabase
  Realtime, no sdk-react migration, no UI/E2E tests.

## Run locally

```
npm install
npm run dev    # http://localhost:3000 — tracker needs Telegram; Riichi calc works anywhere
npm test       # payout + scoring engine tests
```
