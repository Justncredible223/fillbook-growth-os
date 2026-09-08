-- The recipient's OWN real words (post text, creator notes), stored
-- separately from the prose "why this partner"/evidence-gap narrative
-- text -- those already exist in qualification_rationale/
-- futures_relevance_evidence, but a quote embedded in a sentence isn't
-- reliably recoverable at pitch-generation time. Storing the raw
-- excerpts directly is what lets generateDraftForPartnership hand the
-- writer and all nine reviewers the SAME real evidence discovery
-- actually gathered, instead of just a recipient name and a channel.
-- See backend/src/partnerships/discoveryScoring.ts's rawExcerpts and
-- backend/src/content/contentWriter.ts's pitchContext.

alter table partnership_prospects
  add column evidence_excerpts text[] not null default '{}';

comment on column partnership_prospects.evidence_excerpts is 'The recipient''s own real words (post text, bio, creator notes) -- never invented, never a description of the discovery process. Empty for manually entered prospects unless the owner adds their own research here.';
