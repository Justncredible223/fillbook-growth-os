-- Posting plan + results tracking (2026-09-25). The owner posts 3 videos a day by hand to TikTok, YouTube Shorts and
-- Instagram Reels, and replies on X by hand. Until now nothing recorded where each video went or how anything did:
-- video_renders.published_url held one link, and the row itself is deleted after 7 days (videoRenderRetention.ts).
--
-- video_posts        one row per (video, platform) the owner posted to. Keyed on campaign_asset_id, which outlives the
--                    render row, and carries the concept title so results survive render cleanup.
-- video_post_metrics snapshots of views/likes/comments/shares per post: 'api' for YouTube (videos.list with the
--                    existing API key), 'manual' for TikTok and Instagram (no read access to either).
-- x_own_posts        the account's own tweets (replies and posts), read from GET /2/users/{id}/tweets, with their
--                    latest public metrics, matched to the Prospecting candidate they reply to where possible. Feeds
--                    the "reply views dropped" alert.
--
-- Service-role access only, like every other table here.

create table video_posts (
  id uuid primary key default gen_random_uuid(),
  campaign_asset_id uuid not null references campaign_assets(id) on delete cascade,
  video_render_id uuid,                       -- informational; the render row is pruned after 7 days
  concept_title text not null,
  platform text not null check (platform in ('tiktok', 'youtube_shorts', 'instagram')),
  url text not null,
  external_id text,                           -- e.g. the YouTube video id, parsed from url
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_asset_id, platform)
);
create index video_posts_posted_at_idx on video_posts (posted_at desc);
alter table video_posts enable row level security;

create table video_post_metrics (
  id uuid primary key default gen_random_uuid(),
  video_post_id uuid not null references video_posts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  source text not null check (source in ('api', 'manual')),
  views integer,
  likes integer,
  comments integer,
  shares integer
);
create index video_post_metrics_post_idx on video_post_metrics (video_post_id, captured_at desc);
alter table video_post_metrics enable row level security;

create table x_own_posts (
  tweet_id text primary key,
  kind text not null check (kind in ('reply', 'post')),
  text text not null,
  created_at timestamptz not null,
  in_reply_to_tweet_id text,
  prospecting_candidate_id uuid,              -- the candidate whose post this replies to, when it matches
  impressions integer,
  likes integer,
  replies integer,
  reposts integer,
  metrics_updated_at timestamptz,
  first_seen_at timestamptz not null default now()
);
create index x_own_posts_created_idx on x_own_posts (created_at desc);
alter table x_own_posts enable row level security;
