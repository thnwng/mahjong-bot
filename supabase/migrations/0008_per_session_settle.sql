-- 0008 (2026-07-11): per-session settlement.
-- A repayment now clears a SPECIFIC session's debt and carries that session_id
-- (was null). This makes a session self-contained: deleting it removes its game
-- rows AND its repayments together, cleanly, with no session-agnostic settlement
-- left to orphan into a phantom/refund debt (the 2026-07-11 delete-session
-- review). Aggregate balances are unchanged — a session-tagged reverse transfer
-- still nets the same way.
--
-- This adds a 6-arg OVERLOAD of settle_debt (the old 5-arg aggregate version
-- from 0005 stays, so the currently-deployed function keeps working until the
-- new one deploys, and old repayments made before this ships remain valid).
-- Same per-tracker advisory lock; the net is scoped to the one session's rows.
-- Run in the SQL editor BEFORE the matching track function deploys.
create or replace function settle_debt(
  p_tracker uuid, p_from text, p_to text, p_amount numeric, p_actioner text, p_session uuid
) returns numeric
  language plpgsql security definer as $$
declare
  v_owe    numeric;   -- how much p_from still owes WITHIN this session
  v_owed   numeric;   -- how much p_to is still owed WITHIN this session
  v_cap    numeric;
  v_amt    numeric;
begin
  perform pg_advisory_xact_lock(hashtext('settle:' || p_tracker::text)::bigint);

  -- Outstanding net from this session's rows only (its games + its own prior
  -- repayments, all carrying session_id = p_session).
  with tx as (
    select e
    from actions a, lateral jsonb_array_elements(a.transfers) e
    where a.tracker_id = p_tracker and a.session_id = p_session
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
    p_tracker, p_session, p_actioner,
    p_from || ' settled up with ' || p_to || ' (' || to_char(v_amt, 'FM999999990.00') || ')',
    jsonb_build_array(jsonb_build_object('payer', p_to, 'payee', p_from, 'amount', v_amt)),
    jsonb_build_object('k', 'settle', 'from', p_from, 'to', p_to)
  );
  return v_amt;
end $$;
revoke all on function settle_debt(uuid, text, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function settle_debt(uuid, text, text, numeric, text, uuid) to service_role;
