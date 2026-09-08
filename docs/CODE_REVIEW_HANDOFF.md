# Fillbook Growth OS — code review handoff

Paste this whole document into the other AI as context, then attach/paste
the specific files it asks to see (the repo is private — it can't fetch
files on its own). Ask it to review for bugs, UI issues, dead code, and
architectural improvements, and to point out specific file:line findings
rather than generic advice.

## What this app is

An automated marketing/prospecting pipeline for Fillbook (a futures/
prop-firm trading-journal product). A Vercel/TypeScript serverless
backend + a Kotlin/Jetpack Compose Android client ("the operator
console"). It discovers relevant conversations on X, drafts replies with
Claude, and requires a human to actually post everything — nothing
auto-publishes anywhere.

## Tech stack

- **Backend:** TypeScript, Vercel serverless functions (`backend/api/*.ts`),
  Supabase/Postgres, Vitest for tests.
- **Android:** Kotlin, Jetpack Compose, single-activity, screens under
  `android/app/src/main/java/com/fillbook/growthos/ui/screens/`.
- **External APIs:** X (pay-per-read), Anthropic Claude (content drafting +
  9-agent review pipeline), Google Search Console. (Reddit was integrated
  2026-09-04 and removed 2026-09-06 — Reddit closed self-service app
  registration and no credentials were ever obtained.)
- **Scheduling:** Vercel Cron (Hobby plan — capped at 2 jobs/once-daily
  each) for the once/day pipeline, plus a free GitHub Actions workflow
  (`.github/workflows/growth-pulse.yml`) for a 3x/day X pulse, since
  Hobby can't schedule more than once/day itself.

## Directory map

```
backend/api/            -- one file per Vercel serverless endpoint (routes)
backend/src/attribution/   -- UTM link-tagging
backend/src/config/        -- scheduleConfig.ts: timezone + run-time source of truth
backend/src/content/       -- LLM client, draft writer, 9 review-agent personas
backend/src/cost/          -- cost_events tracking, budget gates, retention
backend/src/creators/      -- creator/influencer tracking
backend/src/db/migrations/ -- additive SQL migrations
backend/src/experiments/   -- A/B test engine (new, no LLM calls)
backend/src/firewall/      -- (check this one -- least-documented area)
backend/src/inbound/       -- X inbound mentions/replies tracking
backend/src/jobs/          -- background job helpers
backend/src/knowledge/     -- verified-fact grounding for content claims
backend/src/notifications/ -- in-app notification engine (new, no LLM calls)
backend/src/opportunities/ -- opportunity generation, auto-draft step
backend/src/prospecting/   -- X discovery: topics, scoring, eligibility/budget gates
backend/src/signals/       -- per-platform ingestion adapters (X, YouTube[unused], TikTok[unused], Search Console)
backend/src/strategy/      -- weekly strategy-evolution reports (new, no LLM calls)

android/.../data/    -- GrowthOsRepository (interface + fake), Models.kt (all DTOs), NetworkGrowthOsRepository (real API client)
android/.../ui/screens/ -- one file per screen (Home, Prospecting, Inbound, Approvals, Radar, Creators, Campaigns, Settings, System, Notifications, MorningBrief, EveningReport, Experiments, Strategy)
```

## Recent changes worth knowing about (as of 2026-09-06)

1. Merged two branches (2026-09-04): one added X 3x/day scheduling +
   Reddit prospecting/inbound + a bugfix where Home's "Today's spend"
   tile was reading a lifetime-all-providers sum instead of today's
   actual spend. The other independently added Notifications, Morning
   Brief, Evening Report, Experiments, Strategy Evolution, and swapped a
   typed access code for biometric/PIN unlock.
2. Reddit removed outright (2026-09-06): Reddit closed self-service app
   registration and no credentials were ever obtained, so the integration
   never went live. All Reddit-specific adapters, ingestion/discovery
   modules, health checks, schedule config, workflow steps, env vars, and
   Android copy/fixtures were deleted; Prospecting and Inbound are X-only.
3. YouTube and TikTok signal ingestion were deliberately removed from
   the scheduled pipeline (owner distributes video content through a
   separate tool called Fliki). Following the first external review, the
   dead manual-only path in `backend/api/ingest.ts` and the underlying
   YouTube/TikTok adapters, ingestion modules, token store, health
   checks, and tests were removed outright; `ingest.ts` now accepts only
   `x` and `search_console`. The `youtube_video`/`tiktok_video` signal
   source values remain valid for historical rows.
4. Just fixed one UI bug found live on-device: `ProspectingScreen.kt`'s
   action-button row had 4 `TextButton`s sharing equal width with
   `maxLines = 1` and no overflow handling — "Not relevant" got clipped
   to "Not" on a real phone. Fixed by shortening the label and adding
   `TextOverflow.Ellipsis`. **This class of bug (fixed-width Compose Row
   with real device testing revealing truncation) is exactly the kind of
   thing worth asking the other AI to hunt for elsewhere** — check every
   screen's button rows/multi-column layouts for the same risk.

## Known limitations (already documented, not bugs)

- TikTok: promote/posting is account-blocked; organic staging only.
- No lint script configured in `backend/package.json`.
- Vercel Hobby plan: 12-serverless-function cap, 2-cron-job cap — several
  design decisions (consolidating multiple ingestion sources into one
  endpoint, using GitHub Actions instead of a second cron) exist purely
  because of this constraint, not by choice.

## What to ask the other AI to focus on

1. **UI truncation/overflow bugs** like the one just found — any Compose
   `Row`/`Column` with fixed-width children and text that could overflow
   on a real device, especially anything with `maxLines` set without
   `overflow = TextOverflow.Ellipsis`.
2. **Dead code** — `backend/api/ingest.ts`'s YouTube/TikTok path and the
   underlying adapters have now been deleted (see Recent changes above);
   anything else that is reachable only by hand and never exercised is
   still worth flagging.
3. **Error handling gaps** — places where a failed API call might surface
   a confusing state to the user rather than a clear error/retry.
4. **Test coverage gaps** — especially around the newly merged features
   (Experiments statistical logic, Strategy Evolution, Notifications).
5. **Architecture/consistency** — anywhere the same pattern is implemented
   differently across X vs. YouTube-era code, now that X is the only live
   source.

Ask for specific `file:line` citations for every finding, not general
advice — this codebase has a lot of deliberate, documented design
decisions (see doc-comments throughout), so a finding that contradicts an
existing comment's stated reasoning should say so explicitly rather than
silently recommending the opposite.
