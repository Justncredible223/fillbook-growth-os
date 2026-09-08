import { describe, it, expect } from "vitest";
import { isAllowedAssetTypeOverride, ALLOWED_ASSET_TYPE_OVERRIDES } from "../api/run-campaign";

/**
 * Regression coverage for the owner-requested video-script feature
 * (2026-09-08): api/run-campaign.ts now accepts an optional `assetType`
 * field so the owner can explicitly request a video_script for any open
 * opportunity -- the TikTok/YouTube signal adapters that used to produce
 * video-first opportunities were intentionally removed (see
 * api/ingest.ts's own doc comment), leaving the fully-implemented
 * video-script pipeline otherwise permanently unreachable.
 *
 * `isAllowedAssetTypeOverride` is the exact-match allowlist gate that
 * runs BEFORE this value is ever trusted downstream -- same pattern as
 * ingest.ts's own isManualIngestSource. No arbitrary caller-supplied
 * string is ever passed through: this test exists specifically so a
 * malicious or buggy caller can never force an unrelated asset type
 * (e.g. "partnership_pitch", "already_handled", or an empty/whitespace
 * string) past the HTTP layer.
 *
 * Authorization for the request as a whole is unchanged and already
 * covered by requireAppAuth.test.ts -- this endpoint gates every field,
 * including the new one, behind the exact same requireAppAuth() call
 * used by every other authenticated endpoint; there is no separate,
 * less-trusted path for assetType specifically.
 *
 * Duplicate prevention and budget enforcement for THIS feature are
 * deliberately provided by mechanisms that already existed and are
 * already covered elsewhere, unmodified, not reimplemented here:
 * - Duplicate prevention: once a request (video or text) reaches
 *   ready_for_owner, runCampaignForOpportunity.test.ts's own
 *   "calls markOpportunityActioned... ONLY when the pipeline reaches
 *   ready_for_owner" test already proves the opportunity's status moves
 *   to 'actioned'; supabaseOpportunityRepository.listOpen() only ever
 *   returns status='open' rows, so a second request (video or text) for
 *   the same opportunity id 404s here with "No open opportunity with id
 *   ...", exactly like a duplicate text-campaign request already does.
 *   No new code path was added for this -- the video-script request
 *   flows through the identical opportunityId lookup as every other
 *   run-campaign call.
 * - Budget enforcement: this endpoint's only spend gate, the
 *   system_settings.paused check, runs before the assetType is even
 *   parsed (see the handler above) and applies identically regardless of
 *   assetType -- a video-script request while paused is rejected with
 *   the same 409 a normal campaign request already gets.
 */
describe("isAllowedAssetTypeOverride", () => {
  it("accepts exactly 'video_script'", () => {
    expect(isAllowedAssetTypeOverride("video_script")).toBe(true);
  });

  it("rejects an unrelated asset type", () => {
    expect(isAllowedAssetTypeOverride("post")).toBe(false);
    expect(isAllowedAssetTypeOverride("partnership_pitch")).toBe(false);
    expect(isAllowedAssetTypeOverride("already_handled")).toBe(false);
  });

  it("rejects a similar-looking but wrong string -- no fuzzy/case-insensitive matching", () => {
    expect(isAllowedAssetTypeOverride("Video_Script")).toBe(false);
    expect(isAllowedAssetTypeOverride("video-script")).toBe(false);
    expect(isAllowedAssetTypeOverride("video_script ")).toBe(false);
  });

  it("rejects non-string values, including ones that could indicate an injection attempt", () => {
    expect(isAllowedAssetTypeOverride(null)).toBe(false);
    expect(isAllowedAssetTypeOverride(undefined)).toBe(false);
    expect(isAllowedAssetTypeOverride(123)).toBe(false);
    expect(isAllowedAssetTypeOverride(["video_script"])).toBe(false);
    expect(isAllowedAssetTypeOverride({ toString: () => "video_script" })).toBe(false);
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(isAllowedAssetTypeOverride("")).toBe(false);
    expect(isAllowedAssetTypeOverride("   ")).toBe(false);
  });

  it("the allowlist contains exactly video_script and research, nothing else", () => {
    expect(ALLOWED_ASSET_TYPE_OVERRIDES).toEqual(["video_script", "research"]);
  });

  it("accepts 'research' (added 2026-09-07 for the Research Lab feature)", () => {
    expect(isAllowedAssetTypeOverride("research")).toBe(true);
  });
});
