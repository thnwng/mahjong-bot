-- 0002: sessions inside groups + per-account preferences + saved payout presets.
-- Run in the Supabase SQL editor BEFORE deploying the matching track function.

-- Which mahjong types this account plays (first-run checklist; null = not yet
-- chosen, so the app shows the checklist) + their saved payout presets
-- [{name, cfg}] for the session-setup dropdown.
alter table profiles add column if not exists game_types jsonb;
alter table profiles add column if not exists payout_presets jsonb not null default '[]';

-- What this group usually plays (asked at group creation; prefills sessions).
alter table trackers add column if not exists default_type text not null default 'sg4';

-- A session = one sitting at the table. Money is tallied per session; ended
-- sessions feed the group's running debt counter. At most ONE active session
-- per group (partial unique index). Sessions auto-end lazily 24h after start.
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  tracker_id   uuid not null references trackers(id) on delete cascade,
  mahjong_type text not null default 'sg4',           -- 'sg4' | 'my3' (my3 = WIP)
  bases        jsonb,                                  -- payout config for this session
  settle       boolean not null default true,          -- false = "ownself settle" (no payout tracking)
  started_by   text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists sessions_tracker_idx on sessions (tracker_id, started_at desc);
create unique index if not exists sessions_one_active on sessions (tracker_id) where ended_at is null;
alter table sessions enable row level security;  -- no policies: service role only

-- Actions belong to a session. null = legacy pre-session actions, which the
-- debt tally counts as already-ended history.
alter table actions add column if not exists session_id uuid references sessions(id) on delete set null;
create index if not exists actions_session_idx on actions (session_id);
