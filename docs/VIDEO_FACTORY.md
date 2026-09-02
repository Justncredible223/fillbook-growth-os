# Video Factory — script generation (Growth OS) + local render (you)

Growth OS generates a real, shootable **production package** for video
opportunities (currently: any opportunity whose recommended platform is
`tiktok`) — hook, full voiceover script, shot list, caption, and hashtags —
and runs it through the same review pipeline as every other draft
(mechanical quality gate + the nine LLM review agents). It shows up in the
Android app's Approvals screen exactly like a text post does, just with a
`video_script` asset type instead of `post`.

**What Growth OS does NOT do, on purpose:** call a TTS API, run ffmpeg, or
produce a video file. Vercel's serverless functions have execution-time and
disk limits unsuited to video rendering (10s on Hobby, up to 300s on Pro —
real rendering can need more of both, plus scratch disk ffmpeg doesn't get
in a serverless invocation). Rendering stays a local step you run yourself,
same as it already is for every video posted from `@fillbookhq` so far.

## End-to-end flow

1. **Growth OS drafts it.** A `tiktok` opportunity runs through
   `draftVideoScript` (`backend/src/content/videoScriptWriter.ts`), passes
   the mechanical gate + deep review, and lands in Approvals as a
   `video_script` asset — same as any other draft, same human-approval-only
   rule (`ExternalWriteFirewall` never lets this auto-publish).
2. **You approve it** in the Android app, same button as any other draft.
3. **You render it locally**, using the exact script/shot-list/caption from
   the approved draft. This repo doesn't duplicate the render pipeline —
   it's already built, tested, and documented at
   `~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md` (real bugs found
   and fixed there: an ffmpeg `drawtext` segfault, a libass caption-clipping
   bug — worth reading before improvising a different approach). Summary:
   - `edge-tts` (free, no API key, via `uvx --from edge-tts edge-tts ...`)
     turns the approved SCRIPT text into a voiceover `.mp3` + `.srt`.
   - A hand-written `.ass` caption file (not raw `.srt`, not `drawtext` —
     both hit real bugs) times captions against the voiceover.
   - `ffmpeg` (winget `Gyan.FFmpeg`) composites a solid brand-color
     background + the voiceover + burned-in captions into the final
     9:16 `.mp4`.
   - Validate before doing anything else: `ffprobe` for resolution/duration/
     codec, then visually inspect a few extracted frames.
4. **You upload it to TikTok yourself.** No code path here or in the render
   pipeline ever touches TikTok's upload API — same human-only-publish
   invariant as every other platform.

## Why this split, not more automation

- The **creative step** (deciding what to say, whether a claim is
  grounded, whether the hook actually works) is exactly what Growth OS's
  existing pipeline is built for — reusing it here means TikTok video
  scripts get the same brand/factual/anti-slop scrutiny a text post does,
  for free.
- The **mechanical render step** (TTS + ffmpeg) has no judgment calls left
  in it once the script is approved — it's a real infra/tooling problem
  (where does ffmpeg run with enough time and disk), not a content-quality
  one, and doesn't need an LLM or a review pipeline. It's also already
  solved and working on your machine.
- Automating the render step later (a small always-on worker, e.g. a $5-7/mo
  VPS or Railway/Fly.io service with ffmpeg installed) is a real option if
  render volume grows enough to justify it — see the "Video Factory" entry
  in `docs/PROGRESS_LEDGER.md` for the tradeoffs. Not worth building for a
  few videos a week with one owner doing final review anyway.

## Extending to other video platforms

`VIDEO_PLATFORMS` in `backend/src/content/campaignPipeline.ts` currently
only treats `tiktok` opportunities as video. Adding `youtube_shorts` (or
any other short-form video platform) later is a one-line addition to that
set — the writer and render pipeline are already platform-agnostic.
