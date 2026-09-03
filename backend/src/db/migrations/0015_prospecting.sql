-- Prospecting -- proactive discovery of OTHER people's public X posts about
-- topics Fillbook is relevant to (prop firms, futures, journaling,
-- drawdown, etc.), so the owner can reply into real conversations instead
-- of only ever reacting to people who already mention @FillbookHQ.
--
-- Deliberately its own table, not bolted onto `signals`/`opportunities`
-- (those model "a topic worth writing content about") or
-- `inbound_engagements` (that models "someone spoke TO us and may be
-- waiting on a reply"). This models a third, distinct lifecycle: "we found
-- someone else's post worth joining, drafted something useful to say, and
-- need to remember we already looked at it" -- a discovery+dedup queue,
-- closer in shape to inbound_engagements than to signals, but keyed by
-- discovery query rather than by a reply-to-us relationship.
--
-- docs/social/MASTER_SOCIAL_STRATEGY.md is the governing policy this table
-- and its scoring/drafting logic implement: "~8-15 worthwhile X reply
-- opportunities/day" is a directional target from that doc (not invented
-- here), "90%+ of replies: no link, no pitch" is enforced in the
-- reply-drafting prompt, and "follower count alone does NOT determine
-- priority" shapes the ranking function below.

create table prospecting_candidates (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'x',
  external_id text not null,                    -- the platform's post id -- dedup key with platform
  discovery_query text not null,                 -- which configured topic/query surfaced this (see prospectingTopics.ts)
  author_handle text,
  author_external_id text,
  author_name text,
  author_follower_count integer,
  author_verified boolean,
  post_text text not null,
  post_url text not null,
  post_created_at timestamptz,
  public_metrics jsonb not null default '{}',
  opportunity_score numeric(5,2) not null default 0,  -- see prospectingScoring.ts -- multi-factor, not follower-count-dominant
  score_breakdown jsonb not null default '{}',   -- human-readable reasons behind the score, shown in the app ("why it surfaced")
  creator_candidate boolean not null default false,   -- flagged for possible Creators-tab follow-up, never auto-inserted into creators
  status text not null default 'new'
    check (status in ('new', 'shown', 'drafting', 'ready', 'replied', 'skipped', 'not_relevant', 'already_handled', 'expired')),
  shown_at timestamptz,
  opened_at timestamptz,                         -- when the owner tapped "Open on X"
  draft_reply text,
  final_reply text,                              -- only set if the owner edited the draft before copying
  reply_mentions_fillbook boolean,
  reply_used_link boolean,
  replied_at timestamptz,
  skip_reason text,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id)
);
create index prospecting_candidates_status_idx on prospecting_candidates (status);
create index prospecting_candidates_score_idx on prospecting_candidates (opportunity_score desc);
create index prospecting_candidates_author_idx on prospecting_candidates (author_external_id);
create index prospecting_candidates_discovered_at_idx on prospecting_candidates (discovered_at desc);

alter table prospecting_candidates enable row level security;

-- One row per (platform, author) the owner has ever replied to via
-- Prospecting -- lets Inbound recognize "we already reached out to this
-- person" the next time they mention @FillbookHQ, without needing
-- Prospecting and Inbound to share a table. inboundIngestion.ts's
-- hasExistingRelationship check reads this alongside prior inbound rows
-- and the creators table.
create table prospecting_outreach (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'x',
  author_external_id text not null,
  author_handle text,
  first_replied_at timestamptz not null default now(),
  last_replied_at timestamptz not null default now(),
  reply_count integer not null default 1,
  unique (platform, author_external_id)
);
alter table prospecting_outreach enable row level security;

-- X search reads bill at the general $0.005/read rate (not the cheaper
-- $0.001 Owned Reads tier -- see docs/PROGRESS_LEDGER.md Phase 4), so
-- usage needs its own visible ledger rather than folding silently into
-- cost_events' LLM-only assumptions. One row per search call.
create table prospecting_search_runs (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  results_returned integer not null default 0,
  new_candidates integer not null default 0,     -- results_returned minus ones already known (dedup)
  estimated_cost_usd numeric(10,6) not null default 0,
  ran_at timestamptz not null default now()
);
create index prospecting_search_runs_ran_at_idx on prospecting_search_runs (ran_at desc);
alter table prospecting_search_runs enable row level security;
