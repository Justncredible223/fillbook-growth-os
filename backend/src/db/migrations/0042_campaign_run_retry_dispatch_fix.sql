-- Retries of the same opportunity never dispatched (2026-09-24). 0041 keyed
-- each run_campaign job by opportunity ('run_campaign:<opportunity id>') with
-- ON CONFLICT DO NOTHING, so a second run of an opportunity -- e.g. retrying a
-- motion concept whose first draft failed review -- inserted its
-- campaign_run_requests row but silently got no system_jobs row. Nothing was
-- dispatched to GitHub Actions and the request sat in 'queued' forever (the
-- app spun on "Creating..."), which also blocked every later retry through
-- campaign_run_requests_one_active_per_opportunity.
--
-- The one-live-request-per-opportunity guarantee is already enforced by that
-- partial unique index and the existing-request check below, so the job key
-- only needs to be unique per request.

create or replace function enqueue_campaign_run(p_opportunity_id uuid, p_asset_type_override text)
returns table (campaign_run_request_id uuid, job_id uuid, already_existed boolean)
language plpgsql as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
  v_job_id uuid;
begin
  select id into v_existing_id from campaign_run_requests
    where opportunity_id = p_opportunity_id
      and status in ('queued','running')
    limit 1;
  if v_existing_id is not null then
    return query select v_existing_id, null::uuid, true;
    return;
  end if;

  insert into campaign_run_requests (opportunity_id, asset_type_override, status)
    values (p_opportunity_id, p_asset_type_override, 'queued')
    returning id into v_new_id;

  insert into system_jobs (job_type, payload, idempotency_key, max_attempts)
    values (
      'run_campaign',
      jsonb_build_object('campaignRunRequestId', v_new_id, 'opportunityId', p_opportunity_id, 'assetTypeOverride', p_asset_type_override),
      'run_campaign:' || v_new_id::text,
      2
    )
    returning id into v_job_id;

  update campaign_run_requests set job_id = v_job_id, updated_at = now() where id = v_new_id;

  return query select v_new_id, v_job_id, false;
end;
$$;

-- Release requests already stranded by the old key: queued, with no job, so
-- they can never run and would block the next attempt for that opportunity.
update campaign_run_requests
  set status = 'failed',
      error = 'Never dispatched: its job collided with an earlier run of the same opportunity (fixed in migration 0042). Request it again.',
      updated_at = now()
  where status = 'queued'
    and job_id is null;
