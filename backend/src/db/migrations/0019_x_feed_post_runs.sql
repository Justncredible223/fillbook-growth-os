-- Today's X Post -- one dedicated, idempotent daily feed-post slot,
-- separate from the opportunistic auto-draft pipeline (auto_draft_runs).
-- Auto-draft only drafts when a real signal-derived opportunity scores
-- above MIN_QUALIFYING_SCORE; most days none does, which is why
-- campaign_assets alone could never reliably answer "is there a genuine
-- X feed post for today" -- there's no stable, timezone-correct key to
-- ask that question against. operating_date is that key: the calendar
-- date (America/Phoenix by default, see scheduleConfig.ts's
-- getOperatingDate) this run belongs to, with the UNIQUE constraint
-- serving the same durable "claim before doing any drafting work"
-- idempotency role as auto_draft_runs.run_date.
--
-- tried_topic_keys accumulates every curated topic (see
-- dailyXFeedPost.ts's FEED_POST_TOPICS) attempted so far today, so a
-- bounded retry (mechanical/deep-review gate failure, or an explicit
-- owner "Regenerate") picks a different angle instead of repeating one
-- already known to have failed or already shown to the owner.
--
-- posted_at is a SEPARATE, later confirmation than campaign_assets
-- reaching 'handed_off' -- handing off only means "opened X with the
-- draft copied," never "posted." Same reasoning as Inbound's
-- "Mark responded" -- this app has no way to verify a post actually went
-- out via the X API, so it stays an explicit human action, not an
-- inference from handoff.

create table x_feed_post_runs (
  id uuid primary key default gen_random_uuid(),
  operating_date date not null unique,
  status text not null check (status in ('running', 'ready', 'failed')),
  campaign_asset_id uuid references campaign_assets(id),
  topic_key text,
  tried_topic_keys text[] not null default '{}',
  -- The winning topic's editorialTags at selection time (see
  -- dailyXFeedPost.ts's FeedPostTopic.editorialTags) -- lets a later day's
  -- angle selection detect a differently-worded repeat of the same
  -- underlying lesson/hook/conclusion, not just an exact topic_key repeat.
  editorial_tags text[] not null default '{}',
  -- Human-readable record of why this angle was selected over the other
  -- candidates actually compared that attempt (see selectFeedPostAngle) --
  -- "record why" without re-deriving it after the fact from attempts/logs.
  selection_reason text,
  attempts integer not null default 0,
  ai_calls integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  error text,
  posted_at timestamptz,
  -- The owner's FINAL confirmed text at Mark-posted time -- may differ
  -- from the original AI draft after an in-app edit. Future originality/
  -- editorial-tag comparisons should prefer this over content_versions'
  -- pre-edit body when it's present, since it's what actually went out.
  posted_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index x_feed_post_runs_operating_date_idx on x_feed_post_runs (operating_date);

-- RLS enabled with no explicit policy, matching every other table in this
-- project (see e.g. 0018_notifications.sql) -- this backend only ever
-- accesses Supabase via the service-role key server-side, which bypasses
-- RLS by design; there is no anon/authenticated client path to guard
-- against here, so an explicit policy would be dead code, not a missing
-- safeguard.
alter table x_feed_post_runs enable row level security;
