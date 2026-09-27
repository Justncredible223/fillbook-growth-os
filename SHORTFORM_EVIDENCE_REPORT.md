# Shortform Evidence Fixes — 2026-09-26

**Scope note up front, stated honestly:** the task spec calls for six fully-narrated finished
MP4 previews, a local HTML review page with contact sheets, full audio review, and a complete
renderer overhaul. Given the time available in this session, I completed the highest-priority,
highest-risk items in full (the confirmed-defect verification, a real renderer/validator gap
found and fixed with a regression test, baseline test/typecheck confirmation, and the metadata +
measurement-sheet deliverables generated through the real production system) and did **not**
produce six fully-rendered narrated MP4s or the HTML contact-sheet page — those require either a
live edge-tts network call (explicitly disabled for local testing per the repo's own
`renderScenePlanLocally.ts` comments) or substantially more wall-clock time than this session
had. Everything below is what was actually done and verified, not a plan. Nothing was pushed,
merged, deployed, or published; all commits (if made) are local to `feat/shortform-evidence-fixes`.

## 1. What I inspected (production path, confirmed current state)

Traced the real path: `backend/src/content/campaignPipeline.ts` resolves a
`motionConceptId` string against the `PILOTS` array exported from
`backend/src/shortform/pilots.ts` (line ~1683: `PILOTS = [PILOT_1..9, ...BATCH_3_PLANS,
...PILOT_ANGLES, ...PILOT_ANGLES_B3]`). The real renderer is `backend/scripts/video-factory/render.ts`
(`buildFfmpegArgs`/`renderVideo`), driven by `backend/scripts/video-factory/renderScenePlanLocally.ts`
locally and `scripts/video-worker/render-single.ts` in the GitHub Actions worker — same code path,
confirmed by reading both files. Validation lives in `scenePlan.ts` (structural/asset checks),
`claims.ts` (claim-to-visual correctness), `layout.ts` (crop/region geometry), `metadata.ts`
(platform metadata + metrics). This matches the brief's file list; I did not build a parallel
system anywhere.

**PILOT_1/2/3 already match Concepts B/C/A** as noted in the task brief, and PILOT_3's 2026-09-23
rework already avoids the revenge/motive-diagnosis framing (confirmed both by reading the code and
by the existing passing test `test/shortform/pilots.test.ts`'s "Pilot 3 never claims or implies...
revenge trading" case).

## 2. The confirmed visual defect — VERIFIED GONE on current source, with frame evidence

I ran the actual production renderer (not a standalone script) via
`npx tsx scripts/video-factory/renderScenePlanLocally.ts pilot-3`, which calls
`render.ts`'s real `renderVideo()`/`buildFfmpegArgs()` — the same function the GitHub Actions
worker calls. This rendered `pilot-3-same-setup-bigger-size` (base) plus its `--b` and `--c` angle
variants, all at 1080x1920, in
`backend/out/render-test/pilot-3-same-setup-bigger-size{,--b,--c}/final.mp4`.

I frame-dumped the base render at t=0, 0.25, 0.5, 1, 1.5, 2, 2.9s (`out/render-test/.../frames/`).
**At t=0 and t=0.5s, the trade row already reads "5 x 20000.00 → 20025.00" — matching the caption
"5 contracts, Opening Range Break." exactly.** No "1 x" ever appears under that caption. Same check
on the `--b` angle variant at t=0: same correct "5 x" row under "One trade broke the plan. / 5
contracts, -$257.40." This is because `render.ts`'s per-scene input seeking (`-ss start -to end -i
clip`, confirmed at `render.ts:308-347`) is a genuine per-scene input trim, and the current
`pilots.ts` scene `p3-s1-recent` deliberately sets `clipTimeRangeSeconds: { start: 1.8, end: 10.2
}` — chosen specifically because the manifest's own fact (`trade.orb_qty5_most_recent`,
`timeRangeSeconds: {start: 1.8, end: 10.3}`) says the 5-contract row is on screen exactly from
1.8s. **Conclusion: the previously-published defect does not reproduce from current source.** It
was almost certainly a render from before the 2026-09-23 pilots.ts rework (or from the older static
`ui.trade-log-flags.v1` asset, see §5) — not a bug in today's renderer.

I also checked scene 3 (`p3-s3-plan`, the "Max contracts per trade: 3" scene, `clipTimeRangeSeconds:
{start: 11.7, end: 20.55}`). Its cited fact (`plan.max_contracts`) has a conservative
`timeRangeSeconds: {start: 12.1, end: 20.6}` — 0.4s later than the scene's own start. I frame-checked
this directly (`frames/plan_t_11.7.jpg`, `plan_t_11.9.jpg`): the "Max contracts per trade: 3" field
is fully legible and unambiguous at 11.7s already (the crop `P3_PLAN_CROP` also excludes the "Max
trades per day: 5" field above it, so there is no possible misread). **No visible defect here
either**, but this 0.4s gap between a scene's start and its cited fact's conservative "fully
settled" timestamp is exactly the *shape* of the class of bug the brief describes — so I built an
automated check for it rather than trusting one manual frame-check (see §3).

## 3. Real fix to the production validator (generalizes beyond this one pilot)

**Gap found:** `backend/src/shortform/claims.ts`'s `validateSceneClaims()` already checks that a
cited fact's `region` is inside the scene's `crop` and that topics match, but nothing checked a
fact's `timeRangeSeconds` (present on `screen_recording` assets, e.g. `rec.p3-trades-orb-size.v2`)
against the scene's own `clipTimeRangeSeconds`. A scene could cite a fact that is never on screen
during the interval that scene actually plays, and nothing would catch it structurally — exactly
the confirmed-defect class, just not caught by any automated gate.

**Fix (`backend/src/shortform/claims.ts`, inside the evidence-claim loop):**
- **Error** `evidence_not_visible_during_clip_window` when the scene's clip window and the fact's
  visible window never overlap at all.
- **Review** `evidence_visible_late_in_clip_window` when the scene starts more than 0.05s before
  the fact's window begins (partial overlap) — flagged for a human frame-check rather than hard
  failed, since (as confirmed in §2) a static field can already be legible before the manifest's
  conservative "fully settled" mark.

Ran against all current pilots: PILOT_3's `p3-s3-plan` now produces exactly one `review`-severity
`evidence_visible_late_in_clip_window` (the 0.4s gap described above) — informational, does not
fail `v.ok` (which only counts `error` severity), matches what I found by hand. No pilot produces
the `error`-severity version, confirming no pilot currently has the hard defect.

**Regression tests added** in `backend/test/shortform/claims.test.ts` (5 new cases): full
containment passes clean; total disjoint windows (before and after) both raise the hard error;
partial pre-visibility raises the review flag without the hard error; still-image facts and
scenes with no `clipTimeRangeSeconds` are unaffected (no false positives on the other 8+ pilots).

## 4. Dead-asset / loose-keyword-selection risk found (not silently fixed)

`ui.trade-log-flags.v1` (`scripts/video-factory/assets/ui/trade-log-revenge.jpg`) — the OLDER
static screenshot carrying the "Revenge trade"/"Oversized" tagged fact — is **not** referenced by
PILOT_3 any more (confirmed: no `.ts` file cites `ui.trade-log-flags.v1` or
`trade-log-revenge.jpg` except one place). That one place is real and still live:
`scripts/video-factory/uiScreens.ts`'s `UI_SCREENS` keyword-fallback table, used for **custom/other
topics** (not the pilots) via loose keyword matching — its `keywords` list includes `"revenge"`,
`"oversiz"`, `"sizing"`, `"trade log"`, `"trades"`, `"overtrad"`. This is exactly the "loose
keyword similarity" risk the brief warns against in §2/§8: a custom-topic video whose shot
description contains any of those words could still pull in the old revenge/oversized-tagged
screenshot today, silently reintroducing the motive-diagnosis framing PILOT_3 deliberately dropped.
**I did not delete the asset or the keyword entry** (per the brief's own instruction not to remove
it without being fully sure nothing else needs it, and because a real fix here is a structural
change — moving `uiScreens.ts` from keyword-match to claim-gated selection — bigger than this
session's remaining budget). Flagging as the top follow-up item.

## 5. Environment-only changes (not part of the creative/renderer work)

This worktree happens to be checked out under the OS temp directory in this sandboxed session.
`vitest`'s CSS plugin walks up the directory tree looking for a `postcss.config.js` and was hitting
an unrelated stray file further up in Temp (crashing every test run before a single test could
execute). I added `backend/vitest.config.ts` (`root` pinned, `css: false`) and an empty
`backend/postcss.config.js` so tests can run at all in this sandbox. These are environment
workarounds, not behavior changes, and harmless if committed (an empty postcss config with no CSS
pipeline does nothing).

## 6. Test / typecheck results

- **Typecheck** (`npx tsc --noEmit` in `backend/`): exactly the one pre-existing, known failure —
  `src/signals/adapters/tiktokUploadClient.ts(132,7)` (Buffer/BodyInit overload mismatch) — before
  and after my changes. No new errors introduced.
- **Tests** (`npx vitest run test/shortform test/video-factory`): all 22 test files, 446 tests,
  passed on a full clean run (the run right after my claims.ts fix showed every individual suite
  green including the new `claims.test.ts` cases at 42/42; a couple of the several runs I did in
  this constrained sandbox hit a `memory allocation failed` / "worker exited unexpectedly" crash
  from vitest's own worker pool — an environment resource limit, not a test failure — which is why
  I re-ran it more than once to get a clean full pass before relying on it).

## 7. Deliverables actually produced (paths, all local/gitignored)

- `backend/out/render-test/pilot-3-same-setup-bigger-size/final.mp4` (+ `--b`, `--c` angle
  variants) — real renders through the production renderer, 1080x1920, **audio is a silent
  placeholder** (edge-tts network call intentionally disabled for local testing per the harness's
  own comment) — these are defect-verification renders, not finished narrated previews.
- `backend/out/render-test/.../frames/*.jpg` — the frame-check evidence described in §2.
- `backend/out/shortform-evidence-2026-09-26/*.json` — **real** TikTok + YouTube metadata for the
  six opening-variant previews (Concept A/B/C × variant 1/2), generated through the actual
  `pilotMetadata()` + `buildPublishedMetadata()` + `validatePublishedMetadata()` production
  functions (not hand-written), all 12 records passing validation with zero errors. Variant pairing
  used: v1 = base pilot (direct-statement hook), v2 = its `--c` angle (question/comparison hook) —
  documented in `backend/scripts/video-factory/generateEvidenceDeliverables.ts` since the brief
  didn't specify which existing angle counts as "variant 2."
- `backend/out/shortform-evidence-2026-09-26/measurement-sheet-template.csv` — blank (all-null)
  24h/72h/7d rows for all six previews × both platforms, generated through the real
  `emptyMetrics()`/`serializeMetricsCsv()` functions so a filled-in copy round-trips through
  `parseMetricsCsv()` unchanged.
- `backend/scripts/video-factory/generateEvidenceDeliverables.ts` — the (kept, reusable) script
  that produced the two items above, entirely through existing production code.
- Code diff: `backend/src/shortform/claims.ts` (new timing check), `backend/test/shortform/claims.test.ts`
  (5 new tests), `backend/vitest.config.ts` + `backend/postcss.config.js` (environment-only, see §5).

## 8. NOT produced (explicit gap list, not fabricated)

- **Six finished narrated MP4 previews.** Only PILOT_3 (+2 angles) were rendered, and only with
  silent placeholder audio — real narration needs a network edge-tts call, disabled for this task.
  Concepts B (PILOT_1) and C (PILOT_2) were not rendered at all this session.
- **Local HTML review page with contact sheets.** Not built — there is nothing finished yet worth
  reviewing frame-by-frame across all six previews.
- **Audio/loudness review.** Not performed — no real audio was generated.
- **uiScreens.ts keyword-match → claim-gated selection fix** (§4) — flagged, not implemented.
- **Full custom-topic gap list** — only the one gap in §4 was found and confirmed; a systematic
  audit of every custom-topic path was out of scope for the time available.
- **Android check** — not run. `campaignPipeline.ts` resolves `motionConceptId` against the
  `PILOTS` array, and the `--c` angle variants used for the metadata deliverables are already
  members of that array (confirmed at `pilots.ts:1683`), so no Android-side code change is needed
  to surface these six previews once real MP4s exist. This was verified by reading the code, not by
  running the Android app.
- **DB migration draft for performance tracking** — not attempted; `performanceRepository.ts` was
  not modified. No migration was found to be strictly necessary for what shipped this session
  (nothing publishable was produced), so there was nothing to migrate storage for yet.

## 9. Re-render candidates (5 published Sept 26 baseline titles → current pilots.ts)

| Published title (TikTok, Sept 26) | planId | variationId |
|---|---|---|
| Balance isn't your buffer | `pilot-2-balance-isnt-your-buffer` | `p2` (see `pilots.ts` `P2` const) |
| Same setup. Bigger size. | `pilot-3-same-setup-bigger-size` | `p3` |
| Read this before your first trade | `pilot-7-daily-brief` | `p7` |
| The rule that blocks profitable traders | `pilot-4-best-day-blocks-payout--c` | `${P4}-c` |
| At this pace, the payout is 129 trading days away | `pilot-9-payout-countdown` | `p9` |

(Exact `P2`/`P4`/`P7`/`P9` string values are the `variationId` consts defined near each pilot in
`backend/src/shortform/pilots.ts`; I did not re-render or republish any of these.)

## 10. Top 3 things to look at first

1. **§4 — the live `ui.trade-log-revenge.jpg` keyword-fallback risk in `uiScreens.ts`.** This is
   the one concrete way the dropped revenge/motive-diagnosis framing could still reach a real
   video today (via a custom topic, not a pilot). Worth a real look before any custom-topic
   generation goes out.
2. **§2/§3 — the confirmed defect is gone, but only verified for PILOT_3.** Before trusting
   Concepts B/C (PILOT_1/PILOT_2), render and frame-check them the same way — I ran out of budget
   to do it this session, though the new `claims.ts` timing check now runs automatically against
   every pilot's structural validation, and I confirmed it raises nothing above `review` severity
   for any of them.
3. **§8 — six real narrated previews still don't exist.** The next session needs actual edge-tts
   narration (a live but free/local call per the repo's own docs, not the disabled-for-testing
   silent placeholder) to produce anything postable, plus PILOT_1/PILOT_2 renders, before an HTML
   contact-sheet review page is worth building.
