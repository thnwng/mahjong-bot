-- Group-synced mahjong trackers. Run this in the Supabase SQL editor.
-- All access goes through the `track` Edge Function using the service role,
-- which validates Telegram initData first. RLS is enabled with NO policies, so
-- the public anon key cannot read or write these tables directly.

create extension if not exists pgcrypto;

create table if not exists trackers (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,                 -- short share code (?startapp=)
  game        text not null default 'sg',           -- 'sg' for now
  name        text not null default '',
  players     jsonb not null default '[]',           -- ["Alice","Bob",...]; [] = stub, not set up yet
  bases       jsonb not null default '{"tai":0.1,"yao":0.2,"gang":0.2}',
  tg_chat_id  bigint,                                -- owning Telegram group (null = app-made group); NOT unique: a chat can own several groups
  created_at  timestamptz not null default now()
);

-- Migrations for upgrading an existing table:
alter table trackers add column if not exists tg_chat_id bigint;
-- A Telegram chat may own multiple groups, so drop the old unique constraint:
alter table trackers drop constraint if exists trackers_tg_chat_id_key;
create index if not exists trackers_tg_chat_idx on trackers (tg_chat_id);
-- Relax the not-null defaults (older stub-based flow):
alter table trackers alter column name set default '';
alter table trackers alter column name drop not null;
alter table trackers alter column players set default '[]';

create table if not exists actions (
  id          uuid primary key default gen_random_uuid(),
  tracker_id  uuid not null references trackers(id) on delete cascade,
  actioner    text not null,                         -- Telegram display name that entered it
  summary     text not null,
  transfers   jsonb not null,                        -- [{payer,payee,amount}]
  created_at  timestamptz not null default now()
);
create index if not exists actions_tracker_idx on actions (tracker_id, created_at);

-- Account-based membership: which Telegram user (account) belongs to which group,
-- so "your groups" follows the account across devices. user_id comes from the
-- server-validated initData, so it can't be forged.
create table if not exists members (
  id          uuid primary key default gen_random_uuid(),
  tracker_id  uuid not null references trackers(id) on delete cascade,
  user_id     bigint not null,                       -- Telegram account id
  name        text,                                  -- the PLAYER SEAT this account claimed
  created_at  timestamptz not null default now(),
  unique (tracker_id, user_id)                        -- one seat per account per group
);
create index if not exists members_user_idx on members (user_id, created_at);
alter table members enable row level security; -- no policies: only the Edge Function (service role) touches it
-- A seat is claimed by at most one account (named constraint = single source of truth).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_tracker_name_key') then
    alter table members add constraint members_tracker_name_key unique (tracker_id, name);
  end if;
end $$;

-- Atomic, race-safe append of a player to trackers.players (no lost updates).
-- Only the Edge Function (service role) may call it.
create or replace function add_player(p_id uuid, p_name text) returns void
  language sql security definer as $$
    update trackers set players = players || to_jsonb(p_name)
    where id = p_id and not (players ? p_name);
  $$;
revoke all on function add_player(uuid, text) from public, anon, authenticated;
grant execute on function add_player(uuid, text) to service_role;

alter table trackers enable row level security;
alter table actions  enable row level security;
-- No policies on purpose: the anon key gets nothing. The Edge Function uses the
-- service-role key (which bypasses RLS) after validating initData.
