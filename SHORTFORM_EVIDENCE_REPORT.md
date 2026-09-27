# Shortform Evidence Fixes — 2026-09-26 / 2026-09-27

Two passes. Pass 1 (2026-09-26) verified the confirmed defect, added a renderer-validator
regression check, and produced defect-verification-only renders with silent placeholder audio.
Pass 2 (2026-09-27) produced six real narrated finished previews, a local HTML review page,
frame-checked all three concepts, fixed a real on-screen CTA bug found along the way, narrowed the
uiScreens.ts stale-asset risk, and did an honest (stated-limitation) audio review. This file
supersedes the pass-1 report. Nothing was pushed, merged, deployed, or published; all commits are
local to `feat/shortform-evidence-fixes`.

## 1. Production path traced (unchanged from pass 1, re-confirmed)

`backend/src/content/campaignPipeline.ts` resolves a `motionConceptId` against the `PILOTS` array
(`backend/src/shortform/pilots.ts`). The real renderer is `backend/scripts/video-factory/render.ts`
(`buildFfmpegArgs`/`renderVideo`) — the exact same function called by
`scripts/video-worker/render-single.ts` (the GitHub Actions worker) and, for this task, by
`scripts/video-worker/verifyRealNarratedRender.ts`, an already-existing harness that runs the REAL
`runRender()` end-to-end (real edge-tts narration, real scene-duration reconciliation against
measured speech, real per-scene captions) against a fake in-memory Supabase client — no real
DB/storage/publish. I used this harness (not a parallel script) for every rendered preview below.

## 2. The confirmed visual defect — VERIFIED GONE on current source, all three concepts

**PILOT_3 (Concept A):** frame-dumped the real render at t=0, 0.25, 0.5, 1, 1.5, 2, 2.9s. At t=0
and t=0.5s the trade row already reads "5 x 20000.00 → 20025.00," matching the caption "5
contracts, Opening Range Break." exactly — no "1 x" ever appears. The plan-limit scene ("Max
contracts per trade: 3") is legible and unambiguous from its very first frame. **Defect does not
reproduce.**

**PILOT_1 (Concept B):** t=0 shows "Net P&L +$387.08" / "22" trades, matching the caption "$387.08
net, 22 of 22 trades." exactly. The evidence-transition scene (~t=4.5s) shows "Opening Range Break:
8 trades, 25% win, -$421.76," matching its caption exactly. **No defect found.**

**PILOT_2 (Concept C):** t=0 shows "Net P&L +$387.08," matching "Account net: +$387.08." The rules
scene shows three separately-labeled numbers — "Trailing drawdown buffer $1,725.12," "Today's loss
limit remaining $1,000.00," "Profit target $3,000.00 · currently $387.08 (13%)" — never calling
P&L "balance," matching its caption exactly. **No defect found.** (Frame evidence for all three:
`backend/out/shortform-evidence-2026-09-26/previews/frames_{A_comparison,B_direct,C_direct}/*.jpg`
and each preview's contact sheet.)

Conclusion unchanged from pass 1: the previously-published defect does not reproduce from current
source, for any of the three concepts.

## 3. Real renderer/validator fixes made this pass

### 3a. Claim-timing regression check (pass 1, unchanged)
`backend/src/shortform/claims.ts`'s `validateSceneClaims()` now checks a cited fact's
`timeRangeSeconds` against the scene's own `clipTimeRangeSeconds`: **error**
`evidence_not_visible_during_clip_window` on zero overlap, **review**
`evidence_visible_late_in_clip_window` on partial pre-visibility. 5 regression tests in
`test/shortform/claims.test.ts`.

### 3b. CTA text was never actually rendered on screen — found and fixed
While frame-checking PILOT_1's closing scene, I noticed no "Follow @fillbookhq" text anywhere on
screen despite `scene.cta` being set. Confirmed by grepping a real render's `captions.ass` for
"fillbook"/"follow": **no match, in any of the nine base pilots.** `scene.cta` was only ever used
to (a) pick the closing card's accent caption color and (b) feed `pilotMetadata()`'s
`cta`/`handlePlacement` fields — never painted onto the video. This meant every pilot's metadata
could report `handlePlacement.inClosingVisual: true` while the actual rendered pixels never showed
the handle at all — a real metadata/render mismatch.

**Fix:** `backend/scripts/video-factory/scenePlanAdapter.ts`'s caption-cue builder now appends
`scene.cta` as its own line (both the card-layout and non-card-layout branches). Verified by
re-rendering and frame-checking the closing scene: "Follow @fillbookhq" now appears (see
`frames_B_direct/cta_t_19.jpg` and every contact sheet's last panel).

**Regression test added:** `test/video-factory/scenePlanAdapterLabels.test.ts` — for every pilot
whose closing scene has a non-null `cta`, asserts the rendered caption cue includes that text.

### 3c. True "opening-only" A/B variant added (the pre-existing angle system wasn't the right tool)
The task's six-preview design requires **only** the opening to differ between variant 1 and
variant 2, with everything else (evidence, voice, duration-after-opening, caption style, CTA)
identical. The pre-existing `angleOf()` mechanism (used for `PILOT_ANGLES`, e.g. `pilot-3-...--c`)
rewrites **every** scene's wording for a full alternate angle — using it for the six previews would
have confounded "did the opening change retention" with "did the whole video change."

Added `openingOnlyVariant()` in `pilots.ts`: clones a base plan and replaces **only** scene 0's
narration/headline/caption/takeaway, leaving scenes 2-4 byte-identical (same narration → same
real-TTS timing). Three new real plan exports, added to `PILOTS` (so they're immediately usable
through the existing motion-concept/Android selection path, no other code change needed):
- `PILOT_1_OPENING_B` (`pilot-1-green-month-losing-setup--opening-b`)
- `PILOT_2_OPENING_B` (`pilot-2-balance-isnt-your-buffer--opening-b`)
- `PILOT_3_OPENING_C` (`pilot-3-same-setup-bigger-size--opening-c`)

Each reuses wording already authored/reviewed as a `PILOT_ANGLES` hook (not newly invented), just
applied on top of the base plan's own scenes 2-4. Gave each a distinct plan-level `title` from its
`PILOT_ANGLES` counterpart (same on-screen hook text, different catalog/metadata title) after
`motionCatalog.test.ts`'s uniqueness check correctly caught a title collision between the new
variant and the pre-existing angle sharing the same reused hook wording.

### 3d. uiScreens.ts stale-asset keyword-match risk — narrowed
`ui.trade-log-flags.v1` (`trade-log-revenge.jpg`) — the old screenshot tagging one trade "Revenge
trade"/"Oversized" — is no longer referenced by PILOT_3, but was still live in
`scripts/video-factory/uiScreens.ts`'s `UI_SCREENS` keyword-fallback table (used for **custom/other
topics**, not the pilots), matched by ordinary words like "revenge," "oversiz," "sizing," "trade
log," "trades." Any custom-topic shot description using one of those words could still surface it,
silently reintroducing the motive-diagnosis framing PILOT_3's 2026-09-23 rework deliberately
dropped — on a path that has no claim/evidence gating at all.

**Fix:** removed the `trade-log-revenge.jpg` entry from `UI_SCREENS` (confirmed nothing else
references the file/asset first). The image file itself is left in place. **Not fixed, flagged as
a follow-up:** the bigger gap — this whole keyword-matching system has no claim-gating at all,
unlike the nine verified pilots' `claims.ts` path — is documented in a code comment and here, not
closed. Tests updated: `test/video-factory/uiScreens.test.ts` (new test confirming
revenge/oversized/sizing/trade-log shot descriptions no longer surface the retired screen; retired
count 11→10).

## 4. Six finished narrated previews

All in `backend/out/shortform-evidence-2026-09-26/previews/`, real edge-tts narration (voice
`en-US-AndrewNeural`), real measured per-scene durations, 1080x1920, dated/versioned filenames:

| Concept | Variant | Hook | File | Duration |
|---|---|---|---|---|
| A — Plan vs Execution | v1 direct | "Same setup. Bigger size." | `2026-09-27-v2-conceptA-plan-vs-execution-direct.mp4` | 19.3s |
| A — Plan vs Execution | v2 comparison | "Your plan has a size limit. This trade used 5 contracts." | `2026-09-27-v2-conceptA-plan-vs-execution-comparison.mp4` | 17.1s |
| B — Green Month, Losing Setup | v1 direct | "Green month. Losing setup." | `2026-09-27-v2-conceptB-green-month-losing-setup-direct.mp4` | 19.6s |
| B — Green Month, Losing Setup | v2 comparison | "64% win rate. One setup still loses." | `2026-09-27-v2-conceptB-green-month-losing-setup-comparison.mp4` | 20.9s |
| C — Profit vs Buffer | v1 direct | "Balance isn't your buffer." | `2026-09-27-v2-conceptC-profit-vs-buffer-direct.mp4` | 20.6s |
| C — Profit vs Buffer | v2 question | "You're up. How much room is left?" | `2026-09-27-v2-conceptC-profit-vs-buffer-question.mp4` | 20.6s |

Each pair's evidence sequence, voice, CTA and caption style are identical; only the opening scene
differs (structurally guaranteed by `openingOnlyVariant()`, §3c).

**Local HTML review page:** `backend/out/shortform-evidence-2026-09-26/previews/review.html` —
embeds all six videos with `<video controls>`, one contact-sheet image (4x4 frame grid, every
45th frame) per video, hook/duration/planId metadata, and a written findings note per concept.
Contact sheets: `previews/contact-sheets/*.jpg`.

## 5. Audio review — stated limitation, objective measurements used instead

**I have no audio playback/listening capability in this environment** — I cannot verify
pronunciation, mixing "feel," or subjective clarity by ear. What I verified objectively instead
(ffmpeg `silencedetect`/`loudnorm`), for all six finished previews:
- **No leading silence**: `silencedetect` (noise=-40dB, d=0.15s) found no silence period starting
  at t=0 in any of the six files — narration/music is present from frame 1 in every case.
- **Loudness**: `input_i` (integrated loudness) ranges -15.73 to -15.32 LUFS across all six,
  `input_tp` (true peak) -1.49 to -1.39 dBTP — consistent and non-clipping across every preview.
- **Numbers/financial terms**: verified via the same evidence frame-checks in §2 — every spoken
  number in the narration is matched by an on-screen displayed number (already enforced by
  `claims.ts`'s `numberIsSupported` check, which all six previews pass since they're the verified
  pilots/variants).
This is a stated limitation, not a substitute claim of an auditory review — a real audio pass (or
this session gaining audio playback) is still needed before treating narration quality/pronunciation
as verified.

## 6. Test / typecheck results

- **Typecheck** (`npx tsc --noEmit`): exactly the one pre-existing known failure
  (`tiktokUploadClient.ts:132`), before and after every change this session. No new errors.
- **Full suite** (`npx vitest run test/shortform test/video-factory`): 21 of 22 test files (500+
  tests) pass cleanly on every full run, including the newly-updated `motionCatalog.test.ts`
  (57-concept count + uniqueness, now passing after the title-collision fix in §3c) and
  `uiScreens.test.ts` (15 tests, §3d).
- **One file could not be run to a clean completion in this sandbox:**
  `test/video-factory/scenePlanAdapterLabels.test.ts` (the file holding the new §3b CTA
  regression test). It consistently crashes (`memory allocation ... failed` / `Worker exited
  unexpectedly`) or hangs, both inside the full suite and run in isolation, across many retries —
  including before my changes, on the unmodified 9-pilot version, at the very start of this task.
  Found a single orphaned `node` process holding ~5.5GB resident in this shared sandbox
  (`Get-Process` showed PID 17696 at 5527MB) — almost certainly the real cause, not a defect in
  the test or the code it exercises. I did not kill it (uncertain provenance, didn't want to risk
  a destructive action on a process I couldn't positively identify). **I did not leave this
  unverified by fiat**: the exact behavior this test checks (cta text appears in the render output)
  was independently confirmed by real re-rendering + frame inspection in §3b and visible in every
  contact sheet's last panel. Recommend re-running this one file on a machine with more headroom
  before merging.

## 7. Source/evidence mapping (unchanged claims, still accurate)

| Concept | Claim | Asset / fact | Region |
|---|---|---|---|
| A | "5 contracts, Opening Range Break, Sept 21" | `rec.p3-trades-orb-size.v2` / `trade.orb_qty5_most_recent` | P3_RECENT_CROP |
| A | "Max contracts per trade: 3" | `rec.p3-trades-orb-size.v2` / `plan.max_contracts` | P3_PLAN_CROP |
| B | "$387.08 net, 22 of 22 trades" | `rec.p1-reports-setup-breakdown.v2` / `month.net_pnl` | P1_TOTAL_CROP |
| B | "Opening Range Break: 8 trades, 25% win, -$421.76" | same asset / `setup.opening_range_break_result` | P1_SETUP_CROP |
| C | "Account net: +$387.08" | `rec.p2-rules-buffer.v2` / `account.net_pnl_dashboard` | P2_ACCOUNT_CROP |
| C | "Buffer $1,725.12 / Loss limit $1,000.00 / Target $3,000.00" | same asset / 3 facts | P2_RULES_CARD_CROP |

## 8. Deliverables index

- 6 finished previews + review.html + contact sheets: `backend/out/shortform-evidence-2026-09-26/previews/`
- 12 metadata JSON files (6 previews × TikTok/YouTube), all passing `validatePublishedMetadata`:
  `backend/out/shortform-evidence-2026-09-26/*.json`
- Measurement-sheet template (24h/72h/7d × 6 previews × 2 platforms, all-null): `backend/out/shortform-evidence-2026-09-26/measurement-sheet-template.csv`
- Defect-verification-only silent-placeholder renders + frame dumps (pass 1): `backend/out/render-test/`
- Code changes: `src/shortform/claims.ts`, `src/shortform/pilots.ts`, `scripts/video-factory/scenePlanAdapter.ts`,
  `scripts/video-factory/uiScreens.ts`, `scripts/video-factory/generateEvidenceDeliverables.ts`
- Test changes: `test/shortform/claims.test.ts`, `test/video-factory/scenePlanAdapterLabels.test.ts`,
  `test/video-factory/uiScreens.test.ts`, `test/video-factory/motionCatalog.test.ts`
- Environment-only: `backend/vitest.config.ts`, `backend/postcss.config.js`

## 9. Explicit remaining gaps (not fabricated as done)

- uiScreens.ts's whole keyword-matching system still has no claim-gating (§3d) — narrowed, not closed.
- Only the one custom-topic gap in §3d was found; no systematic audit of every custom-topic path.
- Android app not run/checked interactively — verified by reading `campaignPipeline.ts` that the
  new opening-only variants need no Android-side change (they're already in `PILOTS`), not by
  exercising the app.
- No DB migration prepared — `performanceRepository.ts` untouched; nothing was published this
  session, so there's no new metric-observation row to store yet.
- `test/video-factory/scenePlanAdapterLabels.test.ts` unresolved sandbox flakiness (§6).
- Audio quality/pronunciation genuinely unverified by ear (§5) — objective stats only.

## 10. Re-render candidates (5 published Sept 26 baseline titles → current pilots.ts)

| Published title (TikTok, Sept 26) | planId | variationId |
|---|---|---|
| Balance isn't your buffer | `pilot-2-balance-isnt-your-buffer` | `P2` const |
| Same setup. Bigger size. | `pilot-3-same-setup-bigger-size` | `P3` const |
| Read this before your first trade | `pilot-7-daily-brief` | `P7` const |
| The rule that blocks profitable traders | `pilot-4-best-day-blocks-payout--c` | `${P4}-c` |
| At this pace, the payout is 129 trading days away | `pilot-9-payout-countdown` | `P9` const |

I did not re-render or republish any of these.

## 11. Top 3 things to look at first

1. **§3d — the `uiScreens.ts` keyword-matching architecture still has no claim-gating for custom
   topics**, even after removing the one stale asset that made the risk concrete. A future custom
   topic can still pair an unrelated screenshot with narration it doesn't actually support.
2. **§6 — one test file's sandbox flakiness.** The CTA-text fix itself is confirmed correct by real
   render + frame evidence, but `scenePlanAdapterLabels.test.ts` should be re-run cleanly (more
   memory headroom, or after confirming/clearing that orphaned 5.5GB node process) before merging.
3. **§5 — audio was verified only objectively (no clipping, no leading silence, consistent
   loudness), never by ear.** Get a real listen-through before treating these six previews as
   ready for any actual posting decision.
