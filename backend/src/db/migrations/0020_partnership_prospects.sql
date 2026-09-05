-- Partnerships -- a manual-first prospect/pitch/pilot pipeline, separate
-- from Prospecting (other people's public posts on X/Reddit) and Inbound
-- (people who engaged with @FillbookHQ). See docs/PARTNERSHIPS_MISSION.md
-- for the full requirements this implements.
--
-- Stage is enforced in code (see stageTransitions.ts), not purely by this
-- CHECK constraint -- same "code-enforced, not SQL-enforced" discipline as
-- creatorNetwork.ts's advanceReadiness for the Creators table.
--
-- normalized_domain/normalized_handle exist so dedup.ts can cross-reference
-- this table against creators/prospecting_candidates/inbound_engagements
-- without re-deriving normalization logic in SQL.

create table partnership_prospects (
  id uuid primary key default gen_random_uuid(),
  organization_name text not null,
  contact_name text,
  partner_category text not null check (partner_category in ('educator_coach','creator_community','prop_firm','platform_broker','other')),
  stage text not null default 'prospect' check (stage in (
    'prospect','qualified','draft_ready','contacted','replied','pilot','active_partner','closed','archived','do_not_contact'
  )),
  website_url text,
  social_links jsonb not null default '{}',
  -- e.g. "email: coach@example.com" or "X DM: @handle" -- null until researched.
  contact_route text,
  contact_route_source text,
  audience_focus text,
  futures_relevance_evidence text,
  source_urls text[] not null default '{}',
  research_date date,
  competing_journal_relationships text,
  competing_journal_evidence text,
  proposed_collaboration text,
  qualification_rationale text,
  owner_notes text,
  next_action text,
  next_action_due_date date,
  pilot_terms_proposed text,
  pilot_terms_agreed text,
  pilot_start_date date,
  pilot_end_date date,
  referral_code text,
  follow_up_count integer not null default 0,
  -- The campaign_assets row (asset_type='partnership_pitch') currently
  -- approved for contact -- null until a draft has passed review. Cleared
  -- (not just left stale) whenever the underlying text is materially
  -- edited after approval, so "approved" can never silently drift from
  -- what's actually been reviewed.
  approved_campaign_asset_id uuid references campaign_assets(id),
  contacted_at timestamptz,
  contacted_channel text,
  normalized_domain text,
  normalized_handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partnership_prospects_stage_idx on partnership_prospects (stage);
create index partnership_prospects_normalized_domain_idx on partnership_prospects (normalized_domain);
create index partnership_prospects_normalized_handle_idx on partnership_prospects (normalized_handle);
alter table partnership_prospects enable row level security;

create table partnership_interactions (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references partnership_prospects(id) on delete cascade,
  interaction_type text not null check (interaction_type in (
    'note','draft_generated','contacted','reply_received','follow_up_sent','pilot_started','pilot_ended','outcome_recorded'
  )),
  occurred_at timestamptz not null default now(),
  summary text not null,
  created_at timestamptz not null default now()
);
create index partnership_interactions_partnership_id_idx on partnership_interactions (partnership_id);
alter table partnership_interactions enable row level security;

-- Outcomes are separate from the prospect row so "measured vs
-- manually-entered vs unavailable" stays an explicit, queryable
-- distinction per-metric, never an ambiguous free-text field -- and so a
-- metric simply having no row here reads as "unavailable", never "zero".
create table partnership_outcomes (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references partnership_prospects(id) on delete cascade,
  metric text not null check (metric in ('signups','activations','paid_conversions','retention','referral_cost_usd')),
  value numeric,
  source text not null check (source in ('measured','manual_entry')),
  note text,
  recorded_at timestamptz not null default now()
);
create index partnership_outcomes_partnership_id_idx on partnership_outcomes (partnership_id);
alter table partnership_outcomes enable row level security;
