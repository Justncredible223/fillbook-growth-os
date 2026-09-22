import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256File, validateScenePlan } from "../../src/shortform/scenePlan";
import { closingScene, makeAsset, makeManifest, makePlan, makeScene } from "./helpers";

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("scene/narration mismatch cannot be silent", () => {
  it("a scene naming a required asset that does not exist is reported as blocked, never substituted", () => {
    const plan = makePlan([makeScene({ assetId: "does.not.exist" }), closingScene()], { requiredAssets: [{ id: "does.not.exist", description: "needs a real capture", mustShow: ["x"] }] });
    const v = validateScenePlan(plan, makeManifest());
    expect(v.blockedByMissingAssets).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.missingAssets.map((m) => m.id)).toEqual(["does.not.exist"]);
    expect(codes(v.issues)).toContain("missing_asset");
  });

  it("an asset id that is neither in the manifest nor declared required is rejected, not silently paired", () => {
    const plan = makePlan([makeScene({ assetId: "mystery" }), closingScene()]);
    const v = validateScenePlan(plan, makeManifest());
    expect(codes(v.issues)).toContain("unknown_asset");
  });

  it("mixing assets from two different demo datasets is rejected", () => {
    const a1 = makeAsset({ id: "asset.test.v1", dataset: "demo-a" });
    const a2 = makeAsset({ id: "a2", dataset: "demo-b", facts: a1.facts.map((f) => ({ ...f, key: `${f.key}2` })) });
    const s2 = makeScene({ sceneId: "s2", assetId: "a2", claims: [{ id: "c2", type: "data_point", text: "x", evidence: [{ assetId: "a2", factKey: "buffer2" }] }] });
    const plan = makePlan([makeScene(), s2, closingScene()]);
    const v = validateScenePlan(plan, makeManifest(a1, a2));
    expect(codes(v.issues)).toContain("mixed_datasets");
  });

  it("a scene missing its demo-data disclosure is rejected when the asset is labeled demo data", () => {
    const plan = makePlan([makeScene({ disclosure: null }), closingScene()]);
    expect(codes(validateScenePlan(plan, makeManifest()).issues)).toContain("missing_demo_label");
  });

  it("an experiment/variation id that does not match the plan's own is rejected", () => {
    const plan = makePlan([makeScene({ experimentId: "other-exp" }), closingScene()]);
    expect(codes(validateScenePlan(plan, makeManifest()).issues)).toContain("experiment_mismatch");
  });

  it("a duplicate scene id is rejected", () => {
    const plan = makePlan([makeScene(), makeScene(), closingScene()]);
    expect(codes(validateScenePlan(plan, makeManifest()).issues)).toContain("duplicate_scene_id");
  });
});

describe("handle and CTA placement", () => {
  it("requires exactly one @fillbookhq in the closing scene's visible text, and nowhere else", () => {
    const good = makePlan([makeScene(), closingScene()]);
    expect(codes(validateScenePlan(good, makeManifest()).issues)).not.toContain("handle_placement");

    const none = makePlan([makeScene(), closingScene({ cta: "Follow us" })]);
    expect(codes(validateScenePlan(none, makeManifest()).issues)).toContain("handle_placement");

    const twice = makePlan([makeScene({ headline: "Find @fillbookhq" }), closingScene()]);
    expect(codes(validateScenePlan(twice, makeManifest()).issues)).toContain("handle_placement");
  });

  it("requires exactly one CTA scene, and it must be the last one", () => {
    const twoCtas = makePlan([makeScene({ cta: "Follow @fillbookhq" }), closingScene()]);
    expect(codes(validateScenePlan(twoCtas, makeManifest()).issues)).toContain("cta_placement");

    const ctaNotLast = makePlan([makeScene({ cta: "Follow @fillbookhq" }), closingScene({ cta: null, headline: "Read the rule @fillbookhq" })]);
    expect(codes(validateScenePlan(ctaNotLast, makeManifest()).issues)).toContain("cta_placement");
  });
});

describe("duration and validity", () => {
  it("rejects a plan whose total runtime is over the hard limit", () => {
    const plan = makePlan([makeScene({ durationSeconds: 40 }), closingScene({ durationSeconds: 25 })]);
    expect(codes(validateScenePlan(plan, makeManifest()).issues)).toContain("video_too_long");
  });
  it("only reviews (does not error) a plan over the soft target but under the hard limit", () => {
    const plan = makePlan([makeScene({ durationSeconds: 20 }), closingScene({ durationSeconds: 18 })]);
    const v = validateScenePlan(plan, makeManifest());
    expect(v.issues.find((i) => i.code === "video_long")?.severity).toBe("review");
    expect(codes(v.issues)).not.toContain("video_too_long");
  });
});

describe("owner verification is surfaced, never assumed", () => {
  it("flags every asset the owner has not verified, as a review item", () => {
    const asset = makeAsset({ verifiedByOwner: false });
    const plan = makePlan([makeScene(), closingScene()]);
    const v = validateScenePlan(plan, makeManifest(asset));
    const issue = v.issues.find((i) => i.code === "asset_not_owner_verified");
    expect(issue?.severity).toBe("review");
    expect(issue?.message).toContain("asset.test.v1");
  });
  it("does not flag a plan whose assets are all owner-verified", () => {
    const plan = makePlan([makeScene(), closingScene()]);
    expect(codes(validateScenePlan(plan, makeManifest()).issues)).not.toContain("asset_not_owner_verified");
  });
});

describe("file/hash verification (checkFiles)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports a missing asset file on disk, and a hash mismatch, without checkFiles being silently skipped", () => {
    dir = mkdtempSync(join(tmpdir(), "shortform-"));
    const plan = makePlan([makeScene(), closingScene()]);
    const missing = validateScenePlan(plan, makeManifest(), { checkFiles: true, assetsDir: dir });
    expect(codes(missing.issues)).toContain("asset_file_missing");

    mkdirSync(join(dir, "ui"), { recursive: true });
    writeFileSync(join(dir, "ui", "test.jpg"), "not the real bytes");
    const wrongHash = validateScenePlan(plan, makeManifest(), { checkFiles: true, assetsDir: dir });
    expect(codes(wrongHash.issues)).toContain("asset_hash_mismatch");

    const asset = makeAsset({ sha256: sha256File(join(dir, "ui", "test.jpg")) });
    const ok = validateScenePlan(plan, makeManifest(asset), { checkFiles: true, assetsDir: dir });
    expect(codes(ok.issues)).not.toContain("asset_hash_mismatch");
    expect(codes(ok.issues)).not.toContain("asset_file_missing");
  });
});

describe("real pilot plans against the real manifest", () => {
  it("all three pilots validate structurally against their real captured screenshots (owner captured the last three 2026-09-21)", async () => {
    const { PILOTS } = await import("../../src/shortform/pilots");
    const { loadManifest } = await import("../../src/shortform/scenePlan");
    const manifest = loadManifest();
    for (const plan of PILOTS) {
      const v = validateScenePlan(plan, manifest, { checkFiles: true });
      expect(v.blockedByMissingAssets, plan.planId).toBe(false);
      expect(v.ok, `${plan.planId}: ${JSON.stringify(v.issues.filter((i) => i.severity === "error"))}`).toBe(true);
    }
  });
});
