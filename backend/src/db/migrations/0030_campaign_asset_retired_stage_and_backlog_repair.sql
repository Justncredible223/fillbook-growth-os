-- Closes a real, confirmed bug: Approving/rejecting a campaign_assets row
-- (via api/approvals.ts) only ever updated campaigns.status (approved/
-- retired) -- the asset's own `stage` column was never touched, so it
-- stayed at 'ready_for_owner' forever afterward. That row then became
-- invisible in the Approvals screen (which correctly requires
-- campaigns.status='in_review' to show up) while still permanently
-- counted by the auto-draft backlog cap (BACKLOG_CAP, checked against a
-- raw stage='ready_for_owner' count). The application-code fix (this
-- migration's companion) makes Approve/Reject transition the asset's
-- stage going forward; this migration adds the one new stage value that
-- fix needs, plus a one-time, idempotent repair for rows already stuck
-- by the bug before this fix existed.
--
-- Deliberately does NOT touch any row whose campaign is still 'draft' or
-- 'in_review' -- a 'draft' campaign is exactly a Partnership pitch
-- awaiting its own Partnerships-tab workflow (see
-- src/partnerships/partnershipsHandlers.ts, which never sets
-- campaigns.status at all), and 'in_review' is a genuinely still-
-- reviewable asset. Neither is touched here.

-- 1. Add 'retired' as a valid campaign_assets.stage value -- Reject's new
-- terminal stage, mirroring campaigns.status's own 'retired' outcome.
-- The original CREATE TABLE (migration 0001) defined this CHECK inline
-- without a name, so Postgres auto-generated one; found and dropped
-- dynamically here rather than hardcoding a guessed name, so this stays
-- correct even if the actual generated name ever differs.
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'campaign_assets'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%ready_for_owner%handed_off%';

  if con_name is not null then
    execute format('alter table campaign_assets drop constraint %I', con_name);
  end if;
end $$;

alter table campaign_assets add constraint campaign_assets_stage_check check (stage in (
  'idea','evidence_packet','thesis','angle','hook_competition','outline',
  'draft','platform_adaptation','factual_verification','brand_verification',
  'originality_review','anti_slop_review','policy_review','conversion_review',
  'final_draft','ready_for_owner','handed_off','retired'
));

-- 2. One-time, idempotent repair for rows already stuck by the bug.
-- Idempotent: after the first run, no row matches
-- stage='ready_for_owner' AND status in ('approved','retired') anymore,
-- so re-running this is a safe no-op. Never deletes a row or alters any
-- draft text/content_versions -- only the two columns named below.
update campaign_assets ca
set stage = 'handed_off', updated_at = now()
from campaigns c
where c.id = ca.campaign_id
  and ca.stage = 'ready_for_owner'
  and c.status = 'approved';

update campaign_assets ca
set stage = 'retired', updated_at = now()
from campaigns c
where c.id = ca.campaign_id
  and ca.stage = 'ready_for_owner'
  and c.status = 'retired';
