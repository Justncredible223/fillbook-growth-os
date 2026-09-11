-- Closes the attribution loop this project's own docs flagged as open
-- (docs/PROGRESS_LEDGER.md: "closing the attribution loop... need [DB
-- access or a webhook from FillbookHQ]... Neither was pursued this pass").
-- Deliberately a webhook receiver, not a read-only role on FillbookHQ's
-- Supabase project -- see docs/ARCHITECTURE.md's isolation goal ("a
-- mistake in Growth OS can never touch the paying product's data path").
-- FillbookHQ decides what it shares (utm_* + referral_code + timestamp
-- only, no email/PII); this project never gets a live credential into the
-- paying product's database.
create table conversion_events (
  id uuid primary key default gen_random_uuid(),
  -- Always "fillbook_signup" today; a distinct value per event source
  -- rather than a boolean so a second conversion type (e.g. a future
  -- "upgraded to paid" webhook) can share this table later.
  source text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  referral_code text,
  -- When the signup actually happened, per the caller -- may differ
  -- slightly from received_at under retry/queueing, though this is a
  -- synchronous fire-and-forget POST today so the gap is normally
  -- sub-second.
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index conversion_events_utm_campaign_idx on conversion_events (utm_campaign) where utm_campaign is not null;
create index conversion_events_utm_content_idx on conversion_events (utm_content) where utm_content is not null;
alter table conversion_events enable row level security;

-- Per-reply/per-contact click attribution (docs/PROSPECTING.md: "Per-reply
-- link attribution isn't real yet" -- only aggregate UTM-campaign level
-- existed). One row per click through a Growth-OS-issued short link;
-- link_key identifies which specific prospecting reply, partnership
-- outreach, or content asset the link was attached to, distinct from
-- utm_content which only identifies the campaign/asset in aggregate.
create table link_clicks (
  id uuid primary key default gen_random_uuid(),
  link_key text not null,
  target_url text not null,
  clicked_at timestamptz not null default now(),
  referer text,
  user_agent text
);
create index link_clicks_link_key_idx on link_clicks (link_key);
alter table link_clicks enable row level security;
