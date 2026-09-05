-- Feature-wide atomic budget reservation for Partnerships, closing the
-- cross-prospect shared-budget race the per-prospect generation_claimed_at
-- mutex (0023) deliberately did NOT close: two concurrent paid requests for
-- DIFFERENT prospects (or discovery running concurrently with generation)
-- could each read a stale month-spend total and jointly overspend past the
-- shared cap. This is not an accepted limitation -- it is now enforced.
--
-- Design: a reservation is a temporary hold on budget, made BEFORE a paid
-- request is dispatched, using a conservative cost CEILING (never the real
-- cost, which isn't known until the response returns). The real cost is
-- always recorded separately via cost_events (recordCostEvent /
-- recordPartnershipXSearchCostEvent) regardless of what happens to the
-- reservation -- the reservation only ever gates concurrent *admission*,
-- it is never a substitute for or a duplicate of the real recorded spend.
-- Releasing a reservation (always attempted in a finally block, success or
-- failure) simply stops that temporary hold from counting; it does not
-- touch cost_events, so a real cost that was actually incurred before a
-- mid-attempt failure remains recorded and is never double-counted or
-- silently dropped.
--
-- Concurrency is serialized with pg_advisory_xact_lock rather than a
-- separate ledger row + atomic increment: every reserve call takes the same
-- lock for the duration of its transaction, so the read-check-insert below
-- is effectively single-threaded across all concurrent callers without
-- needing a hand-rolled compare-and-swap.
--
-- Self-healing expiry: a reservation older than p_expiry_seconds (default
-- 300s -- well past the 20s LLM call timeout and the 60s Vercel function
-- limit, so a genuinely still-running request never has its own reservation
-- expire out from under it) stops counting toward either cap. A crashed or
-- killed request that never reaches its `finally` release therefore can
-- only ever block new spend for a bounded 5 minutes, not forever.

create table partnership_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('discovery', 'generation')),
  amount_usd numeric not null check (amount_usd >= 0),
  prospect_id uuid references partnership_prospects(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index partnership_budget_reservations_open_idx on partnership_budget_reservations (bucket) where released_at is null;
alter table partnership_budget_reservations enable row level security;

comment on table partnership_budget_reservations is 'Temporary, self-expiring holds on Partnerships'' shared monthly budget, made before a paid discovery/enrichment or generation request and released once its real cost is recorded (or it fails). See reserve_partnership_budget / release_partnership_budget_reservation.';

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

  select coalesce(sum(amount_usd), 0) into v_reserved_bucket
  from partnership_budget_reservations
  where released_at is null
    and bucket = p_bucket
    and created_at > now() - make_interval(secs => p_expiry_seconds);

  select coalesce(sum(amount_usd), 0) into v_reserved_total
  from partnership_budget_reservations
  where released_at is null
    and created_at > now() - make_interval(secs => p_expiry_seconds);

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

create or replace function release_partnership_budget_reservation(p_reservation_id uuid)
returns void
language plpgsql as $$
begin
  update partnership_budget_reservations
    set released_at = now()
    where id = p_reservation_id and released_at is null;
end;
$$;
