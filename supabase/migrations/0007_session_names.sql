-- 0007: optional per-session name.
--
-- A session can be named when it's started ("Friday night", "CNY 2026", …) so
-- the group's session-history list is readable. Null/empty = an unnamed sitting
-- (the history shows its date instead). No backfill — existing sessions stay null.

alter table sessions add column if not exists name text;

-- Atomic roster removal (mirrors add_player). Removes a name from trackers.players;
-- the edge function gates it (member-only, balance settled, not in the running
-- session) and also deletes the claimed member row. service_role only.
create or replace function remove_player(p_id uuid, p_name text) returns void
  language sql security definer as $$
    update trackers set players = coalesce(
      (select jsonb_agg(elem) from jsonb_array_elements(players) elem where elem <> to_jsonb(p_name)),
      '[]'::jsonb)
    where id = p_id;
  $$;
revoke all on function remove_player(uuid, text) from public, anon, authenticated;
grant execute on function remove_player(uuid, text) to service_role;
