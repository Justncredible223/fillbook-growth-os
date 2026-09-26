/**
 * The Rook-and-Tilt duo's lines for every verified motion concept (2026-09-26, owner request: something under the
 * evidence that entertains while staying on topic). Rook is the calm one who journals every trade; Tilt is the
 * impulsive one who makes the mistake the concept is about. One beat per scene, in scene order, keyed by the base
 * plan -- an angle (`<planId>--<key>`) re-cuts the same four scenes, so it reuses its base plan's beats.
 *
 * Quips react; they never inform. No numbers, no promises, no advice -- validateScenePlan rejects any digit, $ or %,
 * and anything longer than CHARACTER_QUIP_MAX_CHARS, which is what fits the speech bubble in two lines.
 */
import type { CharacterBeat, CharacterName, CharacterPose, ScenePlan } from "./types.js";

export const CHARACTER_QUIP_MAX_CHARS = 36;

function beat(speaker: CharacterName, quip: string, rook: CharacterPose, tilt: CharacterPose): CharacterBeat {
  return { speaker, quip, rook, tilt };
}

/** [hook, evidence, qualify, close] for each base concept. */
export const CHARACTER_BEATS: Record<string, CharacterBeat[]> = {
  "pilot-1-green-month-losing-setup": [
    beat("tilt", "Green month! We're rich!", "think", "cheer"),
    beat("rook", "Look closer. That setup bleeds.", "point", "shock"),
    beat("tilt", "Wait, whose month is this?", "shrug", "think"),
    beat("tilt", "Fine. I'll check my setups.", "cheer", "facepalm"),
  ],
  "pilot-2-balance-isnt-your-buffer": [
    beat("tilt", "Big balance, big room, right?", "think", "cheer"),
    beat("rook", "Nope. The loss limit is the room.", "point", "shock"),
    beat("rook", "Your firm's rulebook wins. Always.", "point", "think"),
    beat("tilt", "Reading the rules. Promise.", "cheer", "cheer"),
  ],
  "pilot-3-same-setup-bigger-size": [
    beat("tilt", "Same setup, more size. Easy!", "shock", "cheer"),
    beat("tilt", "Phew. Not my account.", "shrug", "cheer"),
    beat("rook", "The plan said otherwise.", "point", "facepalm"),
    beat("tilt", "Wait... what IS my limit?", "point", "think"),
  ],
  "pilot-4-best-day-blocks-payout": [
    beat("tilt", "My best day ever!", "think", "cheer"),
    beat("rook", "And it's over the cap.", "point", "shock"),
    beat("rook", "Sample account. Real lesson.", "point", "think"),
    beat("tilt", "Rules in once. Checked every time.", "cheer", "cheer"),
  ],
  "pilot-5-would-you-pass": [
    beat("tilt", "Pass? Obviously!", "think", "cheer"),
    beat("rook", "No breach. Still not a pass.", "point", "shock"),
    beat("tilt", "So it's a dress rehearsal?", "cheer", "think"),
    beat("tilt", "Test first, pay later.", "cheer", "cheer"),
  ],
  "pilot-6-edge-score": [
    beat("tilt", "Wait, I get graded?", "cheer", "shock"),
    beat("rook", "Great rules. Weaker profits.", "point", "think"),
    beat("rook", "Sample numbers. No crystal ball.", "shrug", "idle"),
    beat("tilt", "Okay, show me my score.", "cheer", "cheer"),
  ],
  "pilot-7-daily-brief": [
    beat("tilt", "Read? Before trading?!", "point", "shock"),
    beat("rook", "Buffer, limit, best window.", "point", "think"),
    beat("tilt", "Can mine look like that?", "point", "cheer"),
    beat("tilt", "Numbers first. Then clicks.", "cheer", "cheer"),
  ],
  "pilot-8-red-weekday": [
    beat("tilt", "Green week! Mostly.", "think", "cheer"),
    beat("rook", "There's the red day.", "point", "facepalm"),
    beat("tilt", "Not my Mondays. Probably.", "shrug", "shrug"),
    beat("tilt", "Which day is mine?", "point", "think"),
  ],
  "pilot-9-payout-countdown": [
    beat("tilt", "That's forever away!", "think", "shock"),
    beat("rook", "Every requirement, tracked.", "point", "think"),
    beat("rook", "Your firm has the final word.", "point", "think"),
    beat("tilt", "Countdown on. Let's go.", "cheer", "cheer"),
  ],
  "pilot-10-sized-up-after-a-loss": [
    beat("tilt", "Me? Revenge trade? Never.", "facepalm", "shrug"),
    beat("rook", "Flagged. More than once.", "point", "facepalm"),
    beat("tilt", "Okay, not my account... yet.", "think", "facepalm"),
    beat("tilt", "Okay. Breathe after a loss.", "cheer", "think"),
  ],
  "pilot-11-six-trade-days": [
    beat("tilt", "Just one more trade...", "shock", "cheer"),
    beat("rook", "Busy days, red days.", "point", "facepalm"),
    beat("rook", "Sample trader. Same trap.", "point", "shock"),
    beat("tilt", "Know my normal. Got it.", "cheer", "think"),
  ],
  "pilot-12-the-11-oclock-trades": [
    beat("tilt", "Late morning is my time!", "think", "cheer"),
    beat("rook", "The open does the heavy lifting.", "point", "shock"),
    beat("tilt", "Sample account? Phew.", "shrug", "cheer"),
    beat("tilt", "Which hour is costing me?", "point", "think"),
  ],
  "pilot-13-what-moving-your-stop-costs": [
    beat("tilt", "Moving my stop is free, right?", "shock", "shrug"),
    beat("rook", "It has a price tag. Look.", "point", "shock"),
    beat("rook", "You get out what you tag.", "point", "think"),
    beat("tilt", "Okay. Pricing my worst habit.", "cheer", "facepalm"),
  ],
  "pilot-14-would-you-take-it-again": [
    beat("tilt", "I knew that one was bad...", "think", "facepalm"),
    beat("rook", "Your gut already sorted them.", "point", "shock"),
    beat("tilt", "Be honest with myself? Ugh.", "cheer", "facepalm"),
    beat("tilt", "Would I take it again? Asking!", "cheer", "cheer"),
  ],
  "pilot-15-92-percent-on-plan": [
    beat("tilt", "Nearly perfect on plan!", "think", "cheer"),
    beat("rook", "The off-plan trades cost more.", "point", "shock"),
    beat("rook", "Your plan, your rules.", "point", "think"),
    beat("tilt", "Checking against my plan now.", "cheer", "think"),
  ],
  "pilot-16-win-rate-76-to-55": [
    beat("tilt", "What happened to my win rate?", "think", "shock"),
    beat("rook", "Revenge and overtrading crept in.", "point", "facepalm"),
    beat("tilt", "Not my win rate. Right?", "shrug", "shock"),
    beat("tilt", "Something changed. Let's find it.", "point", "think"),
  ],
  "pilot-17-two-accounts-one-screen": [
    beat("tilt", "Two accounts. Two headaches.", "think", "shock"),
    beat("rook", "One is over its cap. See it?", "point", "shock"),
    beat("rook", "Your firm sets the real limits.", "point", "think"),
    beat("tilt", "Every account, one look.", "cheer", "cheer"),
  ],
  "pilot-18-your-best-setup-by-the-numbers": [
    beat("tilt", "Which setup is actually mine?", "point", "think"),
    beat("rook", "That one's carrying the log.", "point", "cheer"),
    beat("tilt", "Sample account. My turn next.", "cheer", "cheer"),
    beat("tilt", "Finding my best setup now.", "cheer", "cheer"),
  ],
};

/** The base concept an angle was cut from (`pilot-1-...--b` -> `pilot-1-...`); a base plan's id is its own base. */
export function basePlanId(planId: string): string {
  return planId.split("--")[0]!;
}

/** Returns `plan` with each scene's `character` beat set from CHARACTER_BEATS; throws if the counts don't line up. */
export function withCharacterBeats(plan: ScenePlan): ScenePlan {
  const beats = CHARACTER_BEATS[basePlanId(plan.planId)];
  if (!beats) throw new Error(`${plan.planId}: no character beats in CHARACTER_BEATS.`);
  if (beats.length !== plan.scenes.length) throw new Error(`${plan.planId}: ${beats.length} character beats for ${plan.scenes.length} scenes.`);
  return { ...plan, scenes: plan.scenes.map((s, i) => ({ ...s, character: beats[i]! })) };
}
