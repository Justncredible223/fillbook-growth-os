-- "Published content -> customer outcomes" growth loop (2026-09-18).
--
-- Part 1: extends conversion_events (0031) from a single signup-only event
-- into a real funnel: signup -> activation -> first_trade -> first_paid.
-- FillbookHQ delivers these server-side (see fillbook's new
-- growthOsSync.ts cron, not a client beacon) via the SAME webhook
-- (api/ingest.ts?source=fillbook_signup) with an added event_type field,
-- keeping one authenticated endpoint rather than four.
--
-- external_event_id is FillbookHQ's own `events.id` (already a stable
-- UUID assigned at insert time on their side) -- using their own primary
-- key as our dedup key means a retried/duplicate delivery is a no-op by
-- construction, no separate id-generation scheme needed on either side.
alter table conversion_events
  add column if not exists event_type text not null default 'signup',
  add column if not exists external_event_id text,
  -- Stable per-user pseudonymous identifier (HMAC of FillbookHQ's user_id,
  -- keyed by a secret only FillbookHQ holds) -- lets rows for the same
  -- real person be correlated across the funnel (did THIS signup later
  -- pay?) without this project ever learning who that person actually is.
  -- Nullable: the original fillbook_signup rows (pre-2026-09-18) have none,
  -- and that's fine -- they only ever fed aggregate signup counts, never
  -- per-user funnel joins.
  add column if not exists subject_hash text,
  -- Distinct from utm_* above (which the 0031 comment already documents as
  -- signup-touch attribution): the campaign/UTM context active at the
  -- MOMENT this specific event happened, which can differ from signup-touch
  -- for activation/first_trade/first_paid (someone can sign up from one
  -- campaign and come back from a different one before converting further).
  add column if not exists event_touch_utm_source text,
  add column if not exists event_touch_utm_medium text,
  add column if not exists event_touch_utm_campaign text,
  add column if not exists event_touch_utm_content text;

alter table conversion_events
  add constraint conversion_events_event_type_check
  check (event_type in ('signup', 'activation', 'first_trade', 'first_paid'));

-- Dedup key: the same external event delivered twice (a retried webhook
-- call, or the sync cron re-processing a batch after a partial failure)
-- must never double-count. Partial (external_event_id is not null) so the
-- pre-existing rows with no id don't collide with each other under a
-- plain unique constraint.
create unique index if not exists conversion_events_external_event_id_idx
  on conversion_events (source, external_event_id)
  where external_event_id is not null;

create index if not exists conversion_events_event_type_idx on conversion_events (event_type);
create index if not exists conversion_events_subject_hash_idx on conversion_events (subject_hash) where subject_hash is not null;

comment on column conversion_events.event_type is
  'signup | activation | first_trade | first_paid -- the funnel stage this row represents. "signup" rows predating 2026-09-18 have no subject_hash and cannot be joined into a per-user funnel, only counted in aggregate.';

-- Part 2: a generalized publication record. Extends the same pattern
-- video_renders.published_url (0034) established -- the owner records the
-- real URL after manually posting -- to every content type (video, X
-- posts/replies, partnership outreach), rather than each asset type
-- growing its own bespoke published-tracking column.
--
-- Deliberately a separate table from campaign_assets rather than adding
-- a "published" value to AssetStage (campaignFactory.ts): the pipeline
-- stage enum tracks DRAFTING progress and stops at a real, load-bearing
-- terminal value ('handed_off' = composer opened, see campaignFactory.ts's
-- own doc comment) -- adding a stage past that would mean every piece of
-- code that treats 'handed_off'/'retired' as terminal (STAGE_ORDER
-- indexing, applyOwnerDecisionIfPending's pending-check, etc.) would need
-- auditing for an off-by-one. Publication is a separate concern recorded
-- alongside the pipeline, exactly how video_renders already works
-- (its own table, not a campaign_assets column).
--
-- One row per (campaign_asset_id, channel): a single video can be posted
-- to TikTok AND YouTube AND Instagram, each with its own real URL --
-- video_renders.published_url (a single column) could only ever hold one.
-- This table is now the source of truth going forward; video_renders.
-- published_url is left in place for backward read-compatibility with
-- any code that hasn't been updated yet (see videoStatusHandlers.ts),
-- and setVideoPublishedUrl now also upserts a row here.
create table if not exists content_publications (
  id uuid primary key default gen_random_uuid(),
  campaign_asset_id uuid not null references campaign_assets(id) on delete cascade,
  -- 'x' | 'youtube' | 'tiktok' | 'instagram' | 'email' | 'other' -- free
  -- text, not an enum: matches campaign_assets.platform's own free-text
  -- convention (see 0009_creator_network.sql's platform column) rather
  -- than introducing a second, possibly-drifting platform vocabulary.
  channel text not null,
  -- The trackable destination link generated for this asset (see
  -- backend/src/attribution/utmBuilder.ts) -- copyable and recorded
  -- independently of whether the owner has confirmed publishing yet, so
  -- "Copy tracking link" never implies "this is now published."
  destination_link text,
  -- The real external URL the owner pasted back in after posting --
  -- null until they do. Never independently verified against the real
  -- platform (this app has no read access to TikTok/YouTube/Instagram/X
  -- APIs for the owner's own posts beyond the narrow YouTube-comments
  -- case) -- see evidence_type.
  actual_url text,
  -- 'owner_reported_url': the owner pasted a real URL (actual_url is set).
  -- 'owner_confirmed_no_url': the owner confirmed they posted but the
  -- surface has no separately copyable link (e.g. a plain X reply -- the
  -- reply IS the post, there's no separate "video page" URL the way a
  -- YouTube upload has one). Both are the owner's own self-report, never
  -- an independent platform-side confirmation -- surfaced as "owner-
  -- confirmed" everywhere in the UI/API, never "verified" or "posted"
  -- unqualified, so nobody mistakes this for proof the post is actually
  -- live.
  evidence_type text not null check (evidence_type in ('owner_reported_url', 'owner_confirmed_no_url')),
  -- When the owner says they posted it (may predate recorded_at if they
  -- posted first and came back to log it later).
  owner_reported_published_at timestamptz,
  -- When THIS row was written -- i.e. when the owner actually told us,
  -- regardless of when they say the post itself went out.
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_asset_id, channel)
);
create index if not exists content_publications_campaign_asset_id_idx on content_publications (campaign_asset_id);
alter table content_publications enable row level security;

comment on table content_publications is
  'Owner-confirmed "I posted this" records, one per (campaign_asset_id, channel). Existence of a row here is the ONLY thing that means "owner_confirmed_published" for that asset+channel -- campaigns.status/campaign_assets.stage reaching approved/handed_off means generated/approved/composer_opened respectively, never published on their own. See analytics/publicationState.ts for the exact derivation used by every screen.';
