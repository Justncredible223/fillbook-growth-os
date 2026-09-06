-- Phone-only video render pipeline (Reach: fill Fliki's TikTok/YouTube
-- Shorts off-days from the owner's phone alone). Fully additive; touches
-- no existing table. See docs/VIDEO_FACTORY.md for the local-render CLI
-- this reuses, and the implementation plan for the full design rationale.
--
-- Isolation: every table here is new. The only reference into existing
-- schema is a read-only FK to campaign_assets.id (the shared content-asset
-- table every content type already uses) and system_jobs.job_type
-- ('render_video', a distinct value in the existing shared queue). No
-- foreign keys into Partnerships/Prospecting/Inbound tables anywhere.

-- ---------------------------------------------------------------------
-- Render state
-- ---------------------------------------------------------------------
create table video_renders (
  id uuid primary key default gen_random_uuid(),
  campaign_asset_id uuid not null references campaign_assets(id),
  job_id uuid,                        -- system_jobs.id, once claimed by the worker
  status text not null default 'queued'
    check (status in ('queued','rendering','ready','failed','canceled')),
  storage_path text,                  -- set only when status='ready'
  duration_seconds numeric,
  error text,                         -- set only when status='failed'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one live (non-terminal) render per asset at a time -- the
-- primary duplicate-render guard; enqueue_video_render below is the
-- second, idempotent layer on top of this.
create unique index video_renders_one_active_per_asset
  on video_renders (campaign_asset_id)
  where status in ('queued','rendering');
create index video_renders_status_idx on video_renders (status);
alter table video_renders enable row level security;

-- ---------------------------------------------------------------------
-- Device push tokens (FCM) -- single-owner app, so this is a small table
-- of the owner's own device(s), not a multi-user directory.
-- ---------------------------------------------------------------------
create table device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  fcm_token text not null unique,
  app_token_fingerprint text not null, -- one-way hash of APP_API_TOKEN at
                                        -- registration time, for future
                                        -- credential-rotation cleanup --
                                        -- never the raw token itself
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index device_push_tokens_active_idx
  on device_push_tokens (id) where revoked_at is null;
alter table device_push_tokens enable row level security;

-- ---------------------------------------------------------------------
-- Notification outbox -- a real delivery ledger, not an optimistic flag.
-- See the implementation plan's "Notification reliability" section for
-- the full reasoning: a render's completion and its notification's
-- delivery are decoupled on purpose, so a crash between them never
-- silently loses the "your video is ready" alert.
-- ---------------------------------------------------------------------
create table video_render_notifications (
  id uuid primary key default gen_random_uuid(),
  video_render_id uuid not null references video_renders(id),
  device_token_id uuid not null references device_push_tokens(id),
  kind text not null check (kind in ('ready','failed')),
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed_permanent')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
-- At most one notification OBLIGATION per (render, device, outcome-kind)
-- can ever exist -- independent of the "one active render per asset"
-- guard above, this makes a duplicate "ready" or "failed" push for the
-- same render+device structurally impossible, not just unlikely.
create unique index video_render_notifications_one_per_outcome
  on video_render_notifications (video_render_id, device_token_id, kind);
create index video_render_notifications_pending_idx
  on video_render_notifications (next_attempt_at) where status = 'pending';
create index video_render_notifications_sending_idx
  on video_render_notifications (lease_expires_at) where status = 'sending';
alter table video_render_notifications enable row level security;

-- ---------------------------------------------------------------------
-- Storage reservation ledger -- reserved/committed/released/deleted, NOT
-- a single mutable counter. A reservation only becomes real, permanent
-- usage once the upload it was made for actually succeeds; a failed
-- upload or a crashed worker releases (explicitly, or via lease expiry)
-- rather than leaking capacity forever. See the implementation plan's
-- "Storage safeguards" section for the full reasoning -- this exact
-- design replaced an earlier draft that had this bug.
-- ---------------------------------------------------------------------
create table video_storage_reservations (
  id uuid primary key default gen_random_uuid(),
  video_render_id uuid not null references video_renders(id),
  reserved_bytes bigint not null,
  status text not null default 'reserved'
    check (status in ('reserved','committed','released','deleted')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  committed_at timestamptz,
  released_at timestamptz,
  deleted_at timestamptz
);
create index video_storage_reservations_open_idx
  on video_storage_reservations (expires_at) where status = 'reserved';
create index video_storage_reservations_committed_idx
  on video_storage_reservations (status) where status = 'committed';
alter table video_storage_reservations enable row level security;

-- All four tables above: RLS enabled, no explicit policy -- service-role-
-- only access, the same convention every other table in this project
-- already follows (see 0019_x_feed_post_runs.sql's comment on this).

-- ---------------------------------------------------------------------
-- enqueue_video_render -- the single atomic entry point for turning an
-- approved video_script asset into a queued render + job, called from
-- both the live approval path (backend/api/approvals.ts) and the
-- reconciliation sweep (backend/src/video/videoRenderReconciliation.ts).
-- Either fully succeeds (row + job both exist) or fully fails (nothing
-- partially created) -- Postgres functions are transactional by default.
-- ---------------------------------------------------------------------
create function enqueue_video_render(p_campaign_asset_id uuid, p_monthly_cap integer)
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
  select id into v_existing_id from video_renders
    where campaign_asset_id = p_campaign_asset_id
      and status in ('queued','rendering')
    limit 1;
  if v_existing_id is not null then
    return query select v_existing_id, null::uuid, true, true, null::text;
    return;
  end if;

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

-- ---------------------------------------------------------------------
-- Storage reservation lifecycle functions
-- ---------------------------------------------------------------------
create function reserve_video_storage_bytes(p_video_render_id uuid, p_bytes bigint, p_cap bigint)
returns table (reservation_id uuid, eligible boolean, reason text)
language plpgsql as $$
declare
  v_committed bigint;
  v_reserved bigint;
  v_id uuid;
begin
  -- Serializes concurrent callers on this ledger, same idiom as
  -- reserve_partnership_budget's pg_advisory_xact_lock (migration 0025).
  perform pg_advisory_xact_lock(hashtext('video_storage_reservations'));

  -- Self-heal: a reservation whose lease expired without ever being
  -- committed means the worker crashed/failed mid-render -- release it
  -- so it stops counting. This is the "reconcile expired reservations on
  -- the next worker run" guarantee: it runs as a side effect of every
  -- call to this function, which happens before every render attempt.
  update video_storage_reservations
    set status = 'released', released_at = now()
    where status = 'reserved' and expires_at < now();

  select coalesce(sum(reserved_bytes), 0) into v_committed
    from video_storage_reservations where status = 'committed';
  select coalesce(sum(reserved_bytes), 0) into v_reserved
    from video_storage_reservations where status = 'reserved';

  if v_committed + v_reserved + p_bytes > p_cap then
    return query select null::uuid, false,
      format('storage_cap_reached (committed %s + reserved %s + requested %s exceeds cap %s)',
             v_committed, v_reserved, p_bytes, p_cap);
    return;
  end if;

  insert into video_storage_reservations (video_render_id, reserved_bytes)
    values (p_video_render_id, p_bytes)
    returning id into v_id;

  return query select v_id, true, null::text;
end;
$$;

-- Only upload success ever calls this -- a reservation becomes real,
-- permanent usage only once the bytes are actually sitting in Storage.
create function commit_video_storage_reservation(p_reservation_id uuid)
returns void language sql as $$
  update video_storage_reservations
  set status = 'committed', committed_at = now()
  where id = p_reservation_id and status = 'reserved';
$$;

-- Called from a finally-style block whenever the process is still alive
-- after a failed render/upload. A no-op if the row was already committed
-- (commit is one-way) or already released/deleted.
create function release_video_storage_reservation(p_reservation_id uuid)
returns void language sql as $$
  update video_storage_reservations
  set status = 'released', released_at = now()
  where id = p_reservation_id and status = 'reserved';
$$;

-- Called by pruneOldVideoRenders ONLY after the Storage delete call
-- itself has confirmedly succeeded -- never before. If that call fails,
-- the reservation stays 'committed' (still correctly counted as real
-- usage) and is retried on the next day's run.
create function mark_video_storage_reservation_deleted(p_reservation_id uuid)
returns void language sql as $$
  update video_storage_reservations
  set status = 'deleted', deleted_at = now()
  where id = p_reservation_id and status = 'committed';
$$;

-- ---------------------------------------------------------------------
-- Notification claim-with-lease -- see the implementation plan's
-- "Notification reliability" section. FOR UPDATE SKIP LOCKED is what
-- makes two concurrent notifier loops safe: if loop A already holds a
-- row's lock, loop B's claim simply skips it. The lease_expires_at
-- reclaim branch is what makes a crashed sender self-healing.
-- ---------------------------------------------------------------------
create function claim_video_render_notification(p_lease_owner text, p_lease_seconds int default 60)
returns setof video_render_notifications
language plpgsql as $$
begin
  return query
  with next_row as (
    select id from video_render_notifications
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'sending' and lease_expires_at < now())
    order by next_attempt_at
    for update skip locked
    limit 1
  )
  update video_render_notifications
  set status = 'sending', lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  from next_row
  where video_render_notifications.id = next_row.id
  returning video_render_notifications.*;
end;
$$;
