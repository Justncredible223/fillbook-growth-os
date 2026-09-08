-- A simple, atomic per-prospect mutex so two concurrent (or duplicate
-- retried) generate-draft calls for the SAME prospect can't both spend
-- real LLM budget on the same work. Deliberately NOT a general
-- cross-prospect budget lock -- that's a separate, larger problem (see
-- discovery.ts's own doc comments on the accepted concurrency
-- limitation for the shared monthly cap); this closes the narrower,
-- more common case of a duplicate tap/retry on one specific prospect.
--
-- No staleness/expiry column deliberately kept out of this first pass --
-- a crashed request could theoretically leave a stuck claim. Accepted
-- for now (a real generate-draft call completes well within Vercel's
-- 60s function limit or fails outright) rather than adding an
-- unbounded-complexity TTL mechanism; if this proves to be a real
-- problem, add a staleness check before making it more complex.

alter table partnership_prospects
  add column generation_claimed_at timestamptz;

comment on column partnership_prospects.generation_claimed_at is 'Set for the duration of one generateDraftForPartnership call to prevent a duplicate/concurrent call for the SAME prospect from double-spending. Null when no generation is in flight.';
