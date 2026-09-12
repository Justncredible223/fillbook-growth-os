-- Adds a hard daily render cap alongside the existing monthly one, after a
-- real incident (2026-09-11): the monthly cap alone let
-- videoRenderReconciliation.ts's sweep enqueue 8 renders in under a
-- second when it found 8 approved-but-never-rendered scripts at once --
-- technically within budget, but far more than the owner wants to post in
-- a single day (2/platform/day, owner-stated policy, 2026-09-12). See
-- backend/src/video/videoRenderEligibility.ts's MAX_VIDEO_RENDERS_PER_DAY.
--
-- Postgres treats a changed parameter list as a distinct overload, not a
-- replacement -- CREATE OR REPLACE alone would leave the old 2-argument
-- signature callable (and stale) alongside this one. Drop it explicitly
-- first so there is exactly one enqueue_video_render signature again.
drop function if exists enqueue_video_render(uuid, integer);

create function enqueue_video_render(p_campaign_asset_id uuid, p_monthly_cap integer, p_daily_cap integer)
returns table (video_render_id uuid, job_id uuid, already_existed boolean, eligible boolean, reason text)
language plpgsql as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
  v_job_id uuid;
  v_key text := 'render_video:' || p_campaign_asset_id::text;
  v_month_count integer;
  v_day_count integer;
begin
  -- Idempotent: an existing non-terminal row wins, no new row/job created.
  -- Checked BEFORE the lock below -- an asset that already has a row
  -- never needs to contend for the cap locks at all.
  select id into v_existing_id from video_renders
    where campaign_asset_id = p_campaign_asset_id
      and status in ('queued','rendering')
    limit 1;
  if v_existing_id is not null then
    return query select v_existing_id, null::uuid, true, true, null::text;
    return;
  end if;

  -- Same advisory-lock idiom as the monthly cap (migration 0028) --
  -- serializes concurrent callers against both cap counts together, one
  -- lock covering both checks below.
  perform pg_advisory_xact_lock(hashtext('video_renders_monthly_cap'));

  select count(*) into v_month_count from video_renders
    where created_at >= date_trunc('month', now());
  if v_month_count >= p_monthly_cap then
    return query select null::uuid, null::uuid, false, false,
      format('monthly_render_cap_reached (%s renders this month, cap is %s)', v_month_count, p_monthly_cap);
    return;
  end if;

  -- Daily cap checked with the SAME lock/count style as the monthly one,
  -- just scoped to the current calendar day (UTC, matching every other
  -- "today" boundary already used elsewhere in this project, e.g.
  -- prospecting's/partnerships' own daily gates).
  select count(*) into v_day_count from video_renders
    where created_at >= date_trunc('day', now());
  if v_day_count >= p_daily_cap then
    return query select null::uuid, null::uuid, false, false,
      format('daily_render_cap_reached (%s renders today, cap is %s)', v_day_count, p_daily_cap);
    return;
  end if;

  insert into video_renders (campaign_asset_id, status)
    values (p_campaign_asset_id, 'queued')
    returning id into v_new_id;

  insert into system_jobs (job_type, payload, idempotency_key, max_attempts)
    values ('render_video', jsonb_build_object('campaignAssetId', p_campaign_asset_id, 'videoRenderId', v_new_id), v_key, 2)
    on conflict (idempotency_key) do nothing
    returning id into v_job_id;

  update video_renders set job_id = v_job_id, updated_at = now() where id = v_new_id;

  return query select v_new_id, v_job_id, false, true, null::text;
end;
$$;
