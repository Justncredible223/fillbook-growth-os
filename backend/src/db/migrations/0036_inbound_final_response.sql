-- The owner's own wording when they edited an Inbound draft before posting it
-- (2026-09-20). Mirrors prospecting_candidates.final_reply (0015): only set
-- when it differs from draft_response, so a NULL means "posted as drafted or
-- not yet responded", never "unknown". Read back as tone examples for the
-- reply drafter (see inbound/inboundStyleExamples.ts).
alter table inbound_engagements add column if not exists final_response text;
