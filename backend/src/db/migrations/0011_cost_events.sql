-- Cost Intelligence (minimal start). Every LLM call this system makes
-- (drafting + the nine review agents) now costs real money -- this table
-- is the first real evidence-based answer to "how much has this spent,"
-- not a guess. Deliberately narrow scope: one event type (llm_call) for
-- now; expand event_type as other cost sources (video rendering compute,
-- X Owned Reads, etc.) get tracked for real instead of estimated.

create table cost_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null default 'llm_call',
  provider text not null default 'anthropic',
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_usd numeric(10, 6) not null,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index cost_events_created_at_idx on cost_events (created_at);

alter table cost_events enable row level security;
