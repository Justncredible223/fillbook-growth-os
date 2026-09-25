import { describe, it, expect } from "vitest";
import { ContentQualityGate, spokenScriptOf } from "../../src/content/contentQualityGate.js";
import { BrandConstitution } from "../../src/knowledge/brandConstitution.js";
import { InMemoryBrandConstitutionRepository } from "../../src/knowledge/inMemoryRepositories.js";
import { buildVideoScriptFromScenePlan, formatVideoScriptAsText } from "../../src/content/videoScriptWriter.js";
import { PILOT_1, PILOT_2, PILOT_3 } from "../../src/shortform/pilots.js";

const gate = new ContentQualityGate(new BrandConstitution(new InMemoryBrandConstitutionRepository([])));
const body = (plan: typeof PILOT_1) => formatVideoScriptAsText(buildVideoScriptFromScenePlan(plan));

describe("video-script originality is judged on the spoken narration", () => {
  it("extracts exactly the SCRIPT section", () => {
    expect(spokenScriptOf(body(PILOT_3))).toBe(buildVideoScriptFromScenePlan(PILOT_3).script);
    expect(spokenScriptOf("A plain post with no sections.")).toBe("A plain post with no sections.");
  });

  it("does not block a different motion concept just because the template copy is shared", async () => {
    for (const [candidate, recent] of [[PILOT_1, PILOT_3], [PILOT_2, PILOT_3], [PILOT_1, PILOT_2]] as const) {
      const result = await gate.check(body(candidate), [body(recent)], { isVideo: true });
      expect(result.blockReasons.join(" ")).not.toMatch(/too similar/);
    }
  });

  it("still blocks the same concept's script as a duplicate", async () => {
    const result = await gate.check(body(PILOT_3), [body(PILOT_3)], { isVideo: true });
    expect(result.blockReasons.join(" ")).toMatch(/too similar to recent content \(100% overlap\)/);
  });
});
