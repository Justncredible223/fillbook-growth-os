-- Experiments -- before/after content-performance tests. See
-- backend/src/experiments/types.ts for why "control vs treatment" here
-- means time periods, not a randomized traffic split (no such
-- infrastructure exists -- one X/YouTube/TikTok account, not two).
create table experiments (
  id uuid primary key default gen_random_uuid(),
  hypothesis text not null,
  scope jsonb not null default '{}',
  guardrail_note text,
  status text not null default 'draft' check (status in ('draft', 'running', 'completed', 'aborted')),
  start_date date not null,
  end_date date,
  control_window_start date not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index experiments_status_idx on experiments (status);
alter table experiments enable row level security;
