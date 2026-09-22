-- Async campaign-run pipeline (2026-09-22). POST /api/run-campaign used to
-- run the full draft -> mechanical gate -> nine-agent deep review pipeline
-- synchronously inside the request, occasionally exceeding the function's
-- 120s cap ("Vercel Runtime Timeout Error", confirmed in production logs
-- for /api/run-campaign) -- the app showed a generic failure even when the
-- run eventually succeeded server-side. Fixed the same way video rendering
-- already solves its own hard duration constraint: the HTTP endpoint now
-- only enqueues a job and returns immediately; the real work runs on
-- GitHub Actions (no realistic time limit) via the same
-- webhook -> Edge Function -> repository_dispatch chain video_renders uses
-- (see migration 0027's enqueue_video_render for the pattern this mirrors).

create table campaign_run_requests (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id),
  job_id uuid,                        -- system_jobs.id, once claimed by the worker
  asset_type_override text check (asset_type_override in ('video_script','research')),
  status text not null default 'queued'
    check (status in ('queued','running','ready','failed')),
  campaign_asset_id uuid,             -- set only when status='ready'
  final_stage text,                   -- set only when status='ready'
  block_reasons jsonb not null default '[]'::jsonb,
  cost_usd numeric,
  error text,                         -- set only when status='failed'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one live (non-terminal) request per opportunity at a time --
-- the app's own busy-state guard on the button already prevents a rapid
-- double-tap; this is the server-side backstop, same role as
-- video_renders_one_active_per_asset plays for renders.
create unique index campaign_run_requests_one_active_per_opportunity
  on campaign_run_requests (opportunity_id)
  where status in ('queued','running');
create index campaign_run_requests_status_idx on campaign_run_requests (status);
alter table campaign_run_requests enable row level security;
-- RLS enabled, no explicit policy -- service-role-only access, same
-- convention every other table in this project already follows.

-- ---------------------------------------------------------------------
-- enqueue_campaign_run -- the single atomic entry point, mirrors
-- enqueue_video_render exactly (migration 0027): idempotent per
-- opportunity, either fully succeeds (row + job both exist) or fully
-- fails, called from api/run-campaign.ts.
-- ---------------------------------------------------------------------
create function enqueue_campaign_run(p_opportunity_id uuid, p_asset_type_override text)
returns table (campaign_run_request_id uuid, job_id uuid, already_existed boolean)
language plpgsql as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
  v_job_id uuid;
  v_key text := 'run_campaign:' || p_opportunity_id::text;
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

  -- Matches system_jobs's real columns exactly (see migration 0027's own
  -- comment on this same point). max_attempts=2: a campaign run is
  -- expensive/slow relative to other job types, so a stuck/broken dispatch
  -- shouldn't silently retry the default 5 times.
  insert into system_jobs (job_type, payload, idempotency_key, max_attempts)
    values (
      'run_campaign',
      jsonb_build_object('campaignRunRequestId', v_new_id, 'opportunityId', p_opportunity_id, 'assetTypeOverride', p_asset_type_override),
      v_key,
      2
    )
    on conflict (idempotency_key) do nothing
    returning id into v_job_id;

  update campaign_run_requests set job_id = v_job_id, updated_at = now() where id = v_new_id;

  return query select v_new_id, v_job_id, false;
end;
$$;
