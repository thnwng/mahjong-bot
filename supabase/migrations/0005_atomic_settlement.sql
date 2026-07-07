-- 0005 (2026-07-08): atomic debt settlement.
-- A "settle up" records a real-life repayment as a REVERSE transfer tagged
-- meta.k='settle' (see 0004 / schema.sql). Computing the outstanding net and
-- then inserting the reverse transfer in the edge function is racy: two people
-- tapping "Settle up" on the SAME debt at once both read the pre-insert net and
-- both insert, over-settling it (the debt flips). This moves the whole thing
-- into one security-definer function, serialized per tracker by a transaction
-- advisory lock, so a concurrent second settle blocks until the first commits
-- and then sees its effect. Returns the amount ACTUALLY settled (0 = the debt
-- was already clear, so nothing was inserted). Run in the SQL editor BEFORE the
-- matching track function deploys.
--
-- Identity gating (member + party to the debt) stays in the edge function — the
-- DB can't see which Telegram account is calling. This function only trusts the
-- names it is handed and enforces the money invariants (direction + cap).
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
  -- Serialize settlements for this tracker so the net read + insert is atomic.
  -- Released at end of transaction (each RPC call is its own transaction).
  perform pg_advisory_xact_lock(hashtext('settle:' || p_tracker::text)::bigint);

  -- Outstanding net from every transfer EXCEPT the live session's (you settle
  -- frozen debts from ended sittings, not an in-play game). "Live" is decided by
  -- ended_at IS NULL in THIS snapshot (a join, not a separately-read session id),
  -- so a session ending mid-call can't desync the read. Matches the edge
  -- function's debt tally and the app's debt counter.
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

  -- Only ever settle in the real direction (p_from a debtor, p_to a creditor)
  -- and never more than is outstanding on BOTH sides.
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
