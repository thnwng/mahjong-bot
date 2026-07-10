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
  tai_scores  jsonb,                                 -- per-group winning-hand tai values {handId:value}; null = app defaults (0006)
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
  summary     text not null,                         -- frozen text (fallback for pre-meta rows)
  transfers   jsonb not null,                        -- [{payer,payee,amount}]
  meta        jsonb,                                 -- {k, tai?, winner?/discarder?/konger?/payer?/biter?/target?}; lets the log render CURRENT names. A SETTLEMENT is just an action: meta.k='settle' + {from,to}, transfers=[{payer:creditor,payee:debtor,amount}] (a reverse transfer that nets out of the debt counter but is skipped by the all-time tally). No separate table.
  created_at  timestamptz not null default now()
);
create index if not exists actions_tracker_idx on actions (tracker_id, created_at);
alter table actions add column if not exists meta jsonb; -- migration for existing tables

-- Account-based membership: which Telegram user (account) belongs to which group,
-- so "your groups" follows the account across devices. user_id comes from the
-- server-validated initData, so it can't be forged.
create table if not exists members (
  id          uuid primary key default gen_random_uuid(),
  tracker_id  uuid not null references trackers(id) on delete cascade,
  user_id     bigint not null,                       -- Telegram account id
  name        text,                                  -- the PLAYER SEAT this account claimed; NULL = unseated member (0004)
  created_at  timestamptz not null default now(),
  unique (tracker_id, user_id)                        -- one seat per account per group
);
create index if not exists members_user_idx on members (user_id, created_at);
alter table members enable row level security; -- no policies: only the Edge Function (service role) touches it
alter table members alter column name drop not null; -- 0004: unseated members (opened the link, no seat yet) have name null
-- A seat is claimed by at most one account (named constraint = single source of truth).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_tracker_name_key') then
    alter table members add constraint members_tracker_name_key unique (tracker_id, name);
  end if;
end $$;

-- Atomic, race-safe append of a player to trackers.players (no lost updates).
-- Dedups by name and enforces the ROSTER_MAX=12 cap in-statement (0004) so a
-- concurrent add can't exceed it. Only the Edge Function (service role) calls it.
create or replace function add_player(p_id uuid, p_name text) returns void
  language sql security definer as $$
    update trackers set players = players || to_jsonb(p_name)
    where id = p_id and not (players ? p_name) and jsonb_array_length(players) < 12;
  $$;
revoke all on function add_player(uuid, text) from public, anon, authenticated;
grant execute on function add_player(uuid, text) to service_role;

-- One profile per Telegram account. `username` is a DISPLAY NAME (a plain
-- label, NOT unique — the old unique index was dropped in migration 0003;
-- the column name is kept as `username`). Seeded from the user's Telegram
-- display name; `auto_sync` = keep mirroring that Telegram name until the user
-- pins a custom one. Independent of the per-group SEAT names in `members`
-- (a seat defaults to this name at join but is still renamable per group).
create table if not exists profiles (
  user_id    bigint primary key,                  -- Telegram account id (from validated initData)
  username   text not null,                        -- display name (not unique)
  auto_sync  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Migrations for an existing/older profiles table:
alter table profiles add column if not exists auto_sync boolean not null default true;
alter table profiles add column if not exists updated_at timestamptz not null default now();
-- 0003: display names are not unique — drop the old case-insensitive unique index.
drop index if exists profiles_username_lc_key;
alter table profiles enable row level security;   -- no policies: only the Edge Function (service role) touches it

-- Rename the caller's seat within a group (the per-group display name).
-- Atomically rewrites: members.name (the seat), trackers.players (the roster
-- string), and every actions.transfers payer/payee — so historical balances
-- stay attributed to the renamed player. actions.summary keeps its original
-- text as a historical record. Order is preserved. service_role only.
create or replace function rename_player(p_id uuid, p_user bigint, p_old text, p_new text)
  returns void language plpgsql security definer as $$
begin
  update members set name = p_new where tracker_id = p_id and user_id = p_user;
  update trackers set players = coalesce((
    select jsonb_agg(case when elem = to_jsonb(p_old) then to_jsonb(p_new) else elem end order by ord)
    from jsonb_array_elements(players) with ordinality as t(elem, ord)
  ), '[]'::jsonb) where id = p_id;
  update actions set transfers = coalesce((
    select jsonb_agg(
      case
        when (e->>'payer') = p_old and (e->>'payee') = p_old
          then jsonb_set(jsonb_set(e, '{payer}', to_jsonb(p_new)), '{payee}', to_jsonb(p_new))
        when (e->>'payer') = p_old then jsonb_set(e, '{payer}', to_jsonb(p_new))
        when (e->>'payee') = p_old then jsonb_set(e, '{payee}', to_jsonb(p_new))
        else e
      end order by ord)
    from jsonb_array_elements(transfers) with ordinality as t(e, ord)
  ), '[]'::jsonb) where tracker_id = p_id;
  -- Rewrite the player-role fields inside actions.meta (exact match only, so no
  -- free-text substring hazard) — keeps the rendered log on current names.
  update actions set meta = (
    select jsonb_object_agg(key,
      case when key in ('winner','discarder','konger','payer','biter','target','from','to') and value = to_jsonb(p_old)
           then to_jsonb(p_new) else value end)
    from jsonb_each(meta)
  ) where tracker_id = p_id and meta is not null; -- 'from'/'to' = settlement labels (0005)
  -- 0004: follow the rename into sessions — the playing list + who started it,
  -- so a mid-session rename keeps the active sitting attributed to the player.
  update sessions set players = coalesce((
    select jsonb_agg(case when elem = to_jsonb(p_old) then to_jsonb(p_new) else elem end order by ord)
    from jsonb_array_elements(players) with ordinality as t(elem, ord)
  ), '[]'::jsonb) where tracker_id = p_id;
  update sessions set started_by = p_new where tracker_id = p_id and started_by = p_old;
end $$;
revoke all on function rename_player(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function rename_player(uuid, bigint, text, text) to service_role;

-- 0005: atomic debt settlement. Records a real-life repayment as a REVERSE
-- transfer tagged meta.k='settle', computing the outstanding net + clamp + insert
-- in ONE security-definer function serialized per tracker (a transaction advisory
-- lock), so two people settling the same debt at once can't over-settle it.
-- Returns the amount actually settled (0 = already clear). Identity gating
-- (member + party to the debt) is the edge function's job. service_role only.
create or replace function settle_debt(
  p_tracker uuid, p_from text, p_to text, p_amount numeric, p_actioner text
) returns numeric
  language plpgsql security definer as $$
declare
  v_owe    numeric;   -- how much p_from still owes overall (paid out - taken in)
  v_owed   numeric;   -- how much p_to is still owed overall (taken in - paid out)
  v_cap    numeric;
  v_amt    numeric;
begin
  perform pg_advisory_xact_lock(hashtext('settle:' || p_tracker::text)::bigint);
  -- "Live" session decided by ended_at IS NULL in this snapshot (a join), so a
  -- session ending mid-call can't desync the net read.
  with tx as (
    select e
    from actions a
    left join sessions s on s.id = a.session_id,
    lateral jsonb_array_elements(a.transfers) e
    where a.tracker_id = p_tracker
      and (a.session_id is null or s.ended_at is not null)
  )
  select
    coalesce(sum(case when e->>'payer' = p_from then (e->>'amount')::numeric else 0 end)
           - sum(case when e->>'payee' = p_from then (e->>'amount')::numeric else 0 end), 0),
    coalesce(sum(case when e->>'payee' = p_to   then (e->>'amount')::numeric else 0 end)
           - sum(case when e->>'payer' = p_to   then (e->>'amount')::numeric else 0 end), 0)
  into v_owe, v_owed
  from tx;
  v_cap := least(v_owe, v_owed);
  if v_cap is null or v_cap <= 0.004 then return 0; end if;
  v_amt := least(p_amount, v_cap);
  if v_amt <= 0 then return 0; end if;
  insert into actions (tracker_id, session_id, actioner, summary, transfers, meta)
  values (
    p_tracker, null, p_actioner,
    p_from || ' settled up with ' || p_to || ' (' || to_char(v_amt, 'FM999999990.00') || ')',
    jsonb_build_array(jsonb_build_object('payer', p_to, 'payee', p_from, 'amount', v_amt)),
    jsonb_build_object('k', 'settle', 'from', p_from, 'to', p_to)
  );
  return v_amt;
end $$;
revoke all on function settle_debt(uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function settle_debt(uuid, text, text, numeric, text) to service_role;

alter table trackers enable row level security;
alter table actions  enable row level security;
-- No policies on purpose: the anon key gets nothing. The Edge Function uses the
-- service-role key (which bypasses RLS) after validating initData.

-- ---------------------------------------------------------------------------
-- 0002 (2026-07-03): sessions + per-account preferences + saved payout presets.
-- (Kept in supabase/migrations/0002_sessions_and_prefs.sql; mirrored here so
-- this file stays the complete reference schema.)

alter table profiles add column if not exists game_types jsonb;                     -- null = first-run checklist not done
alter table profiles add column if not exists payout_presets jsonb not null default '[]';
alter table trackers add column if not exists default_type text not null default 'sg4';
alter table trackers add column if not exists tai_scores jsonb;                     -- per-group scoring (0006)

create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  tracker_id   uuid not null references trackers(id) on delete cascade,
  mahjong_type text not null default 'sg4',           -- 'sg4' | 'my3' (my3 = WIP)
  players      jsonb not null default '[]',            -- the 3-4 roster names playing this sitting (0004)
  bases        jsonb,                                  -- payout config for this session
  settle       boolean not null default true,          -- false = "ownself settle" (no payout tracking)
  started_by   text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists sessions_tracker_idx on sessions (tracker_id, started_at desc);
create unique index if not exists sessions_one_active on sessions (tracker_id) where ended_at is null;
alter table sessions enable row level security;
alter table sessions add column if not exists players jsonb not null default '[]'; -- 0004

alter table actions add column if not exists session_id uuid references sessions(id) on delete set null;
create index if not exists actions_session_idx on actions (session_id);
