-- Automated YouTube publishing + analytics pull-back (Phase 1, 2026-09-22).
-- Additive only: the existing manual-entry workflow (video_publication_metadata
-- / video_platform_metrics, migration 0038) keeps working unchanged for anyone
-- who doesn't set YOUTUBE_PUBLISHING_ENABLED -- this just gives an automated
-- publish a place to record what it did, and a way to mark the metrics it
-- later pulls back as machine-sourced rather than hand-typed.

-- One row per (video render, platform) publish attempt/result. Deliberately
-- separate from video_publication_metadata (which describes WHAT was
-- published and is keyed by platform/experiment/variation) -- this table is
-- about the mechanical act of publishing a specific render: did it happen,
-- what id did the platform hand back, when. Same service-role-only RLS
-- posture as every other table in this project (RLS on, no policy).
create table if not exists platform_publications (
  id uuid primary key default gen_random_uuid(),
  video_render_id uuid not null references video_renders(id),
  platform text not null check (platform in ('youtube')),
  external_video_id text,
  status text not null default 'pending' check (status in ('pending', 'published', 'failed')),
  error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- At most one publish record per render per platform -- a retried publish
  -- job upserts this same row rather than creating a duplicate.
  unique (video_render_id, platform)
);
create index if not exists platform_publications_status_idx on platform_publications (status);
create index if not exists platform_publications_external_id_idx on platform_publications (external_video_id) where external_video_id is not null;
alter table platform_publications enable row level security;

comment on table platform_publications is
  'Tracks automated publish attempts of a rendered video to an external platform (YouTube first). external_video_id is null until status=published.';

-- 'api' joins 'manual'/'csv' as a legitimate source for video_platform_metrics
-- rows -- the YouTube Analytics pull-back writes rows with source='api',
-- distinguishing machine-fetched numbers from hand-typed/CSV-imported ones
-- without needing a separate table.
alter table video_platform_metrics drop constraint if exists video_platform_metrics_source_check;
alter table video_platform_metrics add constraint video_platform_metrics_source_check
  check (source in ('manual', 'csv', 'api'));
