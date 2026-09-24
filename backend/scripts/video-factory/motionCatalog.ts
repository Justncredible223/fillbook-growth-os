/**
 * The reusable bridge between an approved campaign script and the
 * verified-evidence ScenePlan world (src/shortform/pilots.ts,
 * verified-manifest.json). verified-manifest.json is already the actual
 * catalog -- every asset in it declares its own topics, facts (the claims
 * it can support, with real on-screen values), dataLabel (demo-data
 * provenance), timeRangeSeconds per fact (usable time ranges), and
 * privateRegions (privacy information). This module is the SELECTION
 * logic over that catalog, not a second copy of it.
 *
 * Deliberately conservative in TWO ways:
 *
 * 1. Never fuzzy-matches a campaign's free-text shot list/narration
 *    against asset topics -- an LLM-generated shot list has no structured
 *    claim/evidence model the way a ScenePlan does, and topic-tag text
 *    matching would risk attaching a pilot's fixture-specific numbers to a
 *    topically-similar but factually unrelated script.
 *
 * 2. (2026-09-23, fixed a real gap) Never uses hook-TEXT equality as
 *    authorization either -- an earlier version of this file did exactly
 *    that (`findMatchingScenePlan`), which meant a coincidentally
 *    identical hook on an approved script with a DIFFERENT body/figures/
 *    claims would still cause the worker to substitute the pilot's own
 *    canned narration for whatever was actually approved. Motion is now
 *    only ever selected when the approved script carries an EXPLICIT
 *    `motionScenePlan` reference (scenePlanId + a content hash computed at
 *    generation time, see videoScriptWriter.ts's buildVideoScriptFromScenePlan),
 *    and `resolveMotionScenePlan` below recomputes that hash from the
 *    CURRENT plan and refuses to render on any mismatch -- so neither a
 *    stale pilots.ts edit nor a same-hook-different-body script can ever
 *    select a plan whose content doesn't actually match what was approved.
 *
 * Any script with no `motionScenePlan` reference (the normal case for the
 * vast majority of campaigns -- free topic or existing opportunity) gets
 * the existing stock-footage/UI-screenshot pipeline, completely unchanged,
 * with an explicit (never silent) log line saying why.
 *
 * To add a new motion-backed concept in the future: author its ScenePlan
 * (pilots.ts) and verified assets (verified-manifest.json) the same way
 * the three pilots were, and add it to CATALOG_SCENE_PLANS below -- no
 * change to render-single.ts or this resolution logic is needed.
 */
import { computeScenePlanHash } from "../../src/shortform/scenePlan.js";
import { PILOTS } from "../../src/shortform/pilots.js";
import type { ScenePlan, VerifiedManifest } from "../../src/shortform/types.js";
import type { VideoScript } from "./types.js";
import { buildVideoScriptFromScenePlan } from "../../src/content/videoScriptWriter.js";

const CATALOG_SCENE_PLANS: ScenePlan[] = PILOTS;

/** Every manually-created motion-concept opportunity's rationale carries this marker as its own trailing token, followed by the plan's id -- see api/run-campaign.ts and campaignPipeline.ts's own parsing of it. Never user-typed text: only ever written by server code after validating the id against CATALOG_SCENE_PLANS. */
export const MOTION_CONCEPT_REF_PREFIX = "MOTION_CONCEPT_REF:";

const MOTION_CONCEPT_REF_PATTERN = /MOTION_CONCEPT_REF:(\S+)/;

/** Finds a `MOTION_CONCEPT_REF:<id>` marker anywhere in an opportunity's rationale (it shares the field with a human-readable sentence -- see manualMotionConceptOpportunityInput), or null if absent. Pure/exported for direct unit testing. */
export function extractMotionConceptRefFromRationale(rationale: string): string | null {
  return MOTION_CONCEPT_REF_PATTERN.exec(rationale)?.[1] ?? null;
}

export interface MotionConceptSummary {
  id: string;
  title: string;
  hook: string;
  topic: string;
}

/** The fixed, small list of concepts a caller (the Android app's "Create Fillbook Video") can show as "has verified motion" -- never inferred, never open-ended. */
export function listMotionConcepts(): MotionConceptSummary[] {
  return CATALOG_SCENE_PLANS.map((p) => ({ id: p.planId, title: p.title, hook: p.hook, topic: p.topic }));
}

export interface MotionMatchResult {
  plan: ScenePlan | null;
  /** Always populated -- the reason motion was or wasn't selected, for the worker's own log/report. Never silent either way. */
  reason: string;
}

/**
 * The ONLY function that decides whether to use verified motion for a
 * render -- see this file's own doc comment for why hook-text matching
 * alone (the prior design) was insufficient. Three outcomes:
 *
 *  - No `motionScenePlan` reference at all -> `{ plan: null }`, the normal
 *    stock-footage/UI-screenshot path (the vast majority of scripts).
 *  - A reference to an unknown `scenePlanId`, or whose `scenePlanHash`
 *    doesn't match the CURRENT plan's computeScenePlanHash -> throws
 *    (never silently falls back to stock footage for a script that was
 *    explicitly authorized for verified evidence -- a mismatch means
 *    something is genuinely wrong: pilots.ts changed since generation, a
 *    stale/tampered reference, or a bug, and rendering ANYTHING for that
 *    claim without resolving it first would risk showing evidence that no
 *    longer matches what was actually approved).
 *  - A reference whose hash matches AND whose approved `script`/`hook`
 *    text still equals the CANONICAL text buildVideoScriptFromScenePlan
 *    would generate from that plan right now -> `{ plan }`, safe to
 *    render via scenePlanAdapter.ts, using ONLY that plan's own
 *    narration/claims (never the approved script's own `script`/
 *    `shotList` fields at render time -- those exist for the review
 *    agents' benefit, since they only ever see flattened text).
 *
 * The hash alone (2026-09-23 first fix) only proves the CATALOG PLAN
 * hasn't changed since generation -- it says nothing about whether the
 * APPROVED SCRIPT ROW ITSELF still matches what was generated from that
 * plan. A later revision/edit step that rewrote `script`/`hook` while
 * leaving `motionScenePlan` untouched would pass the hash check yet no
 * longer represent what reviewers actually approved -- closed
 * (2026-09-23, second fix) by additionally recomputing the canonical
 * VideoScript from the plan and comparing it against the approved one
 * field by field. A mismatch here means the approved row and the plan it
 * claims to reference have diverged -- rendering the PLAN's real content
 * for a script whose own text says something else would silently
 * misrepresent what was reviewed, so this throws rather than picking
 * either version.
 */
export function resolveMotionScenePlan(videoScript: Pick<VideoScript, "hook" | "script" | "motionScenePlan">): MotionMatchResult {
  const ref = videoScript.motionScenePlan;
  if (!ref) {
    return { plan: null, reason: "This script carries no motionScenePlan reference -- no motion concept was requested; using the standard stock-footage/UI-screenshot pipeline." };
  }
  const plan = CATALOG_SCENE_PLANS.find((p) => p.planId === ref.scenePlanId);
  if (!plan) {
    throw new Error(
      `Approved script references motionScenePlan "${ref.scenePlanId}", which is not a known verified ScenePlan (known: ${CATALOG_SCENE_PLANS.map((p) => p.planId).join(", ")}). ` +
        `Refusing to fall back to stock footage for a script explicitly authorized for verified evidence.`,
    );
  }
  const currentHash = computeScenePlanHash(plan);
  if (currentHash !== ref.scenePlanHash) {
    throw new Error(
      `Approved script's motionScenePlan reference for "${plan.planId}" has hash ${ref.scenePlanHash.slice(0, 12)}..., but the CURRENT plan hashes to ${currentHash.slice(0, 12)}... -- ` +
        `the plan's content changed since this script was generated/approved (or the reference was never valid). Refusing to render: never substituting the current plan's narration/claims for what was actually approved.`,
    );
  }
  if (plan.hook !== videoScript.hook) {
    throw new Error(
      `Approved script's motionScenePlan reference resolves to plan "${plan.planId}", but the approved hook ("${videoScript.hook}") does not match that plan's own hook ("${plan.hook}"). Refusing to render.`,
    );
  }
  // Content-integrity check: the plan (and its hash) matching is not
  // enough on its own -- the APPROVED SCRIPT ROW's own narration must
  // still be the canonical text this plan generates, or a revision/edit
  // step could have rewritten the approved body/figures while leaving the
  // reference untouched, and reviewers would have approved words that
  // will never actually be spoken (the render always uses the plan's own
  // per-scene narration, never this field).
  const canonical = buildVideoScriptFromScenePlan(plan);
  if (canonical.script !== videoScript.script) {
    throw new Error(
      `Approved script's motionScenePlan reference resolves to plan "${plan.planId}", and the hash/hook both match, but the approved script's own narration text no longer equals the canonical text this plan generates -- ` +
        `it was edited/revised after generation without updating the reference (or the two were never consistent). Refusing to render: the plan's real evidence-backed narration would not match what was actually reviewed and approved.`,
    );
  }
  return { plan, reason: `Resolved verified ScenePlan "${plan.planId}" via its explicit motionScenePlan reference (hash- and content-verified against the current plan).` };
}

/** One catalog row's worth of reportable metadata -- feature/topic, supported claims, provenance, usable time ranges, privacy -- for the worker's own selection report (never fabricated: read straight from the manifest). */
export interface CatalogAssetSummary {
  assetId: string;
  kind: string;
  topics: string[];
  dataLabel: string | null;
  verifiedByOwner: boolean;
  supportedFacts: { key: string; values: string[]; timeRangeSeconds?: { start: number; end: number } }[];
  privateRegionCount: number;
}

export function summarizeCatalog(manifest: VerifiedManifest): CatalogAssetSummary[] {
  return manifest.assets.map((a) => ({
    assetId: a.id,
    kind: a.kind,
    topics: a.topics,
    dataLabel: a.dataLabel,
    verifiedByOwner: a.verifiedByOwner,
    supportedFacts: a.facts.map((f) => ({ key: f.key, values: f.values, timeRangeSeconds: f.timeRangeSeconds })),
    privateRegionCount: a.privateRegions.length,
  }));
}

/** Just the assets a given ScenePlan actually uses, for a worker's per-render "here is exactly what was selected" report. */
export function summarizeUsedAssets(plan: ScenePlan, manifest: VerifiedManifest): CatalogAssetSummary[] {
  const usedIds = new Set(plan.scenes.map((s) => s.assetId).filter((id): id is string => id !== null));
  return summarizeCatalog(manifest).filter((a) => usedIds.has(a.assetId));
}
