-- Fixes a real concurrency gap found in a production-readiness audit:
-- enqueue_video_render's monthly render-count cap check (migration 0027)
-- had no pg_advisory_xact_lock, unlike every sibling budget/reservation
-- function in this codebase (reserve_partnership_budget in 0024,
-- reserve_video_storage_bytes in 0027 itself). Two concurrent calls to
-- enqueue_video_render for DIFFERENT campaign_asset_ids -- e.g. the owner
-- approving one video draft via api/approvals.ts at the same moment
-- growth-pulse's reconciliation sweep (videoRenderReconciliation.ts) is
-- enqueuing a different missed one -- could both read the same
-- pre-cap v_month_count and both insert, exceeding
-- MAX_VIDEO_RENDERS_PER_MONTH by more than intended. Practical impact is
-- narrow (bounded to +1 given this project's actual call cadence, and
-- rendering itself spends no LLM budget), but the cap's own comment
-- ("Hard monthly render-count cap, checked before creating anything")
-- promises exactly the atomicity this migration now actually provides.
--
-- CREATE OR REPLACE, not a new function name -- every existing caller
-- (api/approvals.ts, videoRenderReconciliation.ts) keeps calling
-- enqueue_video_render unchanged; only its internal body gains the lock.
create or replace function enqueue_video_render(p_campaign_asset_id uuid, p_monthly_cap integer)
returns table (video_render_id uuid, job_id uuid, already_existed boolean, eligible boolean, reason text)
language plpgsql as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
  v_job_id uuid;
  v_key text := 'render_video:' || p_campaign_asset_id::text;
  v_month_count integer;
begin
  -- Idempotent: an existing non-terminal row wins, no new row/job created.
  -- Checked BEFORE the lock below -- an asset that already has a row
  -- never needs to contend for the monthly-cap lock at all.
  select id into v_existing_id from video_renders
    where campaign_asset_id = p_campaign_asset_id
      and status in ('queued','rendering')
    limit 1;
  if v_existing_id is not null then
    return query select v_existing_id, null::uuid, true, true, null::text;
    return;
  end if;

  -- Serializes concurrent callers against the SAME monthly-cap count,
  -- same idiom as reserve_partnership_budget (0024) and
  -- reserve_video_storage_bytes (0027) -- this is the fix itself: without
  -- it, two concurrent calls for two different campaign_asset_ids could
  -- both read v_month_count below the cap and both insert.
  perform pg_advisory_xact_lock(hashtext('video_renders_monthly_cap'));

  -- Hard monthly render-count cap, checked before creating anything --
  -- this is its own independent budget line, entirely separate from any
  -- LLM/Anthropic budget (rendering itself calls no LLM at all).
  select count(*) into v_month_count from video_renders
    where created_at >= date_trunc('month', now());
  if v_month_count >= p_monthly_cap then
    return query select null::uuid, null::uuid, false, false,
      format('monthly_render_cap_reached (%s renders this month, cap is %s)', v_month_count, p_monthly_cap);
    return;
  end if;

  insert into video_renders (campaign_asset_id, status)
    values (p_campaign_asset_id, 'queued')
    returning id into v_new_id;

  -- Matches system_jobs's real columns exactly (verified directly against
  -- backend/src/db/migrations/0001_core_schema.sql and
  -- 0003_job_queue_functions.sql, not inferred from TypeScript).
  -- idempotency_key is namespaced ('render_video:' prefix) because that
  -- column is globally unique ACROSS EVERY JOB TYPE in this shared table,
  -- not scoped per job-type -- a bare campaign_asset_id risked a false
  -- collision with an unrelated job type. max_attempts is set to 2
  -- explicitly (not the table's default of 5): a render is expensive/slow
  -- relative to other job types, so a stuck/broken one shouldn't silently
  -- retry five times before dead-lettering.
  insert into system_jobs (job_type, payload, idempotency_key, max_attempts)
    values ('render_video', jsonb_build_object('campaignAssetId', p_campaign_asset_id, 'videoRenderId', v_new_id), v_key, 2)
    on conflict (idempotency_key) do nothing
    returning id into v_job_id;

  update video_renders set job_id = v_job_id, updated_at = now() where id = v_new_id;

  return query select v_new_id, v_job_id, false, true, null::text;
end;
$$;
