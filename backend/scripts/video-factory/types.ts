/**
 * Shared types for the local Video Factory CLI. This tool is intentionally
 * NOT part of the backend/ Vercel deployment -- it never runs in a
 * serverless function, only on the operator's own machine, invoked by
 * hand. See docs/VIDEO_FACTORY.md for the full flow.
 */

export class VideoFactoryError extends Error {}

/** The structured production package, same shape as backend/src/content/videoScriptWriter.ts's VideoScript. */
export interface VideoScript {
  hook: string;
  script: string;
  shotList: string[];
  youtubeTitle: string;
  youtubeDescription: string;
  tiktokCaption: string;
  hashtags: string[];
  disclosureCta: string | null;
}

/**
 * Everything the renderer needs, already validated and confirmed
 * human-approved. `approvedAt` is REQUIRED and is the one field the
 * approval gate checks -- see loadApprovedScript.ts's assertApproved.
 */
export interface VideoScriptPackage {
  draftId: string;
  campaignTitle: string;
  platform: string;
  assetType: string;
  videoScript: VideoScript;
  approvedBy: string | null;
  approvedAt: string;
}

/** Real per-word timing from edge_tts_words.py's WordBoundary capture (see voiceover.ts). */
export interface WordCue {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * One on-screen caption frame: `text` is already-assembled, ASS-ready
 * markup (see captions.ts's buildWordHighlightCues) -- the full on-screen
 * phrase with the currently-spoken word wrapped in an inline colour
 * override tag, not plain text. buildAssFile interpolates it directly into
 * the Dialogue line rather than re-escaping it.
 */
export interface CaptionCue {
  text: string;
  startSeconds: number;
  endSeconds: number;
  style: "Hook" | "Caption";
}

export type SceneKind = "hook" | "product" | "metric" | "cta" | "explanation";

export interface Scene {
  kind: SceneKind;
  label: string;
  durationSeconds: number;
  backgroundColor: string; // ffmpeg lavfi color spec, e.g. "0x05070a"
  clipPath?: string; // absolute path to a loopable video file; undefined falls back to solid color
}

export interface RenderPlan {
  scenes: Scene[];
  totalDurationSeconds: number;
  voiceoverPath: string;
  assPath: string;
  outputPath: string;
  silencePadSeconds: number;
}

export interface FfprobeStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  format: {
    duration?: string;
    size?: string;
  };
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
}

export interface RenderReport {
  draftId: string;
  campaignTitle: string;
  hook: string;
  tiktokCaption: string;
  hashtags: string[];
  durationSeconds: number;
  resolution: string;
  videoCodec: string;
  audioCodec: string;
  validation: ValidationResult;
  outputPath: string;
  renderedAt: string;
}
