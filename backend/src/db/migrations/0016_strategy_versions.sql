-- Strategy Evolution -- see backend/src/strategy/types.ts for the full
-- rationale. Versioned snapshots, not a single mutable row, so past
-- strategy reads stay auditable (master spec: "Maintain strategy versions").
create table strategy_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  generated_at timestamptz not null default now(),
  topics_to_increase jsonb not null default '[]',
  topics_to_decrease jsonb not null default '[]',
  content_to_retire jsonb not null default '[]',
  formats_to_test jsonb not null default '[]',
  seo_opportunities jsonb not null default '[]',
  creator_opportunities jsonb not null default '[]',
  experiments_to_run jsonb not null default '[]',
  summary text not null,
  low_confidence boolean not null default true,
  created_at timestamptz not null default now()
);
create index strategy_versions_generated_at_idx on strategy_versions (generated_at desc);
alter table strategy_versions enable row level security;
