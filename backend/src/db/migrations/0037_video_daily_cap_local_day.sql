-- The daily render cap now resets at midnight in the owner's timezone (America/Phoenix), not at
-- midnight UTC (5 PM Phoenix time). Same signature as 0032, so CREATE OR REPLACE is safe (no extra
-- overload is created). Only the day boundary in the daily-cap count changes.

create or replace function enqueue_video_render(p_campaign_asset_id uuid, p_monthly_cap integer, p_daily_cap integer)
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

  -- Daily cap checked with the SAME lock/count style as the monthly one, but scoped to the owner's
  -- calendar day (America/Phoenix, matching DEFAULT_SCHEDULE_TIMEZONE in scheduleConfig.ts), not UTC.
  -- The UTC day rolled over at 5 PM Phoenix time, so an approval made mid-afternoon after that day's
  -- render was silently blocked until evening (2026-09-20). Phoenix has no daylight saving, so the day
  -- boundary is a fixed 07:00 UTC.
  select count(*) into v_day_count from video_renders
    where created_at >= (date_trunc('day', now() at time zone 'America/Phoenix') at time zone 'America/Phoenix');
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
