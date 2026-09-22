/**
 * Short-form (TikTok / YouTube Shorts) production model. Pure data types; no I/O.
 *
 * The rule the whole model enforces: a scene's narration can only make a product
 * claim if that claim points at a fact in the verified-asset manifest, and the
 * fact's region is actually inside the crop the viewer sees. That is what makes it
 * impossible to silently pair a spoken line with an unrelated screenshot.
 */

export const OFFICIAL_HANDLE = "@fillbookhq";

export type Platform = "tiktok" | "youtube_shorts";
export type ScenePlatform = Platform | "both";

/** A rectangle in the SOURCE image's pixel coordinates (origin top-left). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AssetFact {
  key: string;
  /** What is literally visible in the region, in words. */
  text: string;
  /** Numbers/values visible in the region exactly as displayed. Any number a scene speaks or shows must appear here. */
  values: string[];
  topics: string[];
  region: Rect;
}

export interface PrivateRegion {
  region: Rect;
  kind: "email" | "name" | "account_id" | "other";
}

export interface VerifiedAsset {
  id: string;
  /** Path relative to scripts/video-factory/assets. */
  file: string;
  sha256: string;
  width: number;
  height: number;
  kind: "phone_ui" | "desktop_ui" | "recording_frame";
  /** Screens from different datasets must not appear in one video: their numbers can contradict each other. */
  dataset: string;
  source: string;
  capturedAt: string;
  /** Non-null means the data is demo/example data and the scene must show this exact label on screen. */
  dataLabel: string | null;
  /** False until the owner confirms the facts and regions in the contact sheet. Reported, never silently assumed. */
  verifiedByOwner: boolean;
  topics: string[];
  /** App bars/nav that must not appear in a crop unless the scene opts in. */
  chromeRegions: Rect[];
  /** Desktop only: the sidebar to remove. */
  sidebarRegion?: Rect;
  privateRegions: PrivateRegion[];
  facts: AssetFact[];
}

export interface VerifiedManifest {
  version: number;
  note: string;
  assets: VerifiedAsset[];
}

/** An asset a plan needs that does not exist yet. The plan reports it instead of inventing a stand-in. */
export interface RequiredAsset {
  id: string;
  description: string;
  /** Fact keys the capture must contain for the plan's claims to be true. */
  mustShow: string[];
  dataset?: string;
}

export type ClaimType = "product_capability" | "data_point" | "behavior_flag" | "concept" | "invitation";

export interface ClaimEvidence {
  assetId: string;
  factKey: string;
}

export interface Claim {
  id: string;
  text: string;
  type: ClaimType;
  evidence: ClaimEvidence[];
}

export interface Mask {
  /** In source pixel coordinates, same space as crop. */
  region: Rect;
  label?: string;
}

export type SceneLayout = "full_card" | "fill";
export type AspectRatio = "9:16" | "4:5" | "1:1" | "source";
export type TransitionType = "cut" | "fade";

export interface SceneSpec {
  sceneId: string;
  narration: string;
  /** The one thing a viewer should take from this scene. */
  takeaway: string;
  /** Null only for a text-only card (a closing card, for example). */
  assetId: string | null;
  /** The region the viewer's eye should land on. Must sit inside the crop. */
  focalRegion: Rect | null;
  crop: Rect | null;
  aspectRatio: AspectRatio;
  layout: SceneLayout;
  headline: string;
  captionText: string;
  durationSeconds: number;
  transition: { type: TransitionType; durationSeconds: number };
  /** Visible text such as EXAMPLE DATA or the "based on recorded trades" qualification. */
  disclosure: string | null;
  cta: string | null;
  platform: ScenePlatform;
  experimentId: string;
  variationId: string;
  /** What this scene is about. Must overlap the asset's and the evidence facts' topics. */
  expectedTopics: string[];
  claims: Claim[];
  masks: Mask[];
  fontSizes?: { headline: number; caption: number };
  /** Opt-ins for the rare deliberate exceptions. */
  allowChrome?: boolean;
  keepSidebar?: boolean;
  intentionalFullPage?: boolean;
}

export interface ScenePlan {
  planId: string;
  title: string;
  series: string;
  topic: string;
  hook: string;
  experimentId: string;
  variationId: string;
  platforms: Platform[];
  voice: string;
  visualStyle: string;
  scenes: SceneSpec[];
  requiredAssets: RequiredAsset[];
}

export type IssueSeverity = "error" | "review";

export interface PlanIssue {
  severity: IssueSeverity;
  code: string;
  sceneId?: string;
  message: string;
}

export interface PlanValidation {
  /** No error-severity issues. A plan with a missing asset is never ok. */
  ok: boolean;
  /** True when at least one required source asset does not exist yet. */
  blockedByMissingAssets: boolean;
  missingAssets: RequiredAsset[];
  issues: PlanIssue[];
}
