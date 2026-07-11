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
| `app/` | Next.js 15 App Router shell. Styling = the **Halcyon design system**: `app/halcyon.css` (vendored tokens from `E:\Claude\halcyon-ds`) + `globals.css` (classes driven by Halcyon tokens/fonts/radii/shadows). Light/dark set on `<html data-theme>` — follows Telegram's colorScheme on a real launch, else the OS (`layout.tsx` boot script + `lib/telegram.ts`); accent `data-accent="slate"`. Re-vendor by re-concatenating the halcyon-ds token files into `app/halcyon.css`. |
| `components/SGGame.tsx` | Tracker **router + home** (boot gates: username → game-types checklist; game-type dropdown; groups w/ balances + manual reorder; deep links; screen union) |
| `components/sg/` | Screens: `Identity` (username + game-types gates), `Settings`, `Join` (enter a group code → opening it JOINS you), `Setup` (create group — just a **name + usual-type**; roster + payouts come later), `Group` (**share link + ROSTER** (add placeholder names, "this is me" to claim a seat), debt counter, **Who-owes-who with a Settle-up button** (a party to a debt clears it — records a repayment), **All-time tally** (career win/loss + games, separate from outstanding debt), a Settled-up audit list, session banner, and `NewSession`: **one-page type → who's-playing subset → payouts**), `PayoutEditor` (the per-tai Zimo/Shoot table + scheme dropdown + bite/gang/self-draw-bonus — used at session start), `Play` (session balances, log, **record-action wizard** — Hu/Zimo/Gang/Yao with open-vs-concealed + the "X shoot Y" transfer selector), `SGTiles` (SG/Msia tile picker — "Tai calculator"; picker only, scoring not wired yet), `InfoDot` (tap-to-reveal "?" help bubbles), `SGTaiHands` (standalone **winning-hands tai reference**: every scoring hand type shown schematically with tile art + editable tai; Special & limit section defaults to **限+1**; reachable from the home or `?type=sgtai`), `GroupSettings` (**per-group scoring menu** — a gear on each home row **and** a button inside the group page; its Scoring subtab sets each hand's tai via a **0–10 / Max tai 限 / Special 限+1 dropdown**, stored **on the group** (`trackers.tai_scores`, migration 0006) so every member shares it — loaded read-only via `getState`, saved with an explicit **Save** button (`set-tai` op; one write, member-gated)), `taiCatalog.tsx` (the shared hand catalog + defaults + `TAI_OPTIONS` — one source of truth for both tai pages) |
| `components/RiichiCalculator.tsx`, `TilesMode.tsx`, `ResultCard.tsx` | Riichi calculator UI. `TilesMode` renders real tile art from `public/tiles/jp/` (basePath-prefixed) |
| `public/tiles/` | Tile PNG art (downscaled): `jp/` (Riichi), `sg/` (Singaporean, incl. flowers/seasons). Filenames = engine code + set prefix (jp1C.png, sgEW.png) |
| `lib/telegram.ts` | The one Telegram wrapper (typed CDN script: haptics, back-button stack, closing confirmation). **Do not migrate to @telegram-apps/sdk-react** — see the decision comment at its top |
| `lib/sg/payout.ts` | SG money engine (pure; unit-tested in `payout.test.ts`). `PayoutConfig` incl. `zimoBonus` (flat per-pax self-draw bonus) |
| `lib/sg/actions.ts` | Pure record-action wizard logic (`stepsFor`/`buildResult`): concealed anyao/angang doubling, gang-shoot pao (shooter pays nOther×), the shoot selector. **Unit-tested in `actions.test.ts`** (the money paths) — no React/Telegram imports so it stays testable |
| `lib/sg/remote.ts` | Client API layer: `{op, initData}` calls to the `track` function; localStorage caches; `USERNAME_RE` (the single client copy) |
| `lib/riichi/` | Riichi engine: `analyze.ts` (hand decomposition), `yaku.ts`, `scoring.ts` (unit-tested) |
| `supabase/functions/track/` | THE backend: validates Telegram initData (HMAC) on every call, service-role DB access |
| `supabase/functions/bot/` | Webhook bot (@jpgmahjongbot): /start /open /help, group binding, fail-closed secret check |
| `supabase/schema.sql` | Complete reference schema (mirror of all applied migrations) |
| `supabase/migrations/` | Numbered migrations (0001 = baseline, 0002 = sessions/prefs/presets, 0003 = display-name (drop username uniqueness), 0004 = link-first groups: `sessions.players` + `members.name` nullable + `rename_player` follows into sessions; 0005 = atomic `settle_debt()` RPC for debt settlement; 0006 = `trackers.tai_scores` jsonb for per-group winning-hand scoring; 0007 = `sessions.name` + `remove_player` RPC for the group-screen rebuild); apply new ones in the SQL editor BEFORE the matching function deploys |

## Branch topology (as of 2026-07-10 — mirrors the Clabbers rule)

- **`main` = the DEPLOYED app.** Any push to `main` triggers BOTH deploy
  workflows: the Pages site and the Supabase Edge Functions (the real-money
  backend). Pushing `main` is the deploy button, not a code drop.
- **`develop` = the integration trunk.** All day-to-day work lands here.
  **When the owner says "commit and push", that means `develop` — NEVER
  `main` unless he explicitly says so.** Pushing `develop` deploys nothing
  (both workflows trigger on `main` only).
- **Promotion `develop` → `main` is a deliberate, owner-approved act** (merge
  develop into main, push). For coordinated changes the deploy order below
  still applies — apply schema migrations BEFORE promoting.

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
its actions + `debts` summed from everything ended + me + isMember + claimedNames),
so the client never merges deltas. Identity = Telegram account id; one global unique
`profiles.username` (auto-synced to the Telegram @handle until customized) +
`profiles.game_types` (first-run checklist; null = not chosen) +
`profiles.payout_presets`, plus a renamable per-group seat name in `members`.
**Groups (0004) are LINK-FIRST**: a group starts with an EMPTY roster + a share
code; opening its link makes you an UNSEATED member (`members.name` null), anyone
in the group can add placeholder names (`trackers.players`, the ROSTER, uncapped
to 12), and claiming a seat fills your member row. `me` = your claimed seat (null
if unseated); `isMember` = you're in the group. Money lives in SESSIONS: one
active per group (partial unique index), started by any member with **the 3-4
roster names actually playing** (`sessions.players`; 4 for sg4, 3 for my3) + its
own payout config (or `settle=false` = log-only); an action's transfers are
validated against `sessions.players` (fallback: the whole roster for legacy
session-less rows). Ended manually or lazily 24h after start; ended sessions
freeze into the group debt counter. Every group op also returns `allTime` (career
win/loss per name, **excluding** settlements), `games` (ended sessions per name),
and `settlements` (recent repayments). A **settlement** (`settle` op) is a real-life
repayment: a reverse transfer tagged `meta.k='settle'` — only a party to the debt
may record it, the amount is clamped to what's outstanding, and it nets out of
`debts` but never moves `allTime`. It's a plain action row, so **no migration**.

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
- **Destructive money ops (2026-07-11 group rebuild)**: `remove-player`,
  `delete-session`, `settle-all` require a SEATED member (`info.me`, not just
  isMember) + money-safety guards — remove-player rejects a name with a non-zero
  balance or one in the running session; **delete-session (as of 2026-07-11)
  refuses an ENDED session while the group's `debts` are non-zero** (a
  "settle the debts first" 409, gated on the canonical `groupState().debts`; the
  client shows a notice instead of arming the trash). An ACTIVE session just
  cancels (its actions never reached the debt counter). Once squared up, delete
  removes **only this session's game rows — NEVER the session-agnostic
  settlements** (`meta.k='settle'`, `session_id` null). A brief attempt (same
  day) to also wipe settlements, guarded by a `post==0` post-check, was REVERTED
  after an adversarial review found it could **erase a real debt** (two other
  sessions offsetting, one settled/one not → wiping all settlements masked the
  unpaid one) and **permanently lock offsetting sessions** as undeletable. So a
  settled session now leaves a correct **refund owed** on delete; making it
  vanish cleanly needs per-session settlement tagging (**pending full fix** — a
  migration). Regression-tested in `lib/sg/localBackend.delete.test.ts`. The
  LINK-FIRST peer-trust model still holds: any seated member can run these — a
  documented product decision, not an owner role.
- Standing DON'Ts (with triggers) are at the end of
  [IMPROVEMENT-PLAN.md](IMPROVEMENT-PLAN.md): no state library, no Supabase
  Realtime, no sdk-react migration, no UI/E2E tests.
- **OFFLINE dev mode** (folded in from the retired `mahjong-web-offline` fork,
  2026-07-10): `NEXT_PUBLIC_OFFLINE=true` makes the app run entirely in the
  browser with no Telegram/Supabase — `lib/sg/remote.ts` routes every `call()`
  to `lib/sg/localBackend.ts` (a localStorage backend) and `components/DevBar.tsx`
  switches fake players. It's **dev-only**: `OFFLINE` is a build-time constant
  that's false in production (CI never sets `NEXT_PUBLIC_OFFLINE`), and the
  backend/DevBar/`RiichiGame` are lazy-loaded so they're NOT in the production
  bundle. The `?type=riichigame` route (a WIP Riichi *game* tracker,
  `components/riichi/RiichiGame.tsx` + `lib/riichi/game.ts`) is OFFLINE-gated.

## Run locally

```
npm install
npm run dev                         # http://localhost:3000 — tracker needs Telegram; Riichi calc works anywhere
$env:NEXT_PUBLIC_OFFLINE='true'; npm run dev   # browser-testable: local backend + DevBar, no Telegram (dev only)
npm test                            # payout + Riichi + scoring engine tests
```
