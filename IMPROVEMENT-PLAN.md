# Build-quality improvement plan

Produced 2026-07-02 by a multi-agent review (4 dimensions, skeptic-verified) of the
whole codebase. Workspace-wide rules distilled from this review live in
`E:\Claude\telegram-mini-app-standard.md`. Items are phased by payoff-per-effort;
each was kept only if it fixes a pain this project actually hit.

## Status (updated 2026-07-05 against the repo; previous snapshot 2026-07-02)

- **DONE — Phase 1**: items 1-9 all shipped and live. Item 3's one-time
  caveat is resolved: the `SUPABASE_ACCESS_TOKEN` repo secret was set
  2026-07-02 and `deploy-functions.yml` has only green runs since (latest
  2026-07-03) — git push = function deploy.
- **DONE — Phase 2**: item 10 (numbered migrations ADOPTED, verified
  2026-07-05 — `supabase/migrations/` 0001_baseline / 0002_sessions_and_prefs /
  0003_display_name committed, process documented in CLAUDE.md, `schema.sql`
  frozen as reference), item 11 (bundled with the record-action wizard
  rebuild: `components/sg/` split + union `Screen`), item 13, and item 14
  (done superseded rather than as written: dark mode ships via the Halcyon
  `data-theme` boot mechanism — Telegram colorScheme on real launches, OS
  preference otherwise — instead of the planned `prefers-color-scheme`
  fallback block).
- **REOPENED (2026-07-05 re-audit)**: item 12 (unified `fail()` error
  contract in `track`) was marked done in the 2026-07-02 snapshot, but no
  such helper exists in `supabase/functions/track/index.ts` — only the
  catch-all `console.error` landed. Per Phase-2 discipline, bundle it with
  the next real `track` change; do not run it as a standalone sprint.
- **OPEN**: all of Phase 3 (trigger-gated — do not do early).

## Phase 1 — do next (two security fixes + self-enforcing guardrails)

1. **[SECURITY] Close the `setup-group` hole** (`supabase/functions/track/index.ts`).
   The op updates a group by code alone — no `userId` check, no stub-state check —
   and no client code calls it anymore (leftover from the pre-pivot design). Anyone
   with a leaked 6-char code could overwrite a live group's roster/stakes, orphaning
   history. Fix: delete the op (preferred) or require auth + `players = '[]'`
   precondition in the WHERE clause. *(tiny)*
2. **[SECURITY] Make the bot webhook secret check fail closed**
   (`supabase/functions/bot/index.ts`). Today an unset `WEBHOOK_SECRET` accepts all
   forged updates. Reject when the secret is missing OR the
   `x-telegram-bot-api-secret-token` header mismatches. *(tiny)*
3. **Deploy Edge Functions from git via CI.** New `deploy-functions.yml` job:
   `supabase/setup-cli` → `supabase functions deploy track bot --project-ref <ref>`
   with `SUPABASE_ACCESS_TOKEN` repo secret; commit `supabase/config.toml` with
   `verify_jwt = false` for both functions; delete the paste instructions from
   SUPABASE_SETUP.md. Ends dashboard-paste drift: git push = deploy. *(small,
   highest payoff in the plan)*
4. **CI compile gate for the functions:** `deno check` on both function files before
   deploy (tsconfig excludes `supabase/`, so they currently have zero type checking).
   *(tiny)*
5. **Unit tests for the money engines only:** vitest; `lib/sg/payout.test.ts`
   (against the sgmahjong.club table) + `lib/riichi/scoring.test.ts` (known han/fu →
   points cases). Run before `next build` in the deploy job. Explicitly no UI/E2E
   tests. *(small)*
6. **Root `CLAUDE.md`** (workspace convention): structure map, how each layer
   deploys, the client-server contract in 3 sentences, pivot history + the
   schema→function→client deploy-order rule. Trim README.md (its Status section
   still calls the deployed tracker a TODO). *(small)*
7. **`.env.example`** with `NEXT_PUBLIC_TRACK_URL`, `NEXT_PUBLIC_BOT_APP_LINK`,
   `NEXT_PUBLIC_BASE_PATH` + pointers to where BOT_TOKEN/WEBHOOK_SECRET live. Replace
   the real-looking token prefix in SUPABASE_SETUP.md with an obvious placeholder.
   *(tiny)*
8. **Safe-area CSS** for the fixed bottom button:
   `bottom: calc(16px + max(env(safe-area-inset-bottom, 0px), var(--tg-safe-area-inset-bottom, 0px)))`
   + matching body padding. Fixes the iPhone home-indicator overlap. *(tiny)*
9. **SDK decision comment** at the top of `lib/telegram.ts`: this wrapper is the
   standard; adopt `@telegram-apps/sdk-react` only if a needed feature falls outside
   it. Stops future sessions relitigating the migration. *(tiny)*

## Phase 2 — structural (bundle with real work, not as refactor sprints)

10. **Numbered migrations:** copy current schema as
    `supabase/migrations/0001_baseline.sql` (hand-written; avoid `db pull` — needs
    Docker), `supabase migration repair` to mark applied, every future change a new
    numbered file via `supabase db push`. Freeze `schema.sql` as reference. *(medium)*
11. **Split `SGGame.tsx` alongside the next feature:** `components/sg/` →
    Home/Identity/Join/Setup/Play; collapse the six routing booleans into one
    discriminated-union `Screen`; extract the duplicated group-list block; single
    exported username rule in `remote.ts` with a sync-pointer comment server-side;
    replace the one `alert()` with inline error; `.err`/`.hint` classes. *(small)*
12. **Unified error contract in `track`:** one `fail(msg, status, detail?)` helper —
    human sentence to the client, real error to `console.error`. Stops raw Postgres
    text reaching users/probers. *(tiny)*
13. **Visibility-gated polling:** skip the 2.5s tick when
    `document.visibilityState !== "visible"`; refresh once on return. Saves ~24
    invocations/min per idle phone. *(tiny)*
14. **Dark-mode fallbacks:** `prefers-color-scheme: dark` block overriding the
    `--tg-theme-*` fallbacks (real Telegram vars still win); hoist `#e54848`/`#1f9d55`
    into `--neg`/`--pos`. *(tiny)*

## Phase 3 — only when triggered (recorded so they don't get done early)

15. **`useTrackerSync` hook** (poll + epoch + mutate) — extract at the THIRD
    mutation, not before; preserve rename's keep-editor-open-on-error behavior.
16. **Op-registry shape for `track`** — piggyback on the next real op change, never
    a standalone rewrite; add structural `UNKNOWN_OP` code then too.
17. **Poll delta cursor** (`after` + `roster_version`) — only when a real group's
    history makes polls heavy; reserve the column in the next migration.

## Standing DON'Ts (spend zero effort on these)

- No Context/Redux/Zustand (useState + props under ~10 screens).
- No Supabase Realtime (forces RLS policies the service-role model avoids).
- No `@telegram-apps/sdk-react` migration (see decision comment criterion).
- No UI/E2E test suite.
