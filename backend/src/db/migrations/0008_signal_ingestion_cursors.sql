-- Tracks the last external post id ingested per source, so repeated
-- ingestion runs (manual trigger or cron) fetch only new mentions instead
-- of re-inserting duplicate signal rows every time. One row per source;
-- personal-use, single-owner app, same reasoning as system_settings.

create table signal_ingestion_cursors (
  source text primary key,
  last_external_id text not null,
  updated_at timestamptz not null default now()
);

alter table signal_ingestion_cursors enable row level security;
