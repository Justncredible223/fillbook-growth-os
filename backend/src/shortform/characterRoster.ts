/**
 * The roster of selectable character pairs (2026-09-27, owner request: visual variety across a
 * channel about to publish many videos, not the same two characters every time). Pure data plus a
 * deterministic selector -- no rendering, no filesystem -- so both the content side
 * (characterBeats.ts) and the render side (scripts/video-factory/characters.ts) import from here
 * rather than either one owning the roster.
 *
 * Each pair maps the two structural SEATS (CharacterRole: "rook" = calm/left, "tilt" =
 * impulsive/right -- see types.ts) to the actual CharacterName drawn in that seat. Every existing
 * CHARACTER_BEATS entry is written once per seat and is reused unchanged by every pair: adding a
 * pair here is enough to make it selectable everywhere, no beat/quip rewrite needed.
 */
import type { CharacterName, CharacterPairId, CharacterRole } from "./types.js";

export const CHARACTER_PAIRS: Record<CharacterPairId, Record<CharacterRole, CharacterName>> = {
  "rook-tilt": { rook: "rook", tilt: "tilt" },
  "ledger-margin": { rook: "ledger", tilt: "margin" },
  "vector-blip": { rook: "vector", tilt: "blip" },
};

/** Iteration order also doubles as the hash-selection order below -- keep stable once pilots ship, so a render stays reproducible even as new pairs are appended (append only; never reorder or remove). */
export const ALL_CHARACTER_PAIR_IDS: CharacterPairId[] = ["rook-tilt", "ledger-margin", "vector-blip"];

export const CHARACTER_DISPLAY_NAME: Record<CharacterName, string> = {
  rook: "Rook",
  tilt: "Tilt",
  ledger: "Ledger",
  margin: "Margin",
  vector: "Vector",
  blip: "Blip",
};

/** One line describing the persona, for the review page / metadata -- never shown on screen. */
export const CHARACTER_PAIR_LABEL: Record<CharacterPairId, string> = {
  "rook-tilt": "Rook & Tilt -- the original hoodie duo",
  "ledger-margin": "Ledger & Margin -- old-school floor-trader look (blazers, eyeshade, pit phone)",
  "vector-blip": "Vector & Blip -- multi-monitor scalper desk look (headsets, glowing chart panel)",
};

/** FNV-1a-style small string hash -- deterministic across platforms/runs, no crypto dependency needed for a non-secret selection. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A PURE function of (planId, variationId): the same two inputs always select the same pair, so a
 * render stays reproducible/testable, never random per-render. Different pilots/variants land on
 * different pairs (uniformly, since the hash is not correlated with any particular plan-naming
 * pattern), which is what actually produces channel-wide variety.
 */
export function selectCharacterPair(planId: string, variationId: string): CharacterPairId {
  const h = hashString(`${planId}::${variationId}`);
  return ALL_CHARACTER_PAIR_IDS[h % ALL_CHARACTER_PAIR_IDS.length]!;
}
