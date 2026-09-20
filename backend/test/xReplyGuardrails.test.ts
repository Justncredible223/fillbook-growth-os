import { describe, it, expect } from "vitest";
import { checkReplyGuardrails, containsAiTell, containsBannedGenericPhrase, containsLink, containsUnverifiedClaim, impliesContactOrLinkRequest } from "../src/content/xReplyGuardrails";

describe("checkReplyGuardrails", () => {
  it("passes a purely helpful reply where promotion would be inappropriate -- no Fillbook mention at all", () => {
    const reply = "Trailing drawdown resets at end of day for most prop firms, but a few (like the ones running static drawdown) lock it in permanently, but worth double-checking your specific firm's rulebook before you plan around it.";
    expect(checkReplyGuardrails(reply, false)).toBeNull();
  });

  it("passes a relevant post where a subtle, earned Fillbook mention fits -- soft invitation phrasing, no link, no CTA", () => {
    const reply = "That's the classic problem with spreadsheet journaling. You catch the pattern two weeks too late. That's one of the things we're trying to make easier with Fillbook: flagging the repeat mistake while it's still happening, not after the drawdown.";
    expect(checkReplyGuardrails(reply, false)).toBeNull();
  });

  it("passes a post where a resource link is justified -- expectsLink=true because the conversation specifically asked for a tool", () => {
    const reply = "Sure, Fillbook tracks that automatically and flags it before it becomes a pattern: fillbookhq.com/go/prospecting";
    expect(checkReplyGuardrails(reply, true)).toBeNull();
  });

  it("rejects an overly promotional draft using a banned generic phrase", () => {
    const reply = "Struggling with drawdown discipline? Check out our platform, it solves exactly this!";
    const violation = checkReplyGuardrails(reply, false);
    expect(violation).not.toBeNull();
    expect(violation!.reason).toContain('banned generic phrase "check out our platform"');
  });

  it("rejects a draft with unsupported customer/performance claims", () => {
    const reply = "Our traders saved an average of 22% on drawdown violations after switching to Fillbook.";
    const violation = checkReplyGuardrails(reply, false);
    expect(violation).not.toBeNull();
  });

  it("rejects a draft where Fillbook (a product) speaks as if it personally trades", () => {
    const reply = "I've made consistent profits every month since I started using this rule -- you should too.";
    const violation = checkReplyGuardrails(reply, false);
    expect(violation).not.toBeNull();
    expect(violation!.reason).toContain("personally trading");
  });

  it("rejects a link that appears without being declared intentional (expectsLink=false)", () => {
    const reply = "Worth trying fillbookhq.com for this, honestly.";
    const violation = checkReplyGuardrails(reply, false);
    expect(violation).not.toBeNull();
    expect(violation!.reason).toContain("link that wasn't declared as intentional");
  });

  it("rejects a guarantee-style claim", () => {
    expect(checkReplyGuardrails("This is guaranteed to fix your drawdown problem.", false)).not.toBeNull();
  });

  describe("approvedLinkDomains (Inbound's stricter domain check)", () => {
    it("preserves prospecting's exact old behavior when no allowlist is given -- any link passes once expectsLink=true", () => {
      expect(checkReplyGuardrails("Reach us at some-random-domain.com/anything", true)).toBeNull();
    });

    it("passes a link on an approved domain", () => {
      const reply = "Happy to help directly: fillbookhq.com/go/contact";
      expect(checkReplyGuardrails(reply, true, { approvedLinkDomains: ["fillbookhq.com"] })).toBeNull();
    });

    it("rejects a link on an arbitrary domain even with expectsLink=true", () => {
      const reply = "Reach us at some-random-domain.com/contact";
      const violation = checkReplyGuardrails(reply, true, { approvedLinkDomains: ["fillbookhq.com"] });
      expect(violation).not.toBeNull();
      expect(violation!.reason).toContain("isn't an approved Fillbook link");
      expect(violation!.reason).toContain("some-random-domain.com");
    });

    it("a subdomain of an approved domain is still approved", () => {
      const reply = "See https://help.fillbookhq.com/contact for details.";
      expect(checkReplyGuardrails(reply, true, { approvedLinkDomains: ["fillbookhq.com"] })).toBeNull();
    });

    it("the domain check never runs when expectsLink is false -- the existing undeclared-link rejection still fires first", () => {
      const reply = "Worth trying fillbookhq.com for this, honestly.";
      const violation = checkReplyGuardrails(reply, false, { approvedLinkDomains: ["fillbookhq.com"] });
      expect(violation!.reason).toContain("wasn't declared as intentional");
    });
  });
});

describe("impliesContactOrLinkRequest", () => {
  it("recognizes a direct 'how do I contact you' question", () => {
    expect(impliesContactOrLinkRequest("Interesting how do I contact you though")).toBe(true);
  });

  it("recognizes other real phrasings of the same ask", () => {
    expect(impliesContactOrLinkRequest("what's your website?")).toBe(true);
    expect(impliesContactOrLinkRequest("where do I sign up for this")).toBe(true);
    expect(impliesContactOrLinkRequest("do you have a link for that")).toBe(true);
  });

  it("does not flag an ordinary, unrelated message", () => {
    expect(impliesContactOrLinkRequest("how does trailing drawdown work?")).toBe(false);
    expect(impliesContactOrLinkRequest("Fillbook actually tracks that automatically")).toBe(false);
  });
});

describe("containsBannedGenericPhrase", () => {
  it("catches each banned phrase, case-insensitively", () => {
    expect(containsBannedGenericPhrase("Check Out Our Platform for this.")).not.toBeNull();
    expect(containsBannedGenericPhrase("Learn more about how this works.")).not.toBeNull();
    expect(containsBannedGenericPhrase("DM me and I'll walk you through it.")).not.toBeNull();
  });

  it("does not flag ordinary text with none of the banned phrases", () => {
    expect(containsBannedGenericPhrase("Journaling every loss taught me more about my own patterns than any course did.")).toBeNull();
  });

  it("catches engagement-bait closers (owner-flagged 2026-09-10, real Inbound draft: \"Appreciate you -- let's keep the conversation going.\")", () => {
    expect(containsBannedGenericPhrase("Appreciate you -- let's keep the conversation going.")).not.toBeNull();
    expect(containsBannedGenericPhrase("Would love to hear more about your setup!")).not.toBeNull();
    expect(containsBannedGenericPhrase("What are your thoughts on that?")).not.toBeNull();
  });

  it("KNOWN LIMITATION: this is literal substring matching, not phrase-boundary-aware -- ordinary text that happens to contain an exact banned phrase as a substring is still flagged. Documented, not silently papered over: a false positive here just means a genuinely fine reply gets a rejection message and needs a light edit or a manual override, which is a far safer failure mode than a promotional phrase slipping through.", () => {
    expect(containsBannedGenericPhrase("I learn more about my own trading every time I journal a loss.")).not.toBeNull();
  });
});

describe("containsLink", () => {
  it("detects a full URL and a bare domain mention", () => {
    expect(containsLink("see fillbookhq.com/go/prospecting")).toBe(true);
    expect(containsLink("https://fillbookhq.com")).toBe(true);
  });

  it("does not flag ordinary text with no link-shaped content", () => {
    expect(containsLink("Most firms reset drawdown daily, not weekly.")).toBe(false);
  });
});

describe("containsUnverifiedClaim", () => {
  it("flags a percentage-improvement claim", () => {
    expect(containsUnverifiedClaim("Traders see 30% better consistency with this.")).not.toBeNull();
  });

  it("does not flag a real, hedged, non-quantified observation", () => {
    expect(containsUnverifiedClaim("Journaling tends to help traders notice their own patterns sooner.")).toBeNull();
  });
});


describe("containsAiTell -- replies that read as bot-written", () => {
  const flagged: Array<[string, string]> = [
    ["em dash", "Static drawdown never moves — check your rulebook."],
    ["en dash", "Funded accounts – especially trailing ones bite."],
    ["double-hyphen dash stand-in", "Most firms reset daily -- a few don't."],
    ["praise opener", "Great point. Trailing drawdown catches people out."],
    ["love this opener", "Love this take on consistency rules."],
    ["it's not X, it's Y", "It's not about the strategy, it's about the rules you break."],
    ["not just X, but Y", "It's not just a journal, but a mirror."],
    ["less about X more about Y", "Trading is less about entries, more about exits."],
    ["stock AI vocabulary", "Let's delve into how the consistency rule works."],
    ["solicitation closer", "Trailing drawdown resets daily. Thoughts?"],
    ["emoji", "Log it before the next trade \u{1F525}"],
    ["hashtag", "Log every loss #futures"],
    ["multiple exclamation marks", "Log it! Every single one!"],
  ];
  for (const [label, text] of flagged) {
    it(`flags: ${label}`, () => {
      expect(containsAiTell(text)).not.toBeNull();
      expect(checkReplyGuardrails(text, false)).not.toBeNull();
    });
  }

  const clean = [
    "Topstep's trailing drawdown locks at the starting balance once you're up 2k. Check yours.",
    "logging the loser before you take the next trade is the whole trick",
    "Which firm? the consistency rule differs a lot between them.",
    "That's a 3 contract stop on NQ, so about $180 a pop.",
    "Not sure that's right. Apex resets the threshold at the end of day.",
  ];
  for (const text of clean) {
    it(`passes a natural reply: "${text.slice(0, 40)}"`, () => {
      expect(containsAiTell(text)).toBeNull();
    });
  }
});

describe("pushy-sales phrasing is rejected", () => {
  for (const phrase of ["check it out", "give it a try", "free trial", "use code"]) {
    it(`rejects "${phrase}"`, () => {
      const violation = checkReplyGuardrails(`Logging every loss helps, so ${phrase} sometime.`, false);
      expect(violation?.reason).toContain(phrase);
    });
  }

  it("still allows a plain, single Fillbook mention with no pitch", () => {
    expect(checkReplyGuardrails("Trailing drawdown locks at the starting balance once you're up 2k. We track that automatically in Fillbook.", false)).toBeNull();
  });
});

describe("profit-promise language is rejected", () => {
  for (const text of [
    "Fillbook makes you profitable by showing your patterns.",
    "Log everything and you will become profitable.",
    "This will turn you funded in a month.",
  ]) {
    it(`rejects: ${text}`, () => {
      expect(checkReplyGuardrails(text, false)?.reason).toContain("profitable");
    });
  }
  it("still allows the honest behavior frame", () => {
    expect(checkReplyGuardrails("We track that in Fillbook so you can see what you're actually doing before deciding what to change.", false)).toBeNull();
  });
});
