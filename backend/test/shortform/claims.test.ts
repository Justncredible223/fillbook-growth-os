import { describe, expect, it } from "vitest";
import { extractNumbers, numberIsSupported, scanText, validateSceneClaims } from "../../src/shortform/claims";
import { makeAsset, makeScene } from "./helpers";

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("scanText: banned claims", () => {
  const cases: Array<[string, string]> = [
    ["guarantee_language", "This guarantees you pass."],
    ["profit_promise", "It helps you get funded fast."],
    ["profit_promise", "You will become profitable."],
    ["payout_promise", "Fillbook gets you paid on time."],
    ["breach_prevention", "It prevents account breaches."],
    ["breach_prevention", "This stops you from blowing up an account."],
    ["replaces_risk_system", "This replaces your broker's risk system."],
    ["replaces_risk_system", "Real-time risk monitoring for your account."],
    ["timely_warning_promise", "Fillbook will warn you before it happens."],
    ["fabricated_customer_outcome", "Our traders saved thousands using this."],
    ["fabricated_customer_outcome", "Read our success stories."],
    ["unsupported_statistic", "90% of traders never journal."],
    ["unsupported_statistic", "Most traders quit within a year."],
    ["invented_personal_story", "I blew my funded account last year."],
    ["invented_personal_story", "My trading journey started here."],
    ["flag_proves_intent", "This proves that you were revenge trading."],
    ["flag_as_diagnosis", "This diagnoses your trading psychology."],
  ];
  for (const [code, text] of cases) {
    it(`flags ${code}: "${text}"`, () => {
      expect(codes(scanText(text, "field"))).toContain(code);
    });
  }

  it("does not flag a plain, honest sentence", () => {
    expect(scanText("The buffer reads $690.50 for this example account.", "field")).toEqual([]);
  });

  it("flag_as_diagnosis is not triggered by denying a diagnosis", () => {
    expect(codes(scanText("This is not a diagnosis of your trading.", "field"))).not.toContain("flag_as_diagnosis");
  });
});

describe("scanText: behavior-flag framing", () => {
  it("requires flag/review framing whenever a behavior term is used", () => {
    expect(codes(scanText("This trade was revenge trading.", "field"))).toContain("behavior_flag_not_framed_as_prompt");
    expect(scanText("The trade log flagged this as a possible revenge trade to review.", "field")).toEqual([]);
  });
  it("oversized and tilt need the same framing", () => {
    expect(codes(scanText("You were oversized on that one.", "f"))).toContain("behavior_flag_not_framed_as_prompt");
    expect(scanText("Tagged Oversized, worth a review.", "f")).toEqual([]);
  });
});

describe("number extraction and support", () => {
  it("extracts dollar amounts, percentages and R-multiples", () => {
    expect(extractNumbers("Buffer $690.50, up 432%, best trade 5.9R")).toEqual(["$690.50", "432%", "5.9R"]);
  });
  it("a number is supported when it matches, or is a lower-precision rounding of, a displayed number", () => {
    expect(numberIsSupported("$690.50", ["$690.50"])).toBe(true);
    expect(numberIsSupported("$700", ["$690.50"])).toBe(false);
    expect(numberIsSupported("690", ["$690.50"])).toBe(true);
    expect(numberIsSupported("691", ["$690.50"])).toBe(true);
    expect(numberIsSupported("689", ["$690.50"])).toBe(false);
  });
  it("a number with no displayed match at all is unsupported", () => {
    expect(numberIsSupported("$500.00", ["$690.50", "$1,200.00"])).toBe(false);
  });
});

describe("validateSceneClaims: cited fact must actually be on screen during the scene's clip window", () => {
  // Regression coverage for the confirmed-then-fixed defect class: a caption/narration
  // states a value (e.g. "5 contracts") while the recording still shows an earlier or later
  // value during part or all of the scene's own window.
  const timedAsset = makeAsset({
    kind: "screen_recording",
    facts: [{ key: "qty", text: "5 x 20000.00", values: ["5"], topics: ["buffer"], region: { x: 100, y: 400, w: 800, h: 200 }, timeRangeSeconds: { start: 1.8, end: 10.3 } }],
  });
  const timedScene = (over: Partial<Parameters<typeof makeScene>[0]> = {}) =>
    makeScene({ narration: "5 x 20000.00", claims: [{ id: "c1", type: "data_point", text: "5 x", evidence: [{ assetId: "asset.test.v1", factKey: "qty" }] }], ...over });

  it("passes when the scene's clip window sits fully inside the fact's visible window", () => {
    const scene = timedScene({ clipTimeRangeSeconds: { start: 1.8, end: 10.2 } });
    expect(codes(validateSceneClaims(scene, timedAsset))).not.toContain("evidence_not_visible_during_clip_window");
    expect(codes(validateSceneClaims(scene, timedAsset))).not.toContain("evidence_visible_late_in_clip_window");
  });

  it("errors when the scene's clip window never overlaps the fact's visible window at all", () => {
    // e.g. the scene plays 0-1.5s of the clip, but this fact only ever appears from 1.8s on --
    // exactly the shape of captioning "5 contracts" over a frame that still shows "1 x".
    const scene = timedScene({ clipTimeRangeSeconds: { start: 0, end: 1.5 } });
    expect(codes(validateSceneClaims(scene, timedAsset))).toContain("evidence_not_visible_during_clip_window");
  });

  it("errors the same way when the scene starts after the fact has already gone off screen", () => {
    const scene = timedScene({ clipTimeRangeSeconds: { start: 11, end: 15 } });
    expect(codes(validateSceneClaims(scene, timedAsset))).toContain("evidence_not_visible_during_clip_window");
  });

  it("flags (as a review item, not a hard error) when the scene starts noticeably before the fact settles", () => {
    // Partial overlap: the opening of the scene may show a mid-swipe/stale frame while the
    // claim is already being spoken -- worth a human frame-check, not an automatic block,
    // since a static field can sometimes already be legible before the manifest's
    // conservative "fully settled" timestamp.
    const scene = timedScene({ clipTimeRangeSeconds: { start: 1.0, end: 10.2 } });
    const issues = validateSceneClaims(scene, timedAsset);
    expect(codes(issues)).toContain("evidence_visible_late_in_clip_window");
    expect(codes(issues)).not.toContain("evidence_not_visible_during_clip_window");
  });

  it("is a no-op for still-image facts with no timeRangeSeconds, and for scenes with no clipTimeRangeSeconds", () => {
    expect(codes(validateSceneClaims(makeScene(), makeAsset()))).not.toContain("evidence_not_visible_during_clip_window");
    const scene = makeScene({ clipTimeRangeSeconds: undefined });
    expect(codes(validateSceneClaims(scene, timedAsset))).not.toContain("evidence_not_visible_during_clip_window");
  });
});

describe("validateSceneClaims: claim-to-visual linkage", () => {
  const asset = makeAsset();

  it("passes a scene whose claim cites a real, visible, on-topic fact", () => {
    expect(validateSceneClaims(makeScene(), asset)).toEqual([]);
  });

  it("rejects a claim with no evidence at all", () => {
    const scene = makeScene({ claims: [{ id: "c", type: "data_point", text: "x", evidence: [] }] });
    expect(codes(validateSceneClaims(scene, asset))).toContain("claim_without_visual_source");
  });

  it("rejects a claim citing a fact key that does not exist on the asset", () => {
    const scene = makeScene({ claims: [{ id: "c", type: "data_point", text: "x", evidence: [{ assetId: "asset.test.v1", factKey: "nope" }] }] });
    expect(codes(validateSceneClaims(scene, asset))).toContain("evidence_fact_unknown");
  });

  it("rejects a claim citing a different asset than the one on screen", () => {
    const scene = makeScene({ claims: [{ id: "c", type: "data_point", text: "x", evidence: [{ assetId: "other.asset", factKey: "buffer" }] }] });
    expect(codes(validateSceneClaims(scene, asset))).toContain("evidence_wrong_asset");
  });

  it("rejects a claim whose evidence region is cropped out of the scene", () => {
    const scene = makeScene({ crop: { x: 50, y: 300, w: 900, h: 150 }, focalRegion: { x: 60, y: 310, w: 100, h: 100 } });
    expect(codes(validateSceneClaims(scene, asset))).toContain("evidence_not_visible");
  });

  it("rejects narration whose topic does not match the screenshot's topics", () => {
    const scene = makeScene({ expectedTopics: ["month_total"], claims: [] });
    expect(codes(validateSceneClaims(scene, asset))).toContain("narration_asset_topic_mismatch");
  });

  it("rejects a claim pointing at a fact whose own topics do not match the scene's topics", () => {
    const off = makeAsset({ facts: [{ key: "buffer", text: "Buffer $690.50", values: ["$690.50"], topics: ["month_total"], region: { x: 100, y: 400, w: 800, h: 200 } }] });
    expect(codes(validateSceneClaims(makeScene(), off))).toContain("narration_fact_topic_mismatch");
  });

  it("rejects a scene with a screenshot but no evidence claim at all", () => {
    const scene = makeScene({ claims: [] });
    expect(codes(validateSceneClaims(scene, asset))).toContain("scene_without_evidence_claim");
  });

  it("requires a visual source for a product claim made with no screenshot", () => {
    const scene = makeScene({ assetId: null, crop: null, focalRegion: null, narration: "Fillbook flagged the trade." });
    expect(codes(validateSceneClaims(scene, undefined))).toContain("product_claim_without_visual");
  });

  it("allows a text-only scene with no product claim (a concept or invitation card)", () => {
    const scene = makeScene({ assetId: null, crop: null, focalRegion: null, narration: "A flag is a prompt to review.", claims: [{ id: "c", type: "concept", text: "x", evidence: [] }] });
    expect(validateSceneClaims(scene, undefined)).toEqual([]);
  });

  it("rejects a spoken number that is not displayed anywhere the scene cites", () => {
    const scene = makeScene({ narration: "The buffer reads $999.99." });
    expect(codes(validateSceneClaims(scene, asset))).toContain("unsupported_statistic");
  });

  it("accepts a spoken number that matches a displayed fact, and one written in fewer decimals", () => {
    expect(validateSceneClaims(makeScene({ narration: "Buffer $690.50." }), asset)).toEqual([]);
    expect(codes(validateSceneClaims(makeScene({ narration: "About $690 today." }), asset))).not.toContain("unsupported_statistic");
  });

  it("flags a spelled-out number for review", () => {
    const scene = makeScene({ narration: "Buffer $690.50, up ninety percent." });
    const issues = validateSceneClaims(scene, asset);
    expect(issues.find((i) => i.code === "spelled_number_unchecked")?.severity).toBe("review");
  });
});
