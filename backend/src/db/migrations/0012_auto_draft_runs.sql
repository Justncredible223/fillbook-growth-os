-- Safe daily auto-drafting. run_date has the UNIQUE constraint that is
-- this whole feature's idempotency mechanism: the auto-draft step in
-- daily-pipeline.ts claims today's run by inserting a row here BEFORE
-- doing any drafting work. A retried/duplicate/overlapping invocation on
-- the same calendar date gets a unique-violation on that insert and
-- stops immediately -- durable, not in-memory.

create table auto_draft_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null unique,
  status text not null check (status in ('drafted', 'skipped', 'failed')),
  skip_reason text,
  opportunity_id uuid references opportunities(id),
  campaign_id uuid references campaigns(id),
  opportunities_considered integer not null default 0,
  opportunities_eligible integer not null default 0,
  ai_calls integer not null default 0,
  cost_usd numeric(10, 6),
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index auto_draft_runs_run_date_idx on auto_draft_runs (run_date);

alter table auto_draft_runs enable row level security;
