import { describe, it, expect } from "vitest";
import { PAYOFF_PILOTS, pilot7PayoffPlan } from "../src/shortform/payoffPilots";
import { PILOTS } from "../src/shortform/pilots";
import { loadManifest, validateScenePlan, computeScenePlanHash } from "../src/shortform/scenePlan";
import { PAYOFF_MAX_HEADLINE_CHARS, PAYOFF_MAX_WORDS } from "../src/shortform/layout";
import { payoffWordCount, splitPayoffHeadline } from "../src/shortform/payoffLayout";
import { PAYOFF_FONT, buildPayoffCues, bigFontSize } from "../scripts/video-factory/payoffCues";

const manifest = loadManifest();

describe("the payoff redesign of pilot 7", () => {
  it("has three variants that differ only in frame-one treatment", () => {
    expect(PAYOFF_PILOTS.map((p) => p.planId)).toEqual(["pilot-7-payoff-a", "pilot-7-payoff-b", "pilot-7-payoff-c"]);
    const specs = PAYOFF_PILOTS.map((p) => p.scenes[0]!.payoff);
    expect(specs).toEqual([
      { theme: "bright", motion: "pop", cursor: true },
      { theme: "dark", motion: "pop", cursor: true },
      { theme: "bright", motion: "count", cursor: true },
    ]);
    const words = (i: number) => PAYOFF_PILOTS[i]!.scenes.map((s) => [s.narration, s.headline, s.captionText, s.claims.map((c) => c.text)]);
    expect(words(1)).toEqual(words(0));
    expect(words(2)).toEqual(words(0));
  });

  it("passes the full claims and evidence validation, with the asset files checked", () => {
    for (const plan of PAYOFF_PILOTS) {
      const v = validateScenePlan(plan, manifest, { checkFiles: true });
      expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it("opens on a big figure and follows the redesign brief's limits", () => {
    for (const plan of PAYOFF_PILOTS) {
      expect(splitPayoffHeadline(plan.scenes[0]!.headline)?.big).toBe("$1,725");
      expect(plan.hook).toBe("$1,725 left before your floor.");
      const total = plan.scenes.reduce((n, s) => n + s.durationSeconds, 0);
      expect(total).toBeLessThanOrEqual(20);
      for (const s of plan.scenes) {
        expect(s.layout).toBe("payoff");
        expect(payoffWordCount(s.headline)).toBeLessThanOrEqual(PAYOFF_MAX_WORDS);
        expect(s.headline.length).toBeLessThanOrEqual(PAYOFF_MAX_HEADLINE_CHARS);
      }
    }
  });

  it("shows exactly one persistent Demo data label on every scene and one closing invitation", () => {
    for (const plan of PAYOFF_PILOTS) {
      expect(plan.scenes.every((s) => (s.disclosure ?? "").toLowerCase().includes("demo data"))).toBe(true);
      expect(plan.scenes.filter((s) => s.cta).length).toBe(1);
      expect(plan.scenes[plan.scenes.length - 1]!.cta).toContain("@fillbookhq");
    }
  });

  it("zooms each evidence scene into one element of the real recording", () => {
    for (const plan of PAYOFF_PILOTS) {
      for (const s of plan.scenes.filter((x) => x.assetId)) {
        expect(s.crop!.w * s.crop!.h).toBeLessThan(1004 * 712 * 0.1);
      }
    }
  });

  it("says nothing about live or real-time tracking, guarantees, or advice", () => {
    for (const plan of PAYOFF_PILOTS) {
      const text = plan.scenes.map((s) => `${s.narration} ${s.headline} ${s.captionText} ${s.cta ?? ""}`).join(" ");
      expect(text).not.toMatch(/\blive\b|real-time|guarantee|you will (pass|profit|earn)|financial advice/i);
    }
  });

  it("ends by leading straight into the opening line", () => {
    const plan = pilot7PayoffPlan("a");
    const last = plan.scenes[plan.scenes.length - 1]!;
    expect(last.narration.startsWith("Read this before your first trade.")).toBe(true);
    expect(plan.title).toBe("Read this before your first trade.");
  });
});

describe("existing plans are untouched by the payoff layout", () => {
  it("no existing pilot uses the payoff layout, so no approved script hash moved", () => {
    for (const plan of PILOTS) {
      for (const s of plan.scenes) {
        expect(s.layout).not.toBe("payoff");
        expect(s.payoff).toBeUndefined();
      }
    }
  });

  it("only payoff scenes add layout fields to the plan hash", () => {
    const plan = pilot7PayoffPlan("a");
    const withoutSpec = { ...plan, scenes: plan.scenes.map((s) => ({ ...s, payoff: undefined })) };
    expect(computeScenePlanHash(plan)).not.toBe(computeScenePlanHash(withoutSpec));
    const old = PILOTS[0]!;
    expect(computeScenePlanHash(old)).toBe(computeScenePlanHash({ ...old, scenes: old.scenes.map((s) => ({ ...s })) }));
  });
});

describe("buildPayoffCues", () => {
  const bright = { theme: "bright", motion: "pop" } as const;

  it("draws a pop cue that shows the figure from the first frame", () => {
    const cues = buildPayoffCues({ headline: "$1,725 left before your floor", captionText: "Your buffer.", start: 0, end: 3, spec: bright, hasCard: true });
    expect(cues).toHaveLength(1);
    expect(cues[0]!.startSeconds).toBe(0);
    expect(cues[0]!.style).toBe("Pay");
    expect(cues[0]!.text).toContain("$1,725");
    expect(cues[0]!.text).toContain("\\fscx78");
    expect(cues[0]!.text).toContain("\\t(0,240,");
  });

  it("colors a negative figure red and a positive one green, by sign only", () => {
    const neg = buildPayoffCues({ headline: "-$17 last session", captionText: "x", start: 0, end: 2, spec: bright, hasCard: true })[0]!.text;
    const pos = buildPayoffCues({ headline: "$17 last session", captionText: "x", start: 0, end: 2, spec: bright, hasCard: true })[0]!.text;
    expect(neg).toContain("&H3C28D2&");
    expect(pos).toContain("&H508C0A&");
  });

  it("count motion emits a contiguous run of cues that ends on the true figure and holds to the scene end", () => {
    const cues = buildPayoffCues({ headline: "$1,725 left before your floor", captionText: "x", start: 1, end: 4, spec: { theme: "bright", motion: "count" }, hasCard: true });
    expect(cues.length).toBeGreaterThan(3);
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.startSeconds).toBeCloseTo(cues[i - 1]!.endSeconds, 6);
    expect(cues[0]!.startSeconds).toBe(1);
    expect(cues[cues.length - 1]!.endSeconds).toBe(4);
    expect(cues[cues.length - 1]!.text).toContain("$1,725");
  });

  it("puts a card scene's text high and a text-only scene's text lower, and carries the closing invitation", () => {
    const card = buildPayoffCues({ headline: "$1,725 left", captionText: "x", start: 0, end: 2, spec: bright, hasCard: true })[0]!;
    const words = buildPayoffCues({ headline: "Read this before your first trade.", captionText: "x", cta: "Try it free. @fillbookhq", start: 0, end: 2, spec: bright, hasCard: false })[0]!;
    expect(words.marginV!).toBeGreaterThan(card.marginV!);
    expect(words.text).toContain("@fillbookhq");
  });

  it("sizes the figure so a long one still fits the text width", () => {
    expect(bigFontSize("$1,725")).toBeLessThanOrEqual(PAYOFF_FONT.big);
    expect(bigFontSize("$1,504.04") * "$1,504.04".length * 0.27).toBeLessThanOrEqual(760 + 9 * 0.27);
    expect(bigFontSize("$1,504,000.00")).toBeGreaterThanOrEqual(PAYOFF_FONT.bigMin);
  });
});
