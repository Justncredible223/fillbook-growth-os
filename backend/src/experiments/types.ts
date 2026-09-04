export type ExperimentStatus = "draft" | "running" | "completed" | "aborted";

/**
 * A before/after content-performance experiment -- NOT a randomized
 * traffic split (this system has no infrastructure to show different
 * content to different visitors; there's one X/YouTube/TikTok account).
 * "Control" is the period before startDate, "treatment" is startDate
 * onward, both measured on the same real metric (campaign_assets review
 * pass rate, filtered by the experiment's own platform/assetType/topic
 * criteria if given). This is the honest shape an experiment can take
 * without real conversion/attribution data -- see
 * docs/PROGRESS_LEDGER.md for why that's not available yet.
 */
export interface Experiment {
  id: string;
  hypothesis: string;
  /** What subset of campaign_assets this experiment is about -- e.g. { platform: "tiktok" } or { assetType: "video_script" }. Empty means "all assets." */
  scope: { platform?: string; assetType?: string };
  guardrailNote: string | null;
  status: ExperimentStatus;
  startDate: string;
  endDate: string | null;
  controlWindowStart: string;
  createdAt: string;
  result: ExperimentResult | null;
}

export interface ExperimentResult {
  controlRate: number | null;
  treatmentRate: number | null;
  absoluteDifference: number | null;
  pValue: number | null;
  isSignificant: boolean;
  insufficientSample: boolean;
  controlSampleSize: number;
  treatmentSampleSize: number;
  interpretation: string;
  computedAt: string;
}

export interface NewExperiment {
  hypothesis: string;
  scope: { platform?: string; assetType?: string };
  guardrailNote?: string | null;
  startDate: string;
  /** How far back "control" looks, in days, before startDate. */
  controlWindowDays: number;
}

export interface ExperimentRepository {
  list(): Promise<Experiment[]>;
  get(id: string): Promise<Experiment | null>;
  create(input: NewExperiment): Promise<Experiment>;
  complete(id: string, result: ExperimentResult, endDate: string): Promise<Experiment>;
  abort(id: string): Promise<void>;
}
