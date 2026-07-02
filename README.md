# mahjong-web

A Telegram Mini App for mahjong, live at https://thnwng.github.io/mahjong-bot/
(bot: **@jpgmahjongbot**):

- **Singaporean tracker** — group-synced running balances (Hu / Zimo / Gang /
  Yao recorded through a step-by-step wizard), shared via 6-char codes or a
  Telegram group's own bot button. Backend = one Supabase Edge Function that
  validates Telegram `initData`; see [SUPABASE_SETUP.md](SUPABASE_SETUP.md).
- **Riichi hand calculator** — tiles / manual / yaku entry, fully client-side.

Built as a **client-side web app** (no `sendData`) so it works from any launch
method — menu button, Main Mini App, direct links, and groups.

## Stack

- **Next.js 15** (App Router) + **React 19** + TypeScript, `output: "export"`
  (static) — deployed to GitHub Pages by CI on every push.
- Telegram WebApp script loaded from the CDN behind one typed wrapper
  (`lib/telegram.ts`): initData, haptics, native back button, closing
  confirmation.
- Supabase Edge Functions (`track` = API, `bot` = webhook), also deployed from
  git by CI.

For the file-by-file map, deploy pipelines, and project conventions, see
[CLAUDE.md](CLAUDE.md).

## Run / build

```
npm install
npm run dev      # http://localhost:3000 (Riichi calc works in a plain browser)
npm test         # payout + scoring engine tests
npm run build    # static export to ./out
```
