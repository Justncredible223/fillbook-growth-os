-- Inbound Engagement Queue -- closes a real gap found by full-repo audit
-- (see docs/PROGRESS_LEDGER.md): every X mention was previously ingested
-- as a generic Opportunity-Engine "signal" (source='x_mention'), scored
-- and displayed identically to a YouTube video idea or a Search Console
-- query. Nothing anywhere recorded whether a specific person's reply or
-- mention had actually been answered. This table is deliberately
-- separate from `signals`/`opportunities` -- those model "topics worth
-- writing content about"; this models "a specific person said something
-- to us and may be waiting on a reply," a different lifecycle entirely
-- (conversation threading, response drafting, human-confirmed
-- completion) that doesn't belong bolted onto the discovery engine.

create table inbound_engagements (
  id uuid primary key default gen_random_uuid(),
  platform text not null,                    -- 'x' today; same free-text convention as signals.source
  external_id text not null,                 -- the platform's stable id for this specific post/reply -- dedup key
  conversation_id text,                      -- groups every message in one reply chain
  in_reply_to_external_id text,              -- the parent tweet id this replies to, if any
  author_handle text,
  author_external_id text,
  creator_id uuid references creators(id),   -- linked relationship context, when the author is a tracked creator
  body text not null,
  in_response_to_text text,                  -- best-effort context: what this appears to be replying to
  public_metrics jsonb not null default '{}',
  priority text not null
    check (priority in ('p1_direct_reply', 'p2_relationship', 'p3_comment', 'p4_mention', 'low_value')),
  status text not null default 'new'
    check (status in ('new', 'needs_response', 'draft_ready', 'responded', 'follow_up', 'review_needed', 'closed')),
  draft_response text,
  responded_at timestamptz,
  responded_note text,                       -- human-entered confirmation note (platform APIs can't always confirm a reply was sent)
  is_repeat_engager boolean not null default false,
  observed_at timestamptz not null,
  source_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id)
);
create index inbound_engagements_status_idx on inbound_engagements (status);
create index inbound_engagements_conversation_idx on inbound_engagements (conversation_id);
create index inbound_engagements_author_idx on inbound_engagements (author_external_id);
create index inbound_engagements_observed_at_idx on inbound_engagements (observed_at desc);

alter table inbound_engagements enable row level security;

-- integration_health (migration 0001) existed but was never read or
-- written by any code -- confirmed by full-repo grep. Putting it to real
-- use here rather than inventing a parallel table. Adds the
-- attempt-vs-success distinction the inbound sync needs: a bare
-- "last_checked_at" can't tell a caller whether that check succeeded or
-- failed, which is exactly the ambiguity that lets a broken sync look
-- like a healthy empty queue.
alter table integration_health add column last_attempted_at timestamptz;
alter table integration_health add column last_success_at timestamptz;
