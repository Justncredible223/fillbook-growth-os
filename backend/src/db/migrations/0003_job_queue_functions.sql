-- Phase 2: durable job infrastructure — atomic claim/complete/fail as
-- Postgres functions so the app layer can call them via a single RPC
-- round-trip instead of racing on SELECT+UPDATE from the client.

create or replace function claim_job(p_job_types text[] default null)
returns setof system_jobs
language plpgsql
as $$
begin
  return query
  with next_job as (
    select id from system_jobs
    where status = 'pending'
      and run_after <= now()
      and (p_job_types is null or job_type = any(p_job_types))
    order by run_after
    for update skip locked
    limit 1
  )
  update system_jobs
  set status = 'running', locked_at = now(), updated_at = now()
  from next_job
  where system_jobs.id = next_job.id
  returning system_jobs.*;
end;
$$;

create or replace function complete_job(p_job_id uuid)
returns void
language sql
as $$
  update system_jobs
  set status = 'succeeded', updated_at = now()
  where id = p_job_id;
$$;

-- p_dead_letter: caller (TS layer) decides this via pure backoff/retry
-- logic (backend/src/jobs/backoff.ts) based on attempts vs max_attempts,
-- so this function just applies the decision atomically.
create or replace function fail_job(
  p_job_id uuid,
  p_error text,
  p_run_after timestamptz,
  p_dead_letter boolean
)
returns void
language plpgsql
as $$
declare
  v_job system_jobs;
begin
  update system_jobs
  set attempts = attempts + 1,
      last_error = p_error,
      status = case when p_dead_letter then 'dead_letter' else 'pending' end,
      run_after = p_run_after,
      locked_at = null,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  if p_dead_letter then
    insert into dead_letter_jobs (original_job_id, job_type, payload, last_error, attempts)
    values (v_job.id, v_job.job_type, v_job.payload, p_error, v_job.attempts);
  end if;
end;
$$;
