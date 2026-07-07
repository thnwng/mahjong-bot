-- 0004 (2026-07-08): link-first groups + per-session player subset.
-- A group now starts with an EMPTY roster and a share code; names are added on
-- the group page (placeholders anyone in the group can add), and a member's seat
-- name stays NULL until they claim one. Payouts move to session start, and each
-- session records the 3-4 roster names actually playing that sitting.
-- Run in the Supabase SQL editor BEFORE deploying the matching track function.

-- members.name is the claimed SEAT; it is null for an unseated member (someone
-- who has joined the group but not yet claimed a name). It was created nullable,
-- and the unique (tracker_id, name) constraint already permits multiple NULLs
-- (SQL nulls are distinct), so many unseated members can coexist. This alter is
-- a safety no-op that guarantees the column is nullable on any older instance.
alter table members alter column name drop not null;

-- The 3-4 roster names actually playing a given sitting. '[]' on legacy sessions
-- (the action validator falls back to the full roster when it is empty).
alter table sessions add column if not exists players jsonb not null default '[]';

-- Freeze any session that is ACTIVE right now: pin its players to the current
-- roster. Pre-0004 a group's roster WAS the sitting (capped at 4), and this runs
-- BEFORE the new function deploys, so at this instant the roster is still the
-- exact 3-4 who are playing. Without this, an in-flight session keeps players
-- '[]' and the action validator falls back to the (now uncapped, growable)
-- roster — so a name added mid-session would be charged for a sitting it never
-- joined. Ended sessions keep '[]' (their debts come from frozen transfers, not
-- from players) and are intentionally untouched.
update sessions s set players = t.players
  from trackers t
  where s.tracker_id = t.id and s.ended_at is null and s.players = '[]'::jsonb;

-- Harden the roster cap against a concurrent-add race: enforce ROSTER_MAX (12)
-- INSIDE the atomic append, because the edge function's JS cap check reads a
-- stale count so two simultaneous add-name/join-new calls could otherwise push
-- the roster past 12. Keep the 12 in sync with ROSTER_MAX in the edge function.
-- Otherwise unchanged from 0001/schema: dedups by name; service_role only.
create or replace function add_player(p_id uuid, p_name text) returns void
  language sql security definer as $$
    update trackers set players = players || to_jsonb(p_name)
    where id = p_id and not (players ? p_name) and jsonb_array_length(players) < 12;
  $$;
revoke all on function add_player(uuid, text) from public, anon, authenticated;
grant execute on function add_player(uuid, text) to service_role;

-- Extend rename_player to ALSO follow a rename into the sessions table: the
-- active sitting's player list and its started_by label. Everything else is
-- unchanged from the 0002/schema definition (members.name, trackers.players,
-- actions.transfers, actions.meta).
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
  update actions set meta = (
    select jsonb_object_agg(key,
      case when key in ('winner','discarder','konger','payer','biter','target','from','to') and value = to_jsonb(p_old)
           then to_jsonb(p_new) else value end)
    from jsonb_each(meta)
  ) where tracker_id = p_id and meta is not null; -- 'from'/'to' = settlement labels (0005)
  -- Follow the rename into sessions: the playing list + who started it, so a
  -- mid-session rename keeps the active sitting attributed to the renamed player.
  update sessions set players = coalesce((
    select jsonb_agg(case when elem = to_jsonb(p_old) then to_jsonb(p_new) else elem end order by ord)
    from jsonb_array_elements(players) with ordinality as t(elem, ord)
  ), '[]'::jsonb) where tracker_id = p_id;
  update sessions set started_by = p_new where tracker_id = p_id and started_by = p_old;
end $$;
revoke all on function rename_player(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function rename_player(uuid, bigint, text, text) to service_role;
