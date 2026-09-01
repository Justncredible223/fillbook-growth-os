-- Creator CRM (Phase 14). Tracks every creator Fillbook has vetted,
-- interacted with, or rejected, plus a logged history of interactions.
-- Mirrors the real manual practice already documented in
-- fillbookhq/docs/social/CREATOR_NETWORK.md -- see migration 0010 for the
-- actual seed import. Relationship-readiness (0-10) must only advance
-- alongside a logged, confirmed interaction -- enforced in
-- backend/src/creators/creatorNetwork.ts, not in SQL, so the check lives
-- with the one code path that's allowed to call it.

create table creators (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  display_name text,
  platform text not null check (platform in ('x', 'tiktok', 'youtube', 'discord', 'other')),
  category text not null check (category in ('tier_b', 'research_next', 'rejected')),
  readiness_score integer check (readiness_score between 0 and 10),
  follower_count integer,
  creator_product_moment text,
  notes text,
  rejection_reason text,
  last_interaction_at timestamptz,
  source_doc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (handle, platform)
);
create index creators_category_idx on creators (category);

create table creator_interactions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references creators(id) on delete cascade,
  interaction_type text not null check (interaction_type in (
    'x_reply', 'youtube_comment', 'tiktok_comment', 'other'
  )),
  occurred_at timestamptz not null,
  summary text not null,
  confirmed boolean not null default true,
  source_doc text,
  created_at timestamptz not null default now()
);
create index creator_interactions_creator_idx on creator_interactions (creator_id);

alter table creators enable row level security;
alter table creator_interactions enable row level security;
