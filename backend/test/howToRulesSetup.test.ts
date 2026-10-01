import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEED_POST_TOPICS } from "../src/content/dailyXFeedPost.js";

// 2026-09-30: the "how to set up drawdown tracking" post type had no verified knowledge to draw on, so the writer
// invented a setup path ("Accounts page, click your account, scroll to Rules, toggle on Trailing Drawdown") and a
// post went out with it. These tests pin the real path: the Prop firm rules page, "Add account".

const WRONG_PATH_PHRASES = ["scroll to rules", "click your account", "toggle on trailing drawdown", "toggle on daily loss limit"];

describe("how-to post type", () => {
  const topic = FEED_POST_TOPICS.find((t) => t.key === "how_to_set_up_drawdown_tracking");

  it("exists", () => {
    expect(topic).toBeDefined();
  });

  it("tells the writer the only real setup steps and forbids any other page, button or toggle", () => {
    const r = topic!.rationale;
    expect(r).toContain('"Prop firm rules" page');
    expect(r).toContain('"Add account"');
    expect(r).toContain('"Custom"');
    expect(r).toMatch(/trailing or static drawdown/);
    expect(r).toMatch(/Never name any other page, button, toggle or step/);
  });
});

describe("0047 how_to_set_up_rules knowledge", () => {
  const sql = readFileSync(join(__dirname, "..", "src", "db", "migrations", "0047_add_rules_setup_steps_knowledge.sql"), "utf-8");

  it("is additive and idempotent", () => {
    expect(sql).not.toMatch(/\bdelete\s+from\b|\bdrop\b|\btruncate\b|\bupdate\s+knowledge_documents\b/i);
    expect(sql).toMatch(/where not exists \(select 1 from knowledge_documents where topic = 'how_to_set_up_rules' and trust_level = 'verified'\)/i);
    expect((sql.match(/insert into knowledge_documents/gi) ?? []).length).toBe(1);
    expect(sql).toMatch(/'verified'/);
  });

  it("states the real steps from the product", () => {
    for (const fact of ['"Prop firm rules" page', '"Add account"', '"Custom"', "25K, 50K, 100K or 150K", "daily loss limit", "trailing or static", "end of day or intraday", "Core and Elite", "14-day free trial"]) {
      expect(sql).toContain(fact);
    }
  });

  it("only mentions the invented path to say it does not exist, never as a step", () => {
    const body = sql.slice(sql.indexOf("$$") + 2, sql.lastIndexOf("$$"));
    const negation = body.indexOf("there is no step where you click an account");
    expect(negation).toBeGreaterThan(-1);
    const beforeNegation = body.slice(0, negation).toLowerCase();
    for (const phrase of WRONG_PATH_PHRASES) expect(beforeNegation).not.toContain(phrase);
  });

  it("does not describe the tracking as real time or live", () => {
    const body = sql.slice(sql.indexOf("$$") + 2, sql.lastIndexOf("$$")).toLowerCase();
    expect(body).toContain("never describe the tracking as real time");
    expect(body.replace("never describe the tracking as real time", "")).not.toMatch(/real[- ]?time|\blive\b/);
  });
});
