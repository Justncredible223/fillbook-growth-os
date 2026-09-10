# Video Factory — script generation (Growth OS) + local render (you)

Growth OS generates a real, shootable **production package** for video
opportunities (currently: any opportunity whose recommended platform is
`tiktok`) — hook, full voiceover script, shot list, caption, and hashtags —
and runs it through the same review pipeline as every other draft
(mechanical quality gate + the nine LLM review agents). It shows up in the
Android app's Approvals screen exactly like a text post does, just with a
`video_script` asset type instead of `post`.

**What Growth OS does NOT do, on purpose:** call a TTS API, run ffmpeg, or
produce a video file inside the Vercel deployment. Vercel's serverless
functions have execution-time and disk limits unsuited to video rendering
(10s on Hobby, up to 300s on Pro — real rendering can need more of both,
plus scratch disk ffmpeg doesn't get in a serverless invocation). Instead,
a **local-only CLI** (`backend/scripts/video-factory/`) automates the
mechanical production work on your own machine, after you've approved a
draft — see "Render command" below. It never runs in Vercel, never exposes
a network endpoint, and never publishes anything.

## End-to-end flow

1. **Growth OS drafts it.** A `tiktok` opportunity runs through
   `draftVideoScript` (`backend/src/content/videoScriptWriter.ts`), passes
   the mechanical gate + deep review, and lands in Approvals as a
   `video_script` asset — same as any other draft, same human-approval-only
   rule (`ExternalWriteFirewall` never lets this auto-publish).
2. **You approve it** in the Android app, same button as any other draft.
   This sets `campaigns.status = 'approved'` — the one thing the CLI's
   approval gate checks (see below).
3. **You render it** with one command (see "Render command"). The CLI
   fetches the approved package from Supabase, generates a real voiceover,
   times captions against it, composites branded scene backgrounds, and
   produces a validated 9:16 MP4 — fully automated, no manual ffmpeg
   commands needed day to day.
4. **You preview and upload it to TikTok yourself.** No code path here —
   in Growth OS or in the CLI — ever touches TikTok's upload API. Same
   human-only-publish invariant as every other platform.

## Prerequisites

Install once, system-wide (this is exactly the pipeline validated while
building the CLI — same tools, same versions used in testing):

| Tool | Purpose | Install (Windows) |
|---|---|---|
| ffmpeg (full build, with libx264/libass/libfreetype) | render, composite, caption burn-in | `winget install Gyan.FFmpeg` |
| Python 3 + `pip install edge-tts` | word-level narration timing (see edge_tts_words.py) | Python from python.org, then `pip install edge-tts` |
| Node.js 18+ | runs the CLI itself | already required for the rest of this repo |

No API keys, no paid tools. `edge-tts` (Microsoft neural TTS) is free and
needs no account. The CLI calls the `edge_tts` Python library directly
(via `edge_tts_words.py`), not the `edge-tts` command-line tool, because
only the library's `WordBoundary` stream gives real per-word timing —
the CLI's `--write-subtitles` only ever produced sentence-level SRT,
not enough to drive the word-by-word highlighted captions.

**Check everything is installed:**

```bash
ffmpeg -version
ffprobe -version
python3 --version
python3 -c "import edge_tts"
```

The CLI itself also checks all three automatically before doing anything
else, and fails with a clear message (pointing back to this section) if
one is missing — you don't have to remember to check by hand.

## Render command

From `backend/`:

```bash
npm run video:render -- <draft-id>
```

`<draft-id>` is the `campaign_assets.id` shown in the Approvals API /
Android app for the approved video draft. This fetches the approved
package directly from Supabase (needs `SUPABASE_SERVICE_ROLE_KEY` in
`backend/.env.local` — the same value already in Vercel's project env
vars) and refuses to proceed unless that draft is genuinely approved.

**Offline / no-Supabase-access variant**, if you'd rather hand it a file
(e.g. testing, or a package assembled outside the normal flow):

```bash
npm run video:render -- --input path/to/approved-video-package.json
```

The JSON file must include `approvedAt` (and ideally `approvedBy`) —
there is no way to render an offline package without asserting approval
explicitly; see "How the human-approval gate works."

Optional flags: `--voice <edge-tts voice name>` (default
`en-US-AndrewMultilingualNeural`, edge-tts's higher-quality "Multilingual"
HD neural tier), `--out-dir <path>` to override where output lands.

## Where outputs go

```
backend/output/video-factory/<draft-id>/
  package.json       -- the loaded, validated production package (for the record)
  script.txt          -- exact text sent to edge-tts
  voiceover.mp3        -- generated narration
  voiceover.words.json  -- edge-tts's real per-word timing (drives word-by-word captions)
  captions.ass           -- final burned-in caption/scene-label file
  final.mp4                -- the finished, validated video
  render-report.json        -- machine-readable summary (see below)
```

This directory is gitignored (`output/`) — nothing here is ever committed.
Rerunning the same draft ID overwrites its directory cleanly.

## How to preview the result

Open `final.mp4` in any video player, or from the command line:

```bash
start backend/output/video-factory/<draft-id>/final.mp4
```

To spot-check a specific moment without opening a player (useful for
checking caption clipping or a specific scene transition):

```bash
ffmpeg -y -ss <seconds> -i final.mp4 -frames:v 1 frame.png
```

## How validation works

After rendering, the CLI runs `ffprobe` on the output and checks, in
order: video stream present (codec), audio stream present (codec),
resolution is exactly 1080x1920, duration is a sane positive number,
duration is within 5 seconds of the expected narration+pad length, and
the output file is non-empty. Every check (pass or fail) prints in the
final summary. If any check fails, the command exits non-zero and prints
`Validation: FAIL` — the render is not silently treated as usable.

## How the human-approval gate works

The CLI has exactly one approval check
(`scripts/video-factory/loadApprovedScript.ts`'s `assertApproved`), called
once, immediately after loading, before anything else happens:

- **Draft-ID mode:** the loader only ever populates `approvedAt` when
  `campaigns.status === 'approved'` — the single status value that
  `POST /api/approvals`'s "approve" action sets, the same approval you
  already do in the Android app. Any other status (`draft`, `in_review`,
  `retired`) means `approvedAt` stays empty and the gate throws.
- **`--input` mode:** the JSON file must set `approvedAt` itself. There
  is no bypass, no flag, no env var that skips this check in either mode.

If you see `Draft has not been approved`, go approve it in the Approvals
screen first — that's the intended behavior, not a bug.

## Common errors

| Error | Meaning | Fix |
|---|---|---|
| `"ffmpeg" was not found on PATH` | ffmpeg isn't installed / not on PATH | `winget install Gyan.FFmpeg`, restart your terminal |
| `"python3" was not found on PATH` | Python isn't installed / not on PATH | Install Python from python.org, restart your terminal |
| `edge-tts word-timing script failed` mentioning `ModuleNotFoundError: No module named 'edge_tts'` | the `edge-tts` package isn't installed for this Python | `pip install edge-tts` |
| `SUPABASE_SERVICE_ROLE_KEY is not set` | no `backend/.env.local` | Copy the key from Vercel's project env vars into `backend/.env.local` |
| `Draft "<id>" has not been approved` | campaign isn't `approved` yet | Approve it in the Approvals screen, then rerun |
| `No campaign_assets row found with id "<id>"` | wrong/mistyped draft id | Double-check the id from the Approvals API/app |
| `has asset_type "post", not "video_script"` | you gave it a text post's id | Only `video_script` assets (video opportunities) can render |
| `no structured videoScript in content_versions.metadata` | draft predates this feature | Re-run the campaign for its opportunity to regenerate |
| `edge-tts failed` / `ffmpeg render failed` | the underlying tool errored | The full stderr is included in the message — usually a bad voice name or a corrupted intermediate file; delete the draft's output directory and rerun |
| `Validation FAILED` | rendered file didn't pass the ffprobe checks | Check which specific checks failed in the printed list; usually indicates a genuinely broken render, not a false alarm |

## How to rerender

Just run the same command again — `npm run video:render -- <draft-id>`
overwrites that draft's entire output directory from scratch. There's no
separate "clean" step needed.

## Windows quickstart

```bash
# one-time setup
winget install Gyan.FFmpeg
winget install astral-sh.uv
cd backend
npm install

# put SUPABASE_SERVICE_ROLE_KEY in backend/.env.local (same value as in Vercel)

# render an approved draft
npm run video:render -- <draft-id>

# preview
start output\video-factory\<draft-id>\final.mp4
```

Uploading the finished MP4 to TikTok is, and remains, a manual step you
do yourself in the TikTok app — nothing in this repository ever touches
TikTok's upload/publish API.

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

## CLI architecture

`backend/scripts/video-factory/`:

| File | Responsibility |
|---|---|
| `index.ts` | CLI entry point -- arg parsing, orchestration, the operator-facing summary |
| `loadApprovedScript.ts` | Fetches/validates the production package (Supabase or `--input` JSON) and enforces the approval gate |
| `voiceover.ts` | Runs `edge-tts`, measures real narration duration via `ffprobe` |
| `captions.ts` | Parses `edge-tts`'s real per-sentence `.srt` timing, splits oversized sentences deterministically, builds the final `.ass` file |
| `scenes.ts` | Classifies each approved shot-list entry (hook/product/metric/cta/explanation) and builds a deterministic branded background + on-screen-label plan |
| `render.ts` | Builds the exact `ffmpeg` argv and runs it |
| `validate.ts` | Runs and interprets `ffprobe` on the finished output |
| `processRunner.ts` | Thin, mockable `child_process` wrapper every other module uses instead of shelling out directly |
| `types.ts` | Shared types |

Preserved verbatim from the known-good local pipeline
(`~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md`): the `en-US-
AndrewNeural` voice, 1080x1920 output, the `.ass`-not-`drawtext`/raw-`.srt`
caption approach (both hit real bugs previously -- a segfault and a
libass clipping bug), `PlayResX`/`PlayResY` matching the render
resolution, `Alignment=5`, and the libx264/aac/`-shortest` composite
settings. Extended, not replaced: scene backgrounds are new (Day 1's
video used one flat background for the whole clip), and captions now
use `edge-tts`'s own real per-sentence timing rather than being
hand-timed against the `.srt` by a human.

## Known limitations

- **Scene timing is an even split**, not aligned to specific sentences.
  The approved shot list isn't time-coded against the script, so mapping
  a specific shot to a specific spoken sentence would be a guess dressed
  up as precision. An even split across the shot list's count is the
  honest, documented choice instead. Caption timing itself, by contrast,
  IS real (`edge-tts`'s own per-sentence `.srt` output) -- only the
  background-scene cut points are approximated.
- **No real product screenshots.** "Product" scenes get a distinctly
  tinted background + a "FILLBOOK" label, not an actual app screenshot --
  deliberately out of scope for this phase (see the original spec: "This
  does NOT need an AI image generator in this phase"). If a real
  screenshot asset is ever supplied, wiring it in as a background image
  input (instead of a solid `color` source) is a natural, bounded
  extension of `render.ts`.
- **One voice, one visual style.** No per-draft customization beyond
  `--voice` yet -- not needed at current volume, easy to extend if it
  becomes worth it.
