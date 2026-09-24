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
  /**
   * For a `screen_recording` asset only: the window (in the CLIP's own
   * seconds, not the scene's) during which `region` actually shows this
   * fact on screen -- e.g. a value revealed only after a scroll/expand
   * animation finishes. Omitted (or absent) means the fact holds for the
   * asset's full duration, same as every still-image fact today. Optional
   * and additive so every existing still-image fact stays valid unchanged.
   */
  timeRangeSeconds?: { start: number; end: number };
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
  kind: "phone_ui" | "desktop_ui" | "recording_frame" | "screen_recording";
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
  /**
   * `screen_recording` only: the clip's own duration/frame rate, and the
   * capture spec that produced it (route, viewport, scripted read-only
   * interactions, dataset). Optional and additive -- a `phone_ui`/
   * `desktop_ui`/legacy `recording_frame` asset never sets these, so
   * nothing about a still-image asset changes shape.
   */
  durationSeconds?: number;
  fps?: number;
  captureSpec?: MotionCaptureSpec;
}

export type CaptureActionKind =
  | "open_page"
  | "wait_for_selector"
  | "scroll_to"
  | "expand_section"
  | "switch_tab"
  | "focus_element"
  | "hover_element"
  | "navigate";

/** One scripted, read-only interaction replayed during capture. Never a write action -- see MotionCaptureSpec's own doc comment for the allowlist this is drawn from. */
export interface CaptureAction {
  kind: CaptureActionKind;
  /** CSS selector or accessible role/name the action targets, when applicable. */
  selector?: string;
  /** Free-text target description for actions that aren't selector-driven (e.g. a route for "navigate", a tab label for "switch_tab"). */
  target?: string;
  /** Seconds into the capture window this action fires. */
  atSeconds: number;
}

/**
 * The full, reviewable spec for one motion-capture scene -- everything
 * Phase 4's Playwright driver needs to replay deterministically, and
 * everything the eventual motion report needs to prove what was actually
 * recorded. One of these produces exactly one `screen_recording`
 * VerifiedAsset (via `captureSpec` above) once run.
 */
export interface MotionCaptureSpec {
  sceneId: string;
  /** Local dev-server route, e.g. "/reports". Never a hosted/production URL. */
  route: string;
  viewport: { width: number; height: number };
  /** Human-readable description of what must be on screen before capture starts (asserted, not assumed -- the driver waits for it). */
  startState: string;
  /** Read-only interactions, in order. See CaptureActionKind for the allowlist -- no create/edit/delete/submit/sync action exists in this type at all. */
  actions: CaptureAction[];
  captureDurationSeconds: number;
  /** The region the viewer's eye should land on, in the CAPTURED FRAME's pixel coordinates. */
  focalRegion: Rect | null;
  crop: Rect | null;
  /** Regions that must stay masked in every frame of the clip, not just a single still. */
  privateRegions: PrivateRegion[];
  /** On-screen disclosure text confirming this is local fixture/demo data, never a real trader's account. */
  demoDataDisclosure: string;
  /** Identifies which seeded local dataset this capture depends on (e.g. matches VerifiedAsset.dataset). A capture against the wrong/stale dataset is a validation error, not a silent mismatch. */
  datasetId: string;
  /** What the render pipeline does if this capture fails or hasn't been run yet -- never a fabricated substitute. */
  fallback: "still_image" | "skip_scene";
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
  /**
   * When `assetId` points at a `screen_recording` VerifiedAsset, the
   * portion of that clip (in the CLIP's own seconds) this scene actually
   * uses -- distinct from `durationSeconds` above, which is how long the
   * scene plays in the FINAL VIDEO (a clip range can be trimmed/retimed).
   * Omitted for a still-image `assetId` or a text-only scene.
   */
  clipTimeRangeSeconds?: { start: number; end: number };
  /** Playback rate applied to the trimmed clip range above (1 = real-time). Never used to stretch a too-short clip to fill durationSeconds -- see scenePlan.ts's validateScenePlan, which errors on insufficient footage instead of implicitly slowing it down to fit. */
  playbackSpeed?: number;
  /**
   * The capture spec that either already produced this scene's asset, or
   * still needs to be run to produce it. Present on a motion scene even
   * before capture happens -- see `motionCapture.ts`'s doc comment for how
   * a scene moves from "spec only" to "spec + real captured asset."
   */
  motionCapture?: MotionCaptureSpec;
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
