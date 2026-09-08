import { describe, it, expect } from "vitest";
import {
  validateVideoScript,
  validateVideoScriptPackage,
  assertApproved,
} from "../../scripts/video-factory/loadApprovedScript";
import { VideoFactoryError, type VideoScriptPackage } from "../../scripts/video-factory/types";

const validScript = {
  hook: "Your funded account can get pulled even on a winning trade.",
  script: "Full spoken script here.",
  shotList: ["Text card: the hook", "Fillbook UI: example drawdown chart"],
  youtubeTitle: "Why Funded Accounts Get Pulled Even When Winning",
  youtubeDescription: "Trailing drawdown explained.",
  tiktokCaption: "Trailing drawdown explained.",
  hashtags: ["futurestrading", "propfirm"],
  disclosureCta: null,
};

const validPackage: VideoScriptPackage = {
  draftId: "asset-1",
  campaignTitle: "Trailing drawdown confusion",
  platform: "tiktok",
  assetType: "video_script",
  videoScript: validScript,
  approvedBy: "Justin",
  approvedAt: "2026-09-01T12:00:00Z",
};

describe("validateVideoScript", () => {
  it("accepts a well-formed script", () => {
    expect(validateVideoScript(validScript)).toEqual(validScript);
  });

  it("throws VideoFactoryError listing every missing field", () => {
    expect(() => validateVideoScript({ hook: "only a hook" })).toThrow(VideoFactoryError);
    try {
      validateVideoScript({ hook: "only a hook" });
    } catch (err) {
      expect((err as Error).message).toContain("script");
      expect((err as Error).message).toContain("shotList");
      expect((err as Error).message).toContain("youtubeTitle");
      expect((err as Error).message).toContain("youtubeDescription");
      expect((err as Error).message).toContain("tiktokCaption");
      expect((err as Error).message).toContain("hashtags");
    }
  });

  it("rejects an empty shot list", () => {
    expect(() => validateVideoScript({ ...validScript, shotList: [] })).toThrow(/shotList/);
  });

  it("rejects a non-object", () => {
    expect(() => validateVideoScript(null)).toThrow(VideoFactoryError);
    expect(() => validateVideoScript("a string")).toThrow(VideoFactoryError);
  });

  it("accepts disclosureCta as null -- never required, never fabricated", () => {
    expect(validateVideoScript({ ...validScript, disclosureCta: null })).toEqual({ ...validScript, disclosureCta: null });
  });

  it("accepts a real disclosureCta string when present", () => {
    const withCta = { ...validScript, disclosureCta: "Example data shown for illustration only." };
    expect(validateVideoScript(withCta)).toEqual(withCta);
  });

  it("rejects a disclosureCta that is neither a non-empty string nor null", () => {
    expect(() => validateVideoScript({ ...validScript, disclosureCta: "" })).toThrow(/disclosureCta/);
  });
});

describe("validateVideoScriptPackage", () => {
  it("accepts a well-formed package", () => {
    expect(validateVideoScriptPackage(validPackage)).toEqual(validPackage);
  });

  it("defaults approvedBy to null and approvedAt to empty string when absent", () => {
    const { approvedBy, approvedAt, ...rest } = validPackage;
    void approvedBy;
    void approvedAt;
    const result = validateVideoScriptPackage(rest);
    expect(result.approvedBy).toBeNull();
    expect(result.approvedAt).toBe("");
  });

  it("rejects an asset type other than video_script", () => {
    expect(() => validateVideoScriptPackage({ ...validPackage, assetType: "post" })).toThrow(/video_script/);
  });

  it("rejects missing top-level fields", () => {
    const { campaignTitle, ...rest } = validPackage;
    void campaignTitle;
    expect(() => validateVideoScriptPackage(rest)).toThrow(/campaignTitle/);
  });
});

describe("assertApproved", () => {
  it("passes silently when approvedAt is set", () => {
    expect(() => assertApproved(validPackage)).not.toThrow();
  });

  it("throws VideoFactoryError when approvedAt is empty -- the human-approval gate", () => {
    expect(() => assertApproved({ ...validPackage, approvedAt: "" })).toThrow(VideoFactoryError);
    expect(() => assertApproved({ ...validPackage, approvedAt: "" })).toThrow(/has not been approved/);
  });
});
