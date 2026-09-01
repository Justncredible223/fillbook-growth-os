import { describe, it, expect } from "vitest";
import { BrandConstitution } from "../src/knowledge/brandConstitution";
import { InMemoryBrandConstitutionRepository } from "../src/knowledge/inMemoryRepositories";
import type { BrandRule } from "../src/knowledge/types";

const rules: BrandRule[] = [
  {
    id: "r1",
    version: 1,
    ruleType: "claim_prohibited",
    content:
      "Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.",
    sourceDoc: "fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md",
    isActive: true,
  },
  {
    id: "r2",
    version: 1,
    ruleType: "disclosure_rule",
    content: 'Never assert an account is "shadowbanned" without evidence.',
    sourceDoc: "fillbookhq:docs/social/MASTER_SOCIAL_STRATEGY.md",
    isActive: true,
  },
  {
    id: "r3",
    version: 1,
    ruleType: "positioning",
    content: "Retired rule, should not be applied.",
    sourceDoc: null,
    isActive: false,
  },
];

describe("BrandConstitution", () => {
  it("only returns active rules", async () => {
    const bc = new BrandConstitution(new InMemoryBrandConstitutionRepository(rules));
    const active = await bc.getActiveRules();
    expect(active).toHaveLength(2);
    expect(active.every((r) => r.isActive)).toBe(true);
  });

  it("flags content that fabricates a personal trading story", async () => {
    const bc = new BrandConstitution(new InMemoryBrandConstitutionRepository(rules));
    const violations = await bc.checkVocabulary(
      "When I traded NQ this morning I caught a great move.",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule.id).toBe("r1");
  });

  it("flags an unsupported shadowban claim", async () => {
    const bc = new BrandConstitution(new InMemoryBrandConstitutionRepository(rules));
    const violations = await bc.checkVocabulary("Our TikTok account is definitely shadowbanned.");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule.id).toBe("r2");
  });

  it("passes clean content with no violations", async () => {
    const bc = new BrandConstitution(new InMemoryBrandConstitutionRepository(rules));
    const violations = await bc.checkVocabulary(
      "Most traders don't realize how much a single rule violation costs over a month.",
    );
    expect(violations).toHaveLength(0);
  });
});
