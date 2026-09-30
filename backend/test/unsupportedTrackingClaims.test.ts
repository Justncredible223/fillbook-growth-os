import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_CLAIM_RULES, BrandConstitution, extractTriggerPhrases } from "../src/knowledge/brandConstitution";
import { InMemoryBrandConstitutionRepository } from "../src/knowledge/inMemoryRepositories";
import { ContentQualityGate } from "../src/content/contentQualityGate";
import { AGENT_SYSTEM_PROMPTS } from "../src/content/reviewAgents";
import type { BrandRule } from "../src/knowledge/types";

/**
 * Regression coverage for the 2026-09-29 incident: three live @FillbookHQ posts said Fillbook tracks rules "in real
 * time" (X ids 2104066375677321307, 2103522494242001276, 2097827618292924676) and had to be deleted. Fillbook computes
 * buffers from imported or synced closed trades; it is not real time, not every rule, not any broker.
 */
const DELETED_POSTS = {
  "2104066375677321307":
    "If you're trading a prop-firm funded account, Fillbook tracks trailing drawdown in real time against your firm's rules so you know exactly where you stand before a breach, not after.",
  "2103522494242001276":
    "If you're trading prop and wondering where a breach actually came from, Fillbook tracks every rule in real time: daily loss limit, static and trailing drawdown, consistency cap.",
  "2097827618292924676":
    "Fillbook fixes that. -> Real-time drawdown & daily loss tracking -> Auto-import trades from any broker -> Alerts before you breach a rule. Built for futures. Free to start.",
} as const;

const CLEAN_POST = "You add a second prop account and now you need to know if your actual edge held up across both.";

/** The rules exactly as the live table holds them today: none of them is about tracking claims. */
const liveRulesToday: BrandRule[] = [
  { id: "live-1", version: 1, ruleType: "claim_prohibited", content: "Any trading data shown must be labeled example/demo data unless it is real, consenting-user data.", sourceDoc: null, isActive: true },
  { id: "live-2", version: 1, ruleType: "vocabulary_prohibited", content: "Corporate SaaS language, excessive em dashes, generic motivation, AI cliches, engagement bait, forced controversy.", sourceDoc: null, isActive: true },
  { id: "live-3", version: 1, ruleType: "disclosure_rule", content: 'Never assert an account is "shadowbanned" without evidence.', sourceDoc: null, isActive: true },
];

const constitution = (rules: BrandRule[] = liveRulesToday) => new BrandConstitution(new InMemoryBrandConstitutionRepository(rules));

describe("posts that must be blocked", () => {
  for (const [id, text] of Object.entries(DELETED_POSTS)) {
    it(`blocks the deleted post ${id}`, async () => {
      const violations = await constitution().checkVocabulary(text);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.every((v) => v.rule.ruleType === "claim_prohibited")).toBe(true);
    });

    it(`fails the quality gate for ${id}, with a reason`, async () => {
      const result = await new ContentQualityGate(constitution()).check(text, []);
      expect(result.passed).toBe(false);
      expect(result.blockReasons.join(" ")).toMatch(/brand vocabulary\/claim violation/);
    });
  }

  it("names the phrases it caught", async () => {
    const phrases = async (t: string) => (await constitution().checkVocabulary(t)).map((v) => v.matchedPhrase);
    expect(await phrases(DELETED_POSTS["2104066375677321307"])).toEqual(expect.arrayContaining(["real time", "before a breach"]));
    expect(await phrases(DELETED_POSTS["2103522494242001276"])).toEqual(expect.arrayContaining(["tracks every rule", "real time"]));
    expect(await phrases(DELETED_POSTS["2097827618292924676"])).toEqual(expect.arrayContaining(["real time", "any broker", "before you breach"]));
  });

  it("still blocks when the table has no tracking rules at all (the migration has not been applied)", async () => {
    expect((await constitution([]).checkVocabulary(DELETED_POSTS["2104066375677321307"])).length).toBeGreaterThan(0);
  });
});

describe("posts that must still pass", () => {
  it("passes the second-account post through the vocabulary check and the whole gate", async () => {
    expect(await constitution().checkVocabulary(CLEAN_POST)).toEqual([]);
    const result = await new ContentQualityGate(constitution()).check(CLEAN_POST, []);
    expect(result.vocabularyViolations).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("does not block a post about a firm's own real-time rules that never mentions Fillbook", async () => {
    for (const text of [
      "Topstep's trailing drawdown updates in real time, so an open trade can breach your account before a stop fills.",
      "Some prop firms watch your equity live, and some only check at the end of the day. Know which yours is.",
      "Most firms will not guarantee a payout. Read the consistency rule before you size up on any broker.",
    ]) {
      expect(await constitution().checkVocabulary(text)).toEqual([]);
    }
  });

  it("does not flag ordinary uses of the same words in context Fillbook can support", async () => {
    for (const text of [
      "Fillbook computes your drawdown buffer from the trades you import or sync.",
      "Fillbook syncs Tradovate on a schedule, or when you press Sync now.",
      "Fillbook warns you when a buffer is getting close. It does not block orders.",
      "Fillbook shows a live demo on the sample page.",
    ]) {
      expect(await constitution().checkVocabulary(text)).toEqual([]);
    }
  });
});

describe("phrase matching", () => {
  const blocked = async (text: string) => (await constitution().checkVocabulary(text)).length > 0;

  it("catches every listed phrase in any casing, hyphenation or spacing when Fillbook is mentioned", async () => {
    for (const phrase of [
      "real time", "real-time", "Real-Time", "REAL TIME", "real  time", "realtime", "real‑time",
      "live drawdown", "live tracking", "live alerts", "Live Alerts",
      "tracks every rule", "tracks  every  rule",
      "before a breach", "before you breach", "Before You Breach",
      "any broker", "never blow", "never blow an account", "guarantee", "guaranteed", "guarantees",
    ]) {
      expect(await blocked(`Fillbook: ${phrase}.`), phrase).toBe(true);
      expect(await blocked(`@FillbookHQ ${phrase}`), phrase).toBe(true);
    }
  });

  it("only applies to Fillbook, by any spelling of the name", async () => {
    expect(await blocked("Our drawdown tracker works in real time.")).toBe(false);
    expect(await blocked("fillbookhq.com tracks in real time")).toBe(true);
    expect(await blocked("#Fillbook is real-time")).toBe(true);
  });

  it("does not match inside longer words", async () => {
    expect(await blocked("Fillbook has a real timeline view.")).toBe(false);
    expect(await blocked("Fillbook shows delivered results.")).toBe(false);
  });

  it("keeps blocking what the original two rules blocked", async () => {
    const original: BrandRule[] = [
      { id: "r1", version: 1, ruleType: "claim_prohibited", content: "Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.", sourceDoc: null, isActive: true },
    ];
    expect((await constitution(original).checkVocabulary("When I traded NQ this morning I caught a great move.")).map((v) => v.rule.id)).toEqual(["r1"]);
  });
});

describe("built-in copies and table rules", () => {
  it("use the table's rule instead of the built-in copy when the same text is in the table, so a hit is reported once", async () => {
    const tableRules: BrandRule[] = BUILT_IN_CLAIM_RULES.map((r, i) => ({ ...r, id: `table-${i}` }));
    const violations = await constitution(tableRules).checkVocabulary(DELETED_POSTS["2104066375677321307"]);
    const ids = violations.map((v) => v.rule.id);
    expect(ids.every((id) => id.startsWith("table-"))).toBe(true);
    expect(new Set(violations.map((v) => `${v.rule.id}:${v.matchedPhrase}`)).size).toBe(violations.length);
  });

  it("ignores an inactive table copy of a rule but still applies the built-in one", async () => {
    const off = BUILT_IN_CLAIM_RULES.map((r, i) => ({ ...r, id: `table-${i}`, isActive: false }));
    expect((await constitution(off).checkVocabulary(DELETED_POSTS["2103522494242001276"])).length).toBeGreaterThan(0);
  });

  it("maps each rule to its phrases", () => {
    expect(BUILT_IN_CLAIM_RULES).toHaveLength(3);
    const all = BUILT_IN_CLAIM_RULES.flatMap((r) => extractTriggerPhrases(r.content));
    for (const phrase of ["real time", "realtime", "live drawdown", "live tracking", "live alerts", "tracks every rule", "before a breach", "before you breach", "any broker", "never blow", "guarantee"]) {
      expect(all).toContain(phrase);
    }
  });
});

describe("migrations and code agree", () => {
  const migrations = join(__dirname, "..", "src", "db", "migrations");
  const rulesSql = readFileSync(join(migrations, "0045_block_unsupported_tracking_claims.sql"), "utf-8");
  const knowledgeSql = readFileSync(join(migrations, "0046_refresh_product_knowledge.sql"), "utf-8");

  it("0045 inserts exactly the built-in rules, word for word, as claim_prohibited and idempotently", () => {
    for (const rule of BUILT_IN_CLAIM_RULES) expect(rulesSql).toContain(rule.content);
    expect((rulesSql.match(/'claim_prohibited'/g) ?? []).length).toBe(BUILT_IN_CLAIM_RULES.length);
    expect(rulesSql).toMatch(/where not exists/i);
    expect(rulesSql).not.toMatch(/\b(delete|update|drop|truncate)\b\s/i);
  });

  it("0046 supersedes the old pricing and scale entries instead of deleting them", () => {
    expect(knowledgeSql).not.toMatch(/\bdelete\s+from\b|\bdrop\b|\btruncate\b/i);
    expect((knowledgeSql.match(/trust_level = 'deprecated', superseded_by/g) ?? []).length).toBe(2);
    expect(knowledgeSql).toMatch(/topic = 'pricing'/);
    expect(knowledgeSql).toMatch(/topic = 'scale'/);
  });

  it("0046 states the pricing and tracking facts from PRODUCT_FACTS and nothing the owner said not to", () => {
    for (const fact of ["14-day free trial", "no card", "Core-level access plus one supported auto-sync connection", "$12.99", "$24.99", "$39.99", "no free plan", "read-only"]) {
      expect(knowledgeSql.toLowerCase()).toContain(fact.toLowerCase());
    }
    for (const fact of ["does NOT track rules in real time", "closed trades only", "Sync now", "only while NinjaTrader is running", "Interactive Brokers", "ProjectX", "PropReports", "Sierra Chart", "CSV", "do not block orders"]) {
      expect(knowledgeSql).toContain(fact);
    }
    // The scale entry quotes no counts.
    const scaleEntry = knowledgeSql.slice(knowledgeSql.indexOf("'scale', 'Fillbook scale"), knowledgeSql.indexOf("'how_rule_tracking_works'"));
    expect(scaleEntry).not.toMatch(/\d{2,}\s+(users|trades|events)/i);
    expect(knowledgeSql).not.toMatch(/\$14\.99[^.]*\b(plan|Pro)\b[^.]*\bavailable\b/i);
  });
});

describe("fact_checker prompt", () => {
  const prompt = AGENT_SYSTEM_PROMPTS.fact_checker;

  it("fails any timing or coverage claim the verified knowledge does not state verbatim", () => {
    for (const phrase of ["real time", "real-time", "live", "instant", "every rule", "any broker", "before a breach", "before you breach"]) {
      expect(prompt, phrase).toContain(phrase);
    }
    expect(prompt).toMatch(/FAIL unless the verified knowledge states that exact claim/);
    expect(prompt).toMatch(/not a claim about Fillbook/);
  });

  it("keeps its original instructions", () => {
    expect(prompt).toContain("ONLY the verified knowledge provided to you below");
    expect(prompt).toContain("no factual product claims at all");
  });
});
