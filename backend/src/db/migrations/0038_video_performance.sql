-- Short-form video performance tracking (2026-09-21). NOT applied to production; review first.
--
-- Two tables, both service-role only (RLS on, no policies), same posture as content_publications (0035):
--
-- 1. video_publication_metadata: what was published, one row per (platform, experiment, variation).
--    Filled in by the owner after posting BY HAND. Nothing here posts anything.
-- 2. video_platform_metrics: numbers the platforms report, entered manually or imported from CSV.
--    Every metric column is nullable with NO default: a metric the platform did not report stays NULL.
--    Never write 0 for "not available". 0 means the platform reported zero.

create table if not exists video_publication_metadata (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('tiktok', 'youtube_shorts')),
  title text not null,
  caption text not null,
  hashtags text[] not null default '{}',
  handle_in_caption boolean not null,
  handle_in_closing_visual boolean not null,
  series text not null,
  topic text not null,
  hook text not null,
  cta text not null,
  duration_seconds numeric not null check (duration_seconds > 0),
  voice text not null,
  visual_style text not null,
  experiment_id text not null,
  variation_id text not null,
  -- Optional link to the campaign asset this video came from.
  campaign_asset_id uuid references campaign_assets(id) on delete set null,
  published_url text,
  -- NULL until the owner enters the time they actually published.
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, experiment_id, variation_id)
);
alter table video_publication_metadata enable row level security;

create table if not exists video_platform_metrics (
  id uuid primary key default gen_random_uuid(),
  metadata_id uuid not null references video_publication_metadata(id) on delete cascade,
  captured_at timestamptz not null,
  source text not null check (source in ('manual', 'csv')),
  views bigint check (views >= 0),
  engaged_views bigint check (engaged_views >= 0),
  viewed_vs_swiped_away_pct numeric check (viewed_vs_swiped_away_pct between 0 and 100),
  average_view_duration_seconds numeric check (average_view_duration_seconds >= 0),
  percentage_viewed numeric check (percentage_viewed between 0 and 1000),
  completion_rate_pct numeric check (completion_rate_pct between 0 and 100),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  shares bigint check (shares >= 0),
  saves bigint check (saves >= 0),
  profile_visits bigint check (profile_visits >= 0),
  -- Net change; can be negative on YouTube.
  followers_gained bigint,
  website_clicks bigint check (website_clicks >= 0),
  attributed_signup_starts bigint check (attributed_signup_starts >= 0),
  attributed_completed_signups bigint check (attributed_completed_signups >= 0),
  attributed_activations bigint check (attributed_activations >= 0),
  created_at timestamptz not null default now()
);
create index if not exists video_platform_metrics_metadata_idx on video_platform_metrics (metadata_id, captured_at desc);
alter table video_platform_metrics enable row level security;

comment on table video_platform_metrics is
  'Platform-reported numbers for a manually published video. NULL means the platform did not report it, not zero. The attributed_* columns count only what tracked links can attribute, never every visitor.';
