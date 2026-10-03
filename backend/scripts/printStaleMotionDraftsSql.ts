/**
 * Prints two SQL statements for the Supabase SQL editor: a preview, and the cleanup, for motion-concept drafts whose
 * stored plan hash no longer matches the plan in the code.
 *
 * A draft carries the id and content hash of the ScenePlan it was written from, and the render worker refuses a draft
 * whose plan has changed since (scripts/video-factory/motionCatalog.ts: it never renders different content than was
 * approved). When a concept is redesigned (the product-mock slides, 2026-10) every draft made from the old version
 * becomes unrenderable, so this retires them, exactly as pressing Reject does, and the concept can be requested again
 * and drafted fresh. Drafts that already rendered a video are left alone.
 *
 *   npx tsx scripts/printStaleMotionDraftsSql.ts
 */
import { computeScenePlanHash } from "../src/shortform/scenePlan.js";
import { MOTION_SCENE_PLANS, isChartPlan } from "../src/shortform/motionPlans.js";

const values = MOTION_SCENE_PLANS.filter(isChartPlan).map((p) => `    ('${p.planId}', '${computeScenePlanHash(p)}')`).join(",\n");

const staleCtes = `current_plans(plan_id, hash) as (
  values
${values}
),
latest as (
  select distinct on (campaign_asset_id) campaign_asset_id, metadata->'videoScript'->'motionScenePlan' as ref
  from content_versions
  order by campaign_asset_id, version desc
),
stale as (
  select ca.id as asset_id, c.id as campaign_id, c.thesis, c.status, l.ref->>'scenePlanId' as plan_id
  from latest l
  join campaign_assets ca on ca.id = l.campaign_asset_id
  join campaigns c on c.id = ca.campaign_id
  join current_plans cur on cur.plan_id = l.ref->>'scenePlanId'
  where l.ref->>'scenePlanHash' <> cur.hash
    and c.status in ('in_review', 'approved')
    and not exists (select 1 from video_renders vr where vr.campaign_asset_id = ca.id and vr.status = 'ready')
)`;

console.log(`-- STEP 1: preview (changes nothing)
with ${staleCtes}
select thesis, status, plan_id from stale order by thesis;

-- STEP 2: apply (the same as pressing Reject on each one). Run it as one statement.
with ${staleCtes},
retired_campaigns as (
  update campaigns
     set status = 'retired', updated_at = now(), decided_by = 'plan update cleanup', decided_at = now()
   where id in (select campaign_id from stale)
  returning id
),
retired_assets as (
  update campaign_assets
     set stage = 'retired', video_render_dismissed_at = now()
   where id in (select asset_id from stale)
  returning id
)
update video_renders
   set status = 'canceled', updated_at = now()
 where campaign_asset_id in (select id from retired_assets)
   and status in ('queued', 'failed');
`);
