-- Fillbook Growth OS — core schema, Phase 1 (data foundation)
-- Right-sized for the spine subsystems: Signal Graph, Opportunity Engine,
-- Knowledge Brain, Brand Constitution, Campaign/Content Factory,
-- ExternalWriteFirewall audit trail, Approvals, Job infra.
-- Later phases add: creators/outreach, seo_pages/seo_queries, research,
-- experiments, growth_genome, cost_events, attribution, notifications.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Platform Capability Registry
-- ---------------------------------------------------------------------
create table platform_capabilities (
  id uuid primary key default gen_random_uuid(),
  platform text not null,                 -- 'x', 'tiktok', 'youtube', 'search_console', ...
  capability text not null,                -- 'read_mentions', 'publish_video', ...
  read_allowed boolean not null default false,
  automated_processing_allowed boolean not null default false,
  browser_automation_allowed boolean not null default false,
  official_api_available boolean not null default false,
  human_publish_required boolean not null default true,
  oauth_scopes text[] not null default '{}',
  rate_limits text,
  developer_review_required boolean not null default false,
  source_url text not null,
  verified_at timestamptz not null,
  implementation_status text not null default 'not_started'
    check (implementation_status in ('not_started','planned','in_progress','implemented','blocked')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, capability)
);

-- ---------------------------------------------------------------------
-- Brand Constitution (versioned)
-- ---------------------------------------------------------------------
create table brand_rules (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  rule_type text not null
    check (rule_type in (
      'positioning','voice','vocabulary_preferred','vocabulary_prohibited',
      'claim_allowed','claim_prohibited','cta_philosophy','competitor_rule',
      'disclosure_rule','financial_claim_restriction'
    )),
  content text not null,
  source_doc text,                         -- e.g. 'fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md'
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index brand_rules_version_idx on brand_rules (version);

-- ---------------------------------------------------------------------
-- Knowledge Brain
-- ---------------------------------------------------------------------
create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  topic text not null,                     -- 'pricing', 'ai_coach', 'prop_firm_rules', ...
  title text not null,
  content text not null,
  source_url text,
  source_doc text,
  trust_level text not null default 'verified'
    check (trust_level in ('verified','needs_review','deprecated')),
  effective_at timestamptz not null default now(),
  superseded_by uuid references knowledge_documents(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Signal Graph
-- ---------------------------------------------------------------------
create table signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,                    -- 'search_console', 'youtube_analytics', 'public_web', ...
  topic text,
  evidence jsonb not null default '{}',
  observed_at timestamptz not null,
  confidence numeric(3,2) not null default 0.5 check (confidence between 0 and 1),
  velocity numeric,
  fillbook_relevance numeric(3,2) check (fillbook_relevance between 0 and 1),
  audience_relevance numeric(3,2) check (audience_relevance between 0 and 1),
  privacy_classification text not null default 'public'
    check (privacy_classification in ('public','aggregated','internal_sensitive')),
  source_reference text,
  cluster_id uuid,
  created_at timestamptz not null default now()
);
create index signals_source_idx on signals (source);
create index signals_cluster_idx on signals (cluster_id);
create index signals_observed_at_idx on signals (observed_at);

-- ---------------------------------------------------------------------
-- Opportunity Engine
-- ---------------------------------------------------------------------
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  score numeric(5,2) not null,
  urgency text not null default 'normal' check (urgency in ('low','normal','high')),
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  rationale text not null,
  recommended_channels text[] not null default '{}',
  recommended_campaign_type text,
  approval_class text not null default 'EXTERNAL_DRAFT'
    check (approval_class in ('READ','INTERNAL_WRITE','EXTERNAL_DRAFT','EXTERNAL_WRITE')),
  status text not null default 'open'
    check (status in ('open','actioned','dismissed','expired')),
  signal_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opportunities_status_idx on opportunities (status);
create index opportunities_score_idx on opportunities (score desc);

-- ---------------------------------------------------------------------
-- Campaign / Content Factory
-- ---------------------------------------------------------------------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities(id),
  thesis text not null,
  status text not null default 'draft'
    check (status in ('draft','in_review','approved','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaign_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  platform text not null,                  -- 'x', 'tiktok', 'youtube', 'blog', 'email', ...
  asset_type text not null,                -- 'post', 'thread', 'video', 'article', 'graphic', ...
  stage text not null default 'idea'
    check (stage in (
      'idea','evidence_packet','thesis','angle','hook_competition','outline',
      'draft','platform_adaptation','factual_verification','brand_verification',
      'originality_review','anti_slop_review','policy_review','conversion_review',
      'final_draft','ready_for_owner','handed_off'
    )),
  approval_class text not null default 'EXTERNAL_DRAFT'
    check (approval_class in ('EXTERNAL_DRAFT','EXTERNAL_WRITE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaign_assets_campaign_idx on campaign_assets (campaign_id);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_asset_id uuid not null references campaign_assets(id) on delete cascade,
  version integer not null,
  body text not null,
  metadata jsonb not null default '{}',
  created_by text not null default 'system', -- 'system' | 'owner_edit'
  created_at timestamptz not null default now(),
  unique (campaign_asset_id, version)
);

create table content_scores (
  id uuid primary key default gen_random_uuid(),
  content_version_id uuid not null references content_versions(id) on delete cascade,
  evaluator text not null,                 -- 'trader','hook_specialist','copy_editor','skeptic',
                                            -- 'brand_guardian','growth_strategist','fact_checker',
                                            -- 'integrity_reviewer','conversion_reviewer'
  verdict text not null check (verdict in ('pass','fail','needs_revision')),
  score numeric(3,2) check (score between 0 and 1),
  notes text,
  created_at timestamptz not null default now()
);
create index content_scores_version_idx on content_scores (content_version_id);

create table content_sources (
  id uuid primary key default gen_random_uuid(),
  content_version_id uuid not null references content_versions(id) on delete cascade,
  claim text not null,
  claim_class text not null check (claim_class in (
    'verified_fact','evidence_supported_observation','reasonable_hypothesis','opinion'
  )),
  source_url text,
  source_doc text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Approvals + Audit Log (ExternalWriteFirewall trail)
-- ---------------------------------------------------------------------
create table approvals (
  id uuid primary key default gen_random_uuid(),
  campaign_asset_id uuid references campaign_assets(id),
  requested_action text not null,
  action_class text not null check (action_class in ('EXTERNAL_DRAFT','EXTERNAL_WRITE')),
  status text not null default 'pending'
    check (status in ('pending','approved_internally','rejected','handed_off')),
  owner_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  action_name text not null,
  action_class text not null check (action_class in ('READ','INTERNAL_WRITE','EXTERNAL_DRAFT','EXTERNAL_WRITE')),
  outcome text not null check (outcome in ('allowed','drafted','rejected')),
  reason text not null,
  agent text,
  model text,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_created_at_idx on audit_logs (created_at);
create index audit_logs_action_class_idx on audit_logs (action_class);

-- ---------------------------------------------------------------------
-- Durable job infrastructure (table-backed queue, right-sized)
-- ---------------------------------------------------------------------
create table system_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','running','succeeded','failed','dead_letter')),
  idempotency_key text unique,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index system_jobs_status_run_after_idx on system_jobs (status, run_after);

create table dead_letter_jobs (
  id uuid primary key default gen_random_uuid(),
  original_job_id uuid not null,
  job_type text not null,
  payload jsonb not null default '{}',
  last_error text not null,
  attempts integer not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Integration health (per-platform)
-- ---------------------------------------------------------------------
create table integration_health (
  id uuid primary key default gen_random_uuid(),
  platform text not null unique,
  status text not null default 'unknown'
    check (status in ('healthy','degraded','down','not_connected','unknown')),
  last_checked_at timestamptz,
  last_error text,
  notes text
);
