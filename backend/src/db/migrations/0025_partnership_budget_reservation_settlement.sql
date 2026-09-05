-- Closes a real gap in migration 0024's reservation design: a `finally`
-- release or the 300s expiry alone can't distinguish "nothing was ever
-- spent" from "a call was dispatched (and possibly billed by Anthropic/X)
-- but our own process never got the chance to record its cost" -- a
-- request that times out, whose process is killed by the platform mid-
-- flight, or whose recordCostEvent write itself silently fails. Before
-- this migration, an unreleased reservation either sat open forever (if
-- release() never ran) or simply stopped counting after expiry -- in
-- either case, a genuinely-incurred-but-unrecorded cost could vanish from
-- budget enforcement.
--
-- New design: reserve_partnership_budget now SETTLES any reservation past
-- its expiry into a real, conservative cost_events row (the full ceiling
-- amount) BEFORE computing actual/reserved totals, tagged with
-- context.settledReservationId. This means an abandoned reservation
-- converts into counted spend instead of silently freeing budget --
-- erring toward under-spending safety, per this task's own instruction to
-- "retain a conservative outstanding charge... until safely reconciled."
--
-- If the reservation's owning request DOES eventually finish (the
-- `finally` block runs after all, even past expiry) and calls
-- release_partnership_budget_reservation with
-- p_confirmed_real_cost_recorded = true (meaning real cost_events rows
-- were actually recorded for that same attempt), the earlier conservative
-- settlement charge is deleted -- the real recorded cost supersedes the
-- conservative estimate, so nothing is double-counted. If no real cost
-- was ever recorded for that attempt, the conservative charge is
-- deliberately left in place: there's no positive evidence disproving a
-- real charge occurred, so the safer assumption is kept.
--
-- Both functions now take the same advisory lock, closing a narrow race
-- where a late release() could read settled_as_charge before a
-- concurrent settlement pass had a chance to set it.

alter table partnership_budget_reservations add column settled_as_charge boolean not null default false;

comment on column partnership_budget_reservations.settled_as_charge is 'True once this reservation was converted into a real, conservative cost_events charge (see reserve_partnership_budget) because it expired before its owning request called release. A later confirmed-real-cost release reverses that charge; otherwise it stays, favoring under-spending safety over precision for a call whose true cost is genuinely unknown.';

create or replace function reserve_partnership_budget(
  p_amount_usd numeric,
  p_bucket text,
  p_prospect_id uuid,
  p_bucket_budget_usd numeric,
  p_total_budget_usd numeric,
  p_expiry_seconds integer default 300
) returns table(reservation_id uuid, eligible boolean, reason text)
language plpgsql as $$
declare
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_month_end timestamptz := v_month_start + interval '1 month';
  v_bucket_event_types text[];
  v_actual_bucket numeric;
  v_actual_total numeric;
  v_reserved_bucket numeric;
  v_reserved_total numeric;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('partnership_budget'));

  -- Settle any reservation abandoned past its expiry into a real,
  -- conservative charge BEFORE computing totals below.
  insert into cost_events (event_type, provider, model, input_tokens, output_tokens, cost_usd, context)
  select
    case r.bucket when 'discovery' then 'partnership_x_search_read' else 'partnership_llm_call' end,
    case r.bucket when 'discovery' then 'x' else 'anthropic' end,
    case r.bucket when 'discovery' then 'search/recent' else 'reservation-settlement' end,
    0, 0, r.amount_usd,
    jsonb_build_object('settledReservationId', r.id, 'reason', 'expired_unreleased_reservation_conservatively_settled')
  from partnership_budget_reservations r
  where r.released_at is null
    and r.created_at <= now() - make_interval(secs => p_expiry_seconds);

  update partnership_budget_reservations
    set released_at = now(), settled_as_charge = true
    where released_at is null
      and created_at <= now() - make_interval(secs => p_expiry_seconds);

  v_bucket_event_types := case p_bucket
    when 'discovery' then array['partnership_x_search_read']
    when 'generation' then array['partnership_llm_call']
    else array[]::text[]
  end;

  select coalesce(sum(cost_usd), 0) into v_actual_bucket
  from cost_events
  where event_type = any(v_bucket_event_types)
    and created_at >= v_month_start and created_at < v_month_end;

  select coalesce(sum(cost_usd), 0) into v_actual_total
  from cost_events
  where event_type in ('partnership_llm_call', 'partnership_x_search_read')
    and created_at >= v_month_start and created_at < v_month_end;

  -- Expiry is now handled entirely by the settlement pass above, so a
  -- plain released_at is null check is correct here (nothing left open
  -- can be stale by definition).
  select coalesce(sum(amount_usd), 0) into v_reserved_bucket
  from partnership_budget_reservations
  where released_at is null
    and bucket = p_bucket;

  select coalesce(sum(amount_usd), 0) into v_reserved_total
  from partnership_budget_reservations
  where released_at is null;

  if v_actual_bucket + v_reserved_bucket + p_amount_usd > p_bucket_budget_usd then
    return query select null::uuid, false,
      format('bucket_budget_reached (%s: actual $%s + in-flight $%s + requested $%s exceeds bucket cap $%s)',
        p_bucket, round(v_actual_bucket, 4), round(v_reserved_bucket, 4), round(p_amount_usd, 4), round(p_bucket_budget_usd, 2));
    return;
  end if;

  if v_actual_total + v_reserved_total + p_amount_usd > p_total_budget_usd then
    return query select null::uuid, false,
      format('shared_budget_reached (actual $%s + in-flight $%s + requested $%s exceeds shared cap $%s)',
        round(v_actual_total, 4), round(v_reserved_total, 4), round(p_amount_usd, 4), round(p_total_budget_usd, 2));
    return;
  end if;

  insert into partnership_budget_reservations(bucket, amount_usd, prospect_id)
    values (p_bucket, p_amount_usd, p_prospect_id)
    returning id into v_id;

  return query select v_id, true, null::text;
end;
$$;

create or replace function release_partnership_budget_reservation(
  p_reservation_id uuid,
  p_confirmed_real_cost_recorded boolean default false
) returns void
language plpgsql as $$
declare
  v_was_settled boolean;
begin
  perform pg_advisory_xact_lock(hashtext('partnership_budget'));

  select settled_as_charge into v_was_settled
  from partnership_budget_reservations
  where id = p_reservation_id;

  if v_was_settled and p_confirmed_real_cost_recorded then
    -- Real cost_events rows now exist for this same attempt (recorded by
    -- the owning request's own onUsage/recordCostEvent calls) -- the
    -- earlier conservative ceiling charge made when this reservation
    -- expired is now redundant and must be removed so only the real
    -- recorded cost counts, never both.
    delete from cost_events
    where context->>'settledReservationId' = p_reservation_id::text;
  end if;

  update partnership_budget_reservations
    set released_at = now()
    where id = p_reservation_id and released_at is null;
end;
$$;
