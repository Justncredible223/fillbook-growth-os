-- Re-rendering an asset that already has a finished render used to create a video_renders row with no job.
-- The job's idempotency_key was 'render_video:<campaign_asset_id>', so the first render's job (kept forever)
-- made the insert a silent no-op (on conflict do nothing), job_id came back null, and the new row sat at
-- 'queued' with nothing to run it (2026-09-29, production P20 re-render; it had to be started by dispatching
-- the workflow by hand).
--
-- The key is now scoped to the new render row ('render_video:<video_render_id>'). Duplicate protection is
-- unchanged: the check for an existing queued/rendering row at the top of the function, plus the partial
-- unique index video_renders_one_active_per_asset, still allow at most one live render per asset. The key
-- only has to be unique per job, and a render row has exactly one job.
--
-- Same signature as 0037, so CREATE OR REPLACE is safe (no extra overload). Nothing else reads the key.

create or replace function enqueue_video_render(p_campaign_asset_id uuid, p_monthly_cap integer, p_daily_cap integer)
returns table (video_render_id uuid, job_id uuid, already_existed boolean, eligible boolean, reason text)
language plpgsql as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
  v_job_id uuid;
  v_month_count integer;
  v_day_count integer;
begin
  -- Idempotent: an existing non-terminal row wins, no new row/job created.
  select id into v_existing_id from video_renders
    where campaign_asset_id = p_campaign_asset_id
      and status in ('queued','rendering')
    limit 1;
  if v_existing_id is not null then
    return query select v_existing_id, null::uuid, true, true, null::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('video_renders_monthly_cap'));

  select count(*) into v_month_count from video_renders
    where created_at >= date_trunc('month', now());
  if v_month_count >= p_monthly_cap then
    return query select null::uuid, null::uuid, false, false,
      format('monthly_render_cap_reached (%s renders this month, cap is %s)', v_month_count, p_monthly_cap);
    return;
  end if;

  -- Owner's calendar day in America/Phoenix (migration 0037); Phoenix has no daylight saving.
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
    values ('render_video', jsonb_build_object('campaignAssetId', p_campaign_asset_id, 'videoRenderId', v_new_id),
            'render_video:' || v_new_id::text, 2)
    on conflict (idempotency_key) do nothing
    returning id into v_job_id;

  update video_renders set job_id = v_job_id, updated_at = now() where id = v_new_id;

  return query select v_new_id, v_job_id, false, true, null::text;
end;
$$;
