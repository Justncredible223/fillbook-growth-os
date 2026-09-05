-- Partnerships discovery/ranking -- adds the fields needed to show a
-- ranked, evidence-backed recommendation (score/confidence/how it was
-- found) instead of only supporting manual prospect entry, plus a run
-- log so scheduled discovery is idempotent and its own state (running /
-- no matches / source failure / budget exhaustion) is queryable without
-- inventing a separate always-on job tracker. See
-- docs/PARTNERSHIPS_MISSION.md's addendum and
-- backend/src/partnerships/discoveryScoring.ts for how these are computed.

alter table partnership_prospects
  add column discovery_score numeric,
  add column discovery_confidence text check (discovery_confidence in ('low', 'medium', 'high')),
  add column discovered_via text check (discovered_via in ('manual', 'creators', 'prospecting', 'inbound', 'x_search'));

comment on column partnership_prospects.discovery_score is 'Ranking score (0-100) computed by discoveryScoring.ts at discovery time -- null for manually entered prospects.';
comment on column partnership_prospects.discovery_confidence is 'How much evidence backs discovery_score -- surfaced in the UI so thin evidence is never presented as a strong match.';
comment on column partnership_prospects.discovered_via is '''manual'' for owner-entered prospects (the pre-existing path); the other four values are how the automated discovery step found this one -- never overwritten after creation.';

-- One row per discovery run (scheduled or owner-triggered) -- mirrors
-- x_feed_post_runs' reasoning: makes "when did this last run, what did
-- it find, did it fail or get budget-capped" queryable state instead of
-- something only inferable from partnership_prospects rows (which would
-- break entirely on a run that finds zero new candidates).
create table partnership_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  triggered_by text not null check (triggered_by in ('scheduled', 'owner')),
  status text not null check (status in ('found', 'no_matches', 'budget_exhausted', 'error')),
  new_candidates integer not null default 0,
  sources_searched text[] not null default '{}',
  cost_usd numeric not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index partnership_discovery_runs_created_at_idx on partnership_discovery_runs (created_at);
alter table partnership_discovery_runs enable row level security;
