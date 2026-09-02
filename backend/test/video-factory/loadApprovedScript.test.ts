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
  caption: "Trailing drawdown explained.",
  hashtags: ["futurestrading", "propfirm"],
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
      expect((err as Error).message).toContain("caption");
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
