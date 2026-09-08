-- Reversible, system-driven suppression -- distinct from the owner-driven
-- 'archived'/'do_not_contact' stages, which stay authoritative and are
-- never touched by automated reassessment. Used when a prospect no longer
-- passes hasConcretePartnershipBasis (see discoveryScoring.ts): the
-- prospect's stage, history, and interactions are all left completely
-- untouched -- only this column changes, and it's just as easily cleared
-- if the evidence is later updated or the check improves.

alter table partnership_prospects add column suppressed_reason text;
alter table partnership_prospects add column suppressed_at timestamptz;

comment on column partnership_prospects.suppressed_reason is 'Set by automated reassessment (see recommendationReassessment.ts) when stored evidence no longer shows a concrete partnership basis -- null means not suppressed. Never set for a prospect the owner has already archived/marked do-not-contact/moved past draft_ready, and never overrides those owner decisions. Reversible: cleared automatically if the evidence later passes reassessment again.';
