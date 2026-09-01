# Fillbook Growth OS — Progress Ledger

Update this file at every phase boundary: status, tests, blockers, commits,
next phase. This is how work resumes safely across sessions.

---

## Phase 0 — Audit & Architecture

**Status: substantially complete.**

- Audited existing work before building anything: discovered the real
  FillbookHQ product repo at `C:\Users\Justin\fillbookhq`
  (GitHub `Justncredible223/fillbook`), and its existing manual growth
  practice (`docs/social/*`, `docs/CLAUDE_HANDOFF.md`, `docs/GROWTH_FUNNEL.md`,
  `docs/SEO_FINAL_HANDOFF.md`). See `docs/SEED_DATA_SOURCES.md` for the
  full synthesis.
- Confirmed `frontend/android` / `frontend/ios` in fillbookhq is an
  unrelated, untracked Capacitor experiment on the consumer app — not
  reused here.
- Decided build sequencing: right-sized core spine first (this matches
  FillbookHQ's actual current stage — 3 real signups, 1 paying customer,
  Vercel Hobby, small Supabase — rather than building all 30+ subsystems
  from the master spec before any of them are proven). See
  `docs/ARCHITECTURE.md`.
- Decided: seed Brand Constitution / Platform Capability Registry /
  Knowledge Brain from FillbookHQ's real docs, not from scratch.
- Created this repo (`C:\Users\Justin\fillbook-growth-os`), independent git
  history, independent of both `revecta` and `fillbookhq`.
- Verified local tooling: Android SDK present (`platform-tools`,
  `build-tools`, `emulator`, `system-images` under
  `%LOCALAPPDATA%\Android\Sdk`); `adb`/`java` not yet confirmed on PATH —
  recheck when Phase 7 (Android) starts.

**Tests:** none yet (no code before firewall, below).

**Commits:** none yet — first commit pending end of Phase 1.

## Phase 1 — Data Foundation

**Status: complete.**

Done:
- `backend/src/db/migrations/0001_core_schema.sql` — core schema covering
  platform_capabilities, brand_rules, knowledge_documents, signals,
  opportunities, campaigns, campaign_assets, content_versions,
  content_scores, content_sources, approvals, audit_logs, system_jobs,
  dead_letter_jobs, integration_health. Later-phase-only tables
  (creators, outreach_drafts, seo_queries, seo_pages, strategy_versions,
  growth_genome, cost_events, notifications, product_signals, website_events,
  attribution, conversions, experiments, research_projects, research_results,
  platform_accounts, platform_metrics, publications_or_handoffs) are
  deliberately deferred to the phases that use them, not created empty now.
- ExternalWriteFirewall implemented and tested **first**, ahead of schedule,
  because it's the load-bearing safety component everything else depends on:
  `backend/src/firewall/externalWriteFirewall.ts` +
  `backend/test/firewall.test.ts`. **8/8 tests passing** (`npx vitest run`).
- Backend scaffold: `package.json`, `tsconfig.json`, vitest installed.
- **Dedicated Supabase project provisioned and live**, fully isolated from
  FillbookHQ's production DB (`Edgelog`) and from Revecta (`revecta-dev` /
  `revecta-production`): new free-tier Supabase account/org
  ("Fillbook Growth OS", org id `rxebtuxpayscagrzvaak`), project
  `fillbook-growth-os` (ref `aijnibayogdygtykidta`, us-east-1,
  `https://aijnibayogdygtykidta.supabase.co`), **$0/month**. Resolved after
  discovering the originally-connected Supabase org was free (not Pro as
  believed) and capped at 2 active projects by `Edgelog` + `revecta-dev`;
  chose a brand-new free account over paying $10/mo under Revecta's Pro org
  or disturbing Revecta's production backup/PITR setup, since this app is
  personal-use only.
- Both migrations applied and verified: `core_schema` and
  `seed_brand_and_platform_data` (10 brand_rules rows, 6
  platform_capabilities rows, seeded from `docs/SEED_DATA_SOURCES.md`).
- `backend/.env.example` added with the real project URL (not secrets).

**Side-finding, resolved:** investigated whether the free org's inactive
`Justncredible223's Project` (ca-central-1) was safe to delete per owner
request — confirmed unused (no reference in fillbookhq, fillbook, revecta,
or fillbook-growth-os; no GitHub Actions; no .env file) beyond a prior
audit note in `revecta/docs/launch/supabase-verification.md` already
calling it unrelated. No delete tool is exposed via the connected Supabase
MCP server, so owner would need to delete it manually via the dashboard if
still wanted — not blocking, not pursued further since it doesn't affect
Growth OS either way.

## Phase 2 — Job Infrastructure
**Status: complete.** `backend/src/jobs/*` — Postgres claim/complete/fail
functions (migration 0003), pure backoff/dead-letter decision logic,
JobQueue orchestrator, in-memory + Supabase repositories. Tests: 18/18
(cumulative suite: see below).

## Phase 3 — Knowledge Brain & Brand Constitution
**Status: complete.** `backend/src/knowledge/*` — knowledge_documents
seeded with real, cited FillbookHQ facts (migration 0004);
`KnowledgeBrain.requireVerifiedKnowledge()` throws for any unverified
topic (the anti-fabrication guarantee); `BrandConstitution` loads active
versioned rules + mechanical vocabulary/claim backstop check.

## Phase 4 — Signal Graph
**Status: core complete, real ingestion adapters blocked on OAuth apps
only the owner can create.** `backend/src/signals/*` — ingest, dedup,
72h topic clustering, 24h velocity computation, in-memory + Supabase
repositories. Fully tested.

**BLOCKER (does not block anything else):** real signal sources (Search
Console, YouTube Analytics, X mentions) each require an OAuth app the
owner must personally create — this is account/developer-portal setup,
not something achievable via API alone:
- **Google Search Console + YouTube Analytics**: create a project in
  Google Cloud Console, configure the OAuth consent screen, create OAuth
  2.0 credentials, enable the Search Console API and YouTube Data API v3.
- **X**: apply for a developer account at developer.x.com, create a
  Project + App, generate API keys/tokens with the scopes needed for
  reading mentions/analytics.
**WHAT'S READY:** `SignalGraph.ingest()` accepts any `source` string and
works identically regardless of where evidence comes from — the moment
credentials exist, an adapter that calls the real API and pipes results
through `ingest()` is a small, self-contained addition, not a redesign.

## Phase 5 — Opportunity Engine
**Status: complete.** `backend/src/opportunities/*` — pure `scoreOpportunity()`
scoring function (audience/Fillbook relevance, velocity, evidence
confidence, topic-fatigue penalty, duplicate-coverage penalty, urgency
classification), `OpportunityEngine` orchestrator, in-memory + Supabase
repositories. Fully tested, including score bounds (never <0 or >100).

## Phase 6 — Campaign Factory & Content Quality
**Status: core complete, deep LLM review agents blocked on an AI provider
key.** `backend/src/content/*`:
- `AntiSlopEngine` — deterministic regex/heuristic detector (generic
  openers, AI-cliche phrases, fake urgency, excessive em dashes/rhetorical
  questions/hashtags/emoji). No AI call needed, always-on.
- `OriginalityEngine` — Jaccard token-overlap similarity against recent
  same-topic content. Lightweight stand-in for embedding-based semantic
  similarity (upgrade path noted in the module's own docstring once an AI
  provider key exists).
- `ContentQualityGate` — combines brand-vocabulary, anti-slop, and
  originality checks into one pass/fail gate.
- `CampaignFactory` — stage machine (idea -> ... -> final_draft ->
  ready_for_owner -> handed_off). `handOffToOwner()` is the **only** path
  to `handed_off`, has no `actionClass` parameter a caller could use to
  request EXTERNAL_WRITE, and always calls the firewall with
  `EXTERNAL_DRAFT`. Tested, including that it refuses to skip stages and
  that its audit trail always shows `EXTERNAL_DRAFT`/`drafted`.

**BLOCKER (does not block anything else):** the deeper judgment-based
review agents from the master spec (trader / hook_specialist / copy_editor
/ skeptic / brand_guardian / growth_strategist / fact_checker /
integrity_reviewer / conversion_reviewer) require calling an actual LLM.
This backend has no AI provider API key configured in this environment.
**OWNER ACTION (when ready):** add `ANTHROPIC_API_KEY` (or another
provider's key) to `backend/.env.local` for local dev and to the Vercel
project's encrypted environment variables for production — never commit
it. Once present, these agents are additive: they consume the same
`content_versions`/`content_scores` schema already in place and don't
require changing anything already built.

**Cumulative test status after Phase 6: 57/57 passing, typecheck clean.**

## Phase 7 — Android Mission Control
**Status: core complete (3 of 12 spec screens), real verified build, no
visual/emulator QA.** `android/` — Kotlin + Jetpack Compose, native.
Dark-first design system (custom color/type tokens, not a generic Material
demo). Home, Radar, Approvals screens against a `GrowthOsRepository`
interface; `FakeGrowthOsRepository` seeded with real FillbookHQ content
(not lorem-ipsum placeholders) pending backend deployment. The Approvals
screen has exactly two button labels anywhere on it — "Approve internally"
and "Open in `<platform>`" — no publish/post/send action exists in this
app's code at all.

`./gradlew :app:assembleDebug` verified **BUILD SUCCESSFUL**, produces a
real 16MB `app-debug.apk` at `android/app/build/outputs/apk/debug/`.
Required using JDK 21 (`C:\Users\Justin\.jdks\jbr-21.0.11`) instead of the
machine's default JDK 25, which Gradle 8.14.3 doesn't yet support — fixed
via `JAVA_HOME` at build time, not a code change.

**Not done, and NOT claimed as done:**
- **No emulator/device visual QA.** No Android system image is installed
  on this machine, and no `cmdline-tools`/`sdkmanager` binary exists to
  fetch one from the command line — that requires either Android Studio's
  own SDK Manager GUI or a multi-GB unattended download plus hardware
  acceleration setup neither attempted nor verified safe to do headless.
  **OWNER ACTION (only if you want on-device visual QA before I can do
  it):** open Android Studio -> Tools -> SDK Manager -> SDK Tools -> check
  "Android SDK Command-line Tools" -> Apply, OR just `adb install
  android/app/build/outputs/apk/debug/app-debug.apk` to a physical device
  with USB debugging on. Once either exists, I can drive it directly.
- Only Home/Radar/Approvals exist; Campaigns/Analytics/Content
  Library/Research/Creators/Strategy/System/Settings screens are not
  built (right-sized sequencing, not an oversight — see
  `docs/ARCHITECTURE.md`).
- No release (signed) build, no AAB — only unsigned debug APK. Release
  signing requires a keystore, which per this build's own security
  posture should be generated and held by the owner, not autonomously
  created and stored in the repo.

## Phase 8+ (SEO/X/YouTube/TikTok/Video Factory/Attention Radar/Creator
CRM/Research Lab/Attribution/Experiments/Growth Genome/Strategy
Evolution/full Android polish/release engineering)
**Not started.** Each external-platform phase (X=9, YouTube=11,
TikTok=12, Search Console=8) shares the Phase 4 OAuth-app blocker: the
owner must create the developer app/OAuth client before any adapter code
can be exercised against the real API, even though the adapter code
itself is a small addition once that exists. Video Factory (10) has no
technical blocker but wasn't reached this session. Full Android polish
(21) and release engineering (22) depend on Phase 7's remaining screens
existing first. Deliberately not stub-built with placeholder screens or
fabricated "done" status — see `docs/ARCHITECTURE.md`'s definition-of-done
discussion.

## Repository & deployment state (updated -- backend and Android now both live)

- **No GitHub remote exists yet** for this repo — created and committed
  locally only. No `gh` CLI and no GitHub MCP/API tool was available in
  this session to create one autonomously.
  **OWNER ACTION:** create an empty repo (e.g. `Justncredible223/fillbook-growth-os`)
  on GitHub, then from `C:\Users\Justin\fillbook-growth-os` run
  `git remote add origin <url>` and `git push -u origin master`.

- **Backend IS deployed and live**: `https://fillbook-growth-os.vercel.app`,
  Vercel project `fillbook-growth-os` (id `prj_EeqMUglf2bJy0VlaGjx83yHBsAQI`,
  team `justwilliams407-3300s-projects`). Deployed via direct file upload
  (`deploy_to_vercel`, no GitHub link yet -- reconnect this to GitHub once
  a remote exists, via Vercel's Git integration, so future pushes
  auto-deploy). Four endpoints live: `/api/health`, `/api/summary`,
  `/api/opportunities`, `/api/approvals` -- all real, querying the live
  Supabase project, no mocked data.
  - **Fixed a real bug found via this deployment**: the initial deploy used
    `"type": "module"` in `package.json`, which requires explicit `.js`
    extensions on every relative import under Node's ESM loader --
    without them, every function crashed with `ERR_MODULE_NOT_FOUND`
    (`FUNCTION_INVOCATION_FAILED`, ugly 500 page, no graceful error).
    Fixed by deploying with CommonJS (`module: "CommonJS"` in the deployed
    tsconfig, no `"type": "module"` in the deployed package.json) instead
    of chasing extensions on 20+ import statements. **Note:** the deployed
    package.json/tsconfig are NOT the same files as
    `backend/package.json`/`backend/tsconfig.json` in this repo (those stay
    ESM for local vitest, which works fine) -- if you add new backend
    files, remember the next deploy needs the CommonJS variant, not a
    straight copy of the local config. This is a real seam to clean up
    later (e.g. a `backend/deploy/` config), not fixed this session for
    time reasons.
  - **Vercel Authentication (Standard Protection) is ON** for this
    project, which blocks unauthenticated requests (including from the
    Android app) with a Vercel SSO redirect. Resolved via a **Protection
    Bypass for Automation** secret (Settings -> Deployment Protection),
    sent as the `x-vercel-protection-bypass` header. This is a different,
    lower-sensitivity token than the Supabase `service_role` key -- it's
    designed by Vercel specifically to be embedded in automation/clients,
    unlike the Supabase key which must never leave the server. The Android
    app embeds this bypass token (see `NetworkGrowthOsRepository.kt`);
    it does NOT and must never embed the Supabase service_role key.
  - **RLS enabled with default-deny** on every table (migration 0005) --
    fixed a real gap from Phase 1 where tables were created with RLS off,
    meaning the anon key alone could've read/written everything via
    Supabase's REST API.
  - **`system_settings` table added** (migration 0006) for the Pause
    System, single row, RLS enabled.
  - **Still blocked on the owner**: `SUPABASE_SERVICE_ROLE_KEY` is not set
    in Vercel's environment variables. Until it is, `/api/health` correctly
    reports Supabase as `DOWN` with an explanatory message (verified live)
    rather than crashing -- this is the intended graceful-degradation
    behavior, not a bug. **OWNER ACTION:** Vercel dashboard -> this project
    -> Settings -> Environment Variables -> add `SUPABASE_SERVICE_ROLE_KEY`
    (value from Supabase dashboard -> Settings -> API -> service_role,
    NOT anon) -> redeploy (or it'll pick it up on the next deploy).

- **Android app now calls the real backend** instead of fake data
  (`NetworkGrowthOsRepository`, OkHttp-based). All three screens
  (Home/Radar/Approvals) have real error states (a red message, not a
  crash) if the network call fails -- verified this compiles and
  `assembleDebug` still succeeds. Not yet verified end-to-end against
  real (non-empty) data, since the tables are still empty and the service
  role key isn't set yet -- once both are true, this should Just Work
  without further code changes.

- **Supabase is live and real** (see Phase 1) -- fully wired end-to-end
  now: Supabase -> Vercel API -> Android app, all real, no mocks left in
  the request path except the absence of actual signal/opportunity/
  approval data (empty tables, not fake ones).

- **`SUPABASE_SERVICE_ROLE_KEY` is now set and verified working.** Getting
  here took three attempts, each a real bug, each fixed:
  1. First value was missing entirely (expected -- owner hadn't set it yet).
  2. Second value had a stray newline in the middle
     (`"sb_secret_YqeHP\nuEBZ7Ph..."`), breaking the HTTP header
     entirely -- also the wrong key *type* (Supabase's new `sb_secret_...`
     format from the default API Keys page, not the classic JWT
     `service_role` key this code expects). Fixed by using Supabase's
     "Legacy anon, service_role API keys" page instead and copying via the
     copy-icon button rather than manual text selection.
  3. Third attempt surfaced a real code bug once the key was finally being
     read: `errorMessage()` fix above (see latest commit).
  4. **Verified live and fully healthy** after redeploy:
     `{"health":[{"label":"Supabase","status":"HEALTHY",...},{"label":"Job queue","status":"HEALTHY",...}, ...]}`.
     `/api/opportunities` and `/api/summary` both confirmed returning real
     (empty, not fake) data with no errors.
  **The full chain is genuinely live end-to-end**: Supabase -> Vercel API
  -> ready for the Android app to consume real data the moment there's
  real data to show (tables are empty, not broken -- Signal Graph
  ingestion adapters are the next real blocker on that, per Phase 4).
