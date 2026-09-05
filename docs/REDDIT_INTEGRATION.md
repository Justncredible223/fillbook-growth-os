# Reddit Integration (prospecting + inbound)

Adds Reddit as a second discovery/engagement platform alongside X, reusing
the same tables, status lifecycle, and human-only-publish rule (see
`docs/PROSPECTING.md` / `docs/INBOUND_ENGAGEMENT.md`) rather than building
a parallel system. `prospecting_candidates` and `inbound_engagements` both
already had a free-text `platform` column (not an X-specific enum), so no
schema migration was needed -- Reddit rows are `platform='reddit'` in the
same tables X rows already use.

## What this is NOT

Same guarantees as X: read-only by construction. `RedditSignalAdapter` has
no method that posts, comments, votes, or messages -- `searchSubreddit()`
and `fetchInboxActivity()` are both GETs. `ExternalWriteFirewall` has no
`reddit.*` action registered as anything other than rejected by default
(the firewall's default-deny covers any action class not explicitly
allow-listed). Publishing stays human-controlled: copy the draft, open the
real Reddit permalink, reply yourself.

## Reddit's current API terms -- verified vs. assumed

**Verified (checked against third-party summaries of Reddit's Data API
terms during this session, 2026-09-04 -- re-verify against reddit.com's
own developer docs before relying on this long-term, since this session
had no way to load reddit.com's own policy pages directly):**

- Reddit's free tier for personal/non-commercial use is still available in
  2026, rate-limited to **100 queries/minute per OAuth client**
  (10/minute unauthenticated -- moot here since every endpoint used
  requires OAuth regardless).
- As of Reddit's **"Responsible Builder Policy"** (closed self-service app
  registration in late 2025), **every new OAuth client -- free or paid --
  now requires manual approval via Reddit's own Data API request form**
  before it can call the API at all. Reported review timelines are
  **2-4 weeks** for a first response.
- Commercial use requires a separate paid agreement (~$0.24/1,000 calls,
  a five-figure/month minimum commitment) -- **not applicable here**: this
  integration's read volume (a handful of subreddit searches once/day,
  one inbox poll a few times/day) is squarely personal/non-commercial use,
  and no code in this repo requests or assumes paid-tier access. Do not
  commit to a paid Reddit plan without Justin's own explicit approval --
  this document exists specifically so nobody accidentally treats "just
  register an app" as still self-service.
- A **"script" app** (Reddit's app type for a single developer/account
  automating their own account) is the correct app type for this use
  case, authorized once via a standard OAuth consent flow as
  `@fillbookhq`'s own Reddit account.

**Assumptions this session could not independently verify (flagged, not
silently treated as fact):**

- The exact current wording/scope of the approval-ticket categories
  (developer/researcher/moderator) and whether a personal single-account
  bot like this one cleanly fits one of them, or needs a different
  justification in the request form.
- Whether Reddit's refresh-token behavior for a script app's
  authorization-code grant rotates the refresh token on every use (X does
  not; TikTok does -- `redditAdapter.ts`'s refresh code defensively
  handles either case, matching the codebase's existing X/TikTok pattern,
  but this hasn't been exercised against Reddit's real token endpoint
  yet).
- Real day-to-day inbox-listing behavior/pagination quirks at low volume
  (this account's actual future inbox), since no live credentials existed
  to test against during this session.

## Required manual setup (Justin, not automatable)

1. **Submit Reddit's Data API access request** (search "Reddit Data API
   request form" from Reddit's own developer/help pages -- this session
   could not create the request on Justin's behalf; it requires his own
   Reddit login). Budget 2-4 weeks for a first response before Reddit
   inbound/prospecting can go live. Category: personal/non-commercial
   bot automating `@fillbookhq`'s own account -- read-only discovery and
   inbox monitoring, no posting/voting/following.
2. Once approved, create a **"script" type** Reddit app under
   `@fillbookhq`'s Reddit account (Reddit's Apps preferences page), noting
   the generated **client ID** and **client secret**.
3. Complete Reddit's OAuth **authorization-code** flow once, as
   `@fillbookhq`, requesting scopes: **`identity`**, **`read`**,
   **`history`** (no `submit`, `vote`, `edit`, `privatemessages` write
   scope, or any other write-capable scope -- narrowest permission set
   this integration needs: `identity` to resolve the account, `read` for
   subreddit search, `history`/inbox read for inbound monitoring).
4. Set the resulting `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` /
   `REDDIT_ACCESS_TOKEN` / `REDDIT_REFRESH_TOKEN` / `REDDIT_USER_AGENT` in
   Vercel's production environment variables (see `.env.example` for the
   exact format each needs, especially `REDDIT_USER_AGENT` -- Reddit
   throttles/blocks requests with a generic or missing User-Agent).
5. Add the `BACKEND_BASE_URL` and `CRON_SECRET` GitHub Actions repo
   secrets (Settings -> Secrets and variables -> Actions) so
   `.github/workflows/growth-pulse.yml` can actually call the deployed
   endpoint -- see that file's own comment for the exact values expected.

Until step 1-4 are done, `/api/health`'s "Reddit Inbound"/"Reddit
Prospecting" rows correctly show `NOT_CONNECTED` (never a fabricated
`HEALTHY`), and `createRedditSignalAdapter()` throws a clear, actionable
error naming exactly which env var is missing rather than failing with an
opaque error deep inside a fetch call.

## Data flow

- **Prospecting** (`backend/src/prospecting/redditProspectingSearch.ts`,
  1x/day): rotates through `REDDIT_TOPICS`
  (`redditTopics.ts` -- 5 subreddit/query pairs across
  `FuturesTrading`/`FundedTrading`/`Daytrading`/`algotrading`, same A/B/C
  reply-class framework as X's topic list), searching
  `REDDIT_TOPICS_PER_RUN` (2) of them per run via
  `RedditSignalAdapter.searchSubreddit()`. Results are scored with the
  SAME `scoreProspectingCandidate()` function X prospecting uses (a
  `RedditTopic` has the same key/query/label/replyClass shape scoring
  reads; Reddit's `score`/`num_comments` map onto the same "active
  discussion" inputs X's `public_metrics` does). New candidates
  (deduped on `(platform, externalId)` where `externalId` is Reddit's own
  stable "fullname", e.g. `t3_abc123`) are inserted into
  `prospecting_candidates` with `platform='reddit'`. Reddit's own smaller
  queue-capacity gate (`redditEligibility.ts`,
  `REDDIT_QUEUE_FULL_THRESHOLD=8`, twice the ~3-4/day target) is
  independent of X's `QUEUE_FULL_THRESHOLD` -- an X backlog never blocks
  Reddit discovery or vice versa (verified by
  `redditProspectingSearch.test.ts`'s "an X-platform backlog never counts
  toward Reddit's own queue threshold" case).
- **Inbound** (`backend/src/inbound/redditIngestion.ts`, 3x/day): reads
  `GET /message/inbox` (the one endpoint Reddit's API exposes for all
  inbound activity -- comment replies, username mentions, and private
  messages together, most-recent first) via
  `RedditSignalAdapter.fetchInboxActivity()`, using its own cursor
  (`reddit_inbound`, independent of X's `x_mention_inbound` cursor).
  `comment_reply` and `username_mention` items become
  `inbound_engagements` rows (`platform='reddit'`), classified with the
  SAME deterministic `classifyPriority()` X inbound uses. `private_message`
  items are counted as "not actionable" and skipped -- see Known
  limitations below.

## Thread/parent context

Reddit's `link_id` (the submission a comment thread lives under) becomes
`conversationId`, matching X's `conversation_id` role -- a second reply in
the same thread is recognized as the same conversation. `parent_id`
becomes `inReplyToExternalId`, matching X's "replied_to" referenced-tweet
id. Both are exercised by `redditIngestion.test.ts`'s thread-context and
"reopens as a new row after a responded thread" cases.

## Known limitations

- **Private messages are not surfaced as actionable inbound items.** A DM
  has no public permalink/context the "copy draft, open the exact
  conversation" workflow can point at the way a public comment reply
  does. Counted in `notActionable`, never silently dropped -- but genuinely
  not turned into a public-conversation row. If DMs ever matter for this
  account, that would need its own, different UI/workflow (a real private
  inbox view), not a `platform='reddit'` row that looks like a public
  Radar item.
- **`inResponseToText` is not populated**, same limitation as X inbound --
  would need a second API call per item to fetch the parent
  comment/post's own text.
- **Never verified against Reddit's real API.** No credentials existed
  during this session (Reddit's approval-ticket requirement means none
  could be obtained in-session even in principle -- see "Required manual
  setup" above). All adapter/ingestion/scoring code is unit-tested against
  mocked HTTP responses shaped to match Reddit's documented response
  format, matching this project's own "code-complete, credentials
  pending" posture already used for TikTok (`docs/PROGRESS_LEDGER.md`
  Phase 12) -- not claimed as live-verified.
- **Android has no Reddit-specific UI yet.** `InboundScreen.kt`/
  `ProspectingScreen.kt` read generic `platform` fields from the same
  `/api/approvals` endpoints X already uses, so a Reddit row should render
  through the existing screens without a crash (same data shape), but
  this was not visually verified against a real Reddit row in the
  emulator this session (no real Reddit data exists yet to render). Any
  platform-specific icon/label polish (e.g. a Reddit icon distinct from
  X's) is a follow-up, not done this pass.

## Cost

Reddit's free tier has no documented per-call dollar cost (see "Reddit's
current API terms" above) -- `recordRedditReadCostEvent()` still logs a
`$0` `cost_events` row per search call, purely for the same per-source
run-count observability every other adapter gets (`/api/health`, System
screen), not a budget gate. If Reddit's terms ever change to a metered
rate for this account's volume, that's the one place a real per-read cost
would be plugged in.
