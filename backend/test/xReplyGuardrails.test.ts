import { describe, it, expect } from "vitest";
import { checkReplyGuardrails, containsBannedGenericPhrase, containsLink, containsUnverifiedClaim, impliesContactOrLinkRequest } from "../src/content/xReplyGuardrails";

describe("checkReplyGuardrails", () => {
  it("passes a purely helpful reply where promotion would be inappropriate -- no Fillbook mention at all", () => {
    const reply = "Trailing drawdown resets at end of day for most prop firms, but a few (like the ones running static drawdown) lock it in permanently -- worth double-checking your specific firm's rulebook before you plan around it.";
    expect(checkReplyGuardrails(reply, false)).toBeNull();
  });

  it("passes a relevant post where a subtle, earned Fillbook mention fits -- soft invitation phrasing, no link, no CTA", () => {
    const reply = "That's the classic problem with spreadsheet journaling -- you catch the pattern two weeks too late. That's one of the things we're trying to make easier with Fillbook: flagging the repeat mistake while it's still happening, not after the drawdown.";
    expect(checkReplyGuardrails(reply, false)).toBeNull();
  });

  it("passes a post where a resource link is justified -- expectsLink=true because the conversation specifically asked for a tool", () => {
    const reply = "Sure -- Fillbook tracks that automatically and flags it before it becomes a pattern: fillbookhq.com/go/prospecting";
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
      const reply = "Happy to help directly -- fillbookhq.com/go/contact";
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
