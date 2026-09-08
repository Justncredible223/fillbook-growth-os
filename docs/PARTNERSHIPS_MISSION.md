# Partnerships Mission -- Durable Requirements & Checklist

Status: QUEUED. Not started. Saved 2026-09-05 per explicit user instruction:
"Queue this mission and begin at its next safe checkpoint. Preserve its work
and existing release restrictions." The current mission in progress at the
time this was queued is the Today's X Post release-readiness follow-up
(see docs/PROGRESS_LEDGER.md and this session's own work on
`backend/src/content/dailyXFeedPost.ts` and related files). Do not start
Partnerships until that mission reaches a clean, documented checkpoint, and
do not edit files that mission still owns while it's in flight.

## Full mission text (verbatim, as given by the user)

> Implement a practical Partnerships workflow inside Fillbook Growth OS.
>
> This is an implementation request. Inspect the existing app, build on its
> architecture, test the workflow, and deliver a reviewable result. Do not
> stop at a proposal or scaffold.
>
> If another task is running, queue this mission and begin at its next safe
> checkpoint. Preserve its work and existing release restrictions.
>
> ### Objective
> Help the owner find and qualify potential Fillbook partners, approve
> personalized outreach, manage follow-ups, run small pilots, and track
> outcomes.
>
> Initial priority order:
> 1. Futures trading educators and coaches.
> 2. Futures creators and community owners.
> 3. Prop firms.
> 4. Trading platforms and brokers.
>
> Positioning constraint: Fillbook helps futures traders review sessions,
> understand recurring mistakes, and keep account rules visible. Do NOT
> promise profitability, prevented account failures, or capabilities that
> are not verified.
>
> ### Phase 1 -- Reconcile existing capabilities
> Read repository instructions, handoff documents, growth policies, and
> current implementation. Inspect existing: Radar/discovery and prospect
> storage; outreach/inbound tracking; draft generation and review gates;
> approvals and sending capabilities; scheduled jobs, notifications, and
> budgets; referral attribution and reporting, if any. Extend existing
> systems where appropriate -- do NOT create a competing outreach pipeline,
> duplicate contacts, or replace existing policies. Record a durable
> requirement checklist with implementation, automated-test,
> browser/device-verification, and deployment status kept SEPARATE (see
> checklist below, to be filled in as work proceeds).
>
> ### Phase 2 -- Partnership pipeline
> Add a mobile-friendly Partnerships section using existing navigation and
> design patterns.
>
> Stages: Prospect -> Qualified -> Draft ready -> Contacted -> Replied ->
> Pilot -> Active partner -> Closed. Also support Archived and Do not
> contact.
>
> Each prospect should support: person/organization and partner category;
> website/social links; public business contact route and its source;
> audience focus and evidence of futures relevance; source URLs and
> research date; known competing journal relationships, with evidence;
> proposed collaboration and qualification rationale; owner notes,
> interaction history, next action, and due date; agreed pilot/offer terms
> when applicable.
>
> Unknown information must remain unknown -- do NOT invent emails, audience
> counts, contacts, affiliations, or engagement statistics.
>
> Deduplicate across existing outreach and Partnerships using normalized
> identifiers. Honor existing suppression and do-not-contact records.
>
> ### Phase 3 -- Discovery and qualification
> Provide manual prospect entry immediately. Reuse available, authorized
> research integrations for discovery; if none exist, support
> owner-supplied URLs and clearly explain the unavailable capability -- do
> NOT present generated names as researched prospects.
>
> Qualify prospects using explainable evidence: futures audience relevance;
> recency and substance of activity; fit with journaling, risk management,
> and session review; a realistic contact route; existing journal
> relationships or conflicts; a concrete benefit for both parties. Separate
> fit from evidence confidence. Follower count alone must not determine
> priority.
>
> If authorized research access and an existing budget permit, prepare up
> to 10 sourced candidates as an initial review queue. Otherwise complete
> the feature and report the precise discovery dependency.
>
> ### Phase 4 -- Personalized pitches and approvals
> Generate editable drafts containing: a specific, sourced reason for
> contacting this prospect; a clear benefit to their audience; one concrete
> collaboration proposal; a simple next step.
>
> Offer types: guided journaling pilot for a small trader cohort;
> educational session or product walkthrough; creator demonstration;
> referral partnership; member-access or integration discussion.
>
> Treat discounts, free access, commissions, exclusivity, and other
> commercial terms as PROPOSALS requiring owner approval -- do NOT assume a
> 30% commission or promise features.
>
> Reuse existing quality/review gates, adapting content-type rules
> explicitly where needed. Never silently weaken shared gates.
>
> Draft generation does NOT authorize sending. Do NOT send email, DMs,
> social messages, or contact-form submissions during this mission.
>
> If the app has no approved delivery integration, implement copy/export
> plus an explicit "Mark contacted" action. Draft approval alone must never
> mark a prospect as contacted.
>
> Record actual contact channel/date and the approved message version.
> Material edits invalidate any prior send approval.
>
> ### Phase 5 -- Follow-ups and daily workflow
> Add a concise daily view: prospects ready to review; drafts awaiting
> approval; follow-ups due; replies requiring attention; active pilots and
> next actions.
>
> Follow-up timing must start from recorded contact, not draft creation.
> Use a configurable, bounded sequence; default to no more than two
> follow-up drafts. Stop on reply, decline, do-not-contact, or owner
> closure.
>
> Use existing notifications if available; otherwise make due actions
> visible in-app without introducing an unnecessary notification service.
>
> Keep discovery and drafting bounded, deduplicated, and safe to retry.
> Re-running a job must not create duplicate prospects, drafts,
> interactions, or follow-ups.
>
> ### Phase 6 -- Pilots and outcomes
> Track: proposed versus agreed terms; pilot start/end dates; onboarding
> status; partner feedback and next action; referral link/code where
> genuinely supported; signups, activation, paid conversions, retention,
> and referral costs where reliable attribution exists.
>
> Clearly distinguish: measured outcomes; manually entered outcomes;
> unavailable data. Never display missing attribution as zero, claim
> causation from referrals, or imply payout/account-protection improvements
> without evidence.
>
> Do NOT build commission payouts or a full affiliate platform in this
> mission -- record agreed terms and costs only.
>
> ### Phase 7 -- Budgets and data access
> Give Partnerships its OWN usage accounting and queue so it cannot consume
> the existing daily X-post allocation or block content generation. Account
> for research/provider costs and model generation/review costs, including
> Anthropic if used.
>
> Do NOT invent or activate a new spending allowance. Reuse an explicitly
> authorized partnership allowance if one exists; otherwise keep paid
> automated discovery/generation disabled, deliver manual functionality,
> and provide a concrete cost estimate for approval.
>
> Preserve existing tenant/owner isolation and secret handling. Do not
> expose partner notes, contact data, or credentials in public views or
> logs.
>
> ### Phase 8 -- Verification
> Test meaningful behavior: prospect deduplication across outreach
> systems; source evidence and unknown-data handling; allowed stage
> transitions; approval versus actual contact; follow-up scheduling,
> limits, and stop conditions; job retries and duplicate prevention;
> budget exhaustion without affecting content jobs; data access
> boundaries; truthful attribution and manual-entry labeling.
>
> Verify the real interface at phone and desktop sizes, including loading,
> empty, error, and populated states.
>
> Demonstrate end to end: create prospect -> qualify with sources -> draft
> -> edit/approve -> copy/export -> explicitly record contact -> follow-up
> due -> record reply -> start pilot -> record outcome.
>
> Use synthetic fixtures for verification. Do NOT contact real prospects.
>
> Run applicable typecheck, lint, tests, and build checks. Identify actual
> tooling blockers precisely and continue independent work.
>
> ### Delivery
> Complete the implementation in an appropriate isolated branch/worktree
> without conflicting edits.
>
> Preserve current restrictions on pushes, deployments, production
> migrations, configuration changes, and external messages. Prepare
> required migrations and release instructions locally; seek any required
> approval only once the exact action is concrete and reviewable.
>
> Final report must cover: (1) what works end to end; (2) existing
> components reused; (3) commits and changed areas; (4) tests and
> browser/device evidence; (5) implemented versus mocked, blocked, or
> deployment-pending capabilities; (6) budget behavior and any proposed
> paid allowance; (7) exact remaining owner actions.
>
> Keep the first version focused on helping the owner secure and manage
> their first two partner pilots. Finish that workflow before adding
> broader CRM features.

## Addendum (added 2026-09-05, same queue, before work started): match the existing X-workflow's ease of use

Verbatim requirement from the user, sent as a follow-up while this mission
was still queued:

> Inspect how Growth OS currently presents ready-to-use X drafts and reuse
> that interaction pattern for Partnerships.
>
> Desired experience:
> 1. A qualified prospect appears with a personalized draft already
>    prepared, when authorized research/model budgets permit.
> 2. The card shows who they are, why they fit, the proposed message, and
>    the intended contact channel.
> 3. One primary action lets me act on the exact displayed message without
>    navigating through several screens.
> 4. Editing, dismissing, and viewing research remain secondary actions.
>
> Make the primary action truthful to the channel's actual capabilities:
> - If an existing authorized integration supports sending, offer "Approve
>   & send." My tap authorizes only that displayed message to that
>   recipient.
> - Otherwise offer "Copy & open [channel]" where technically supported.
>   Open the verified contact destination and make the message easy to
>   paste.
> - For unsupported destinations, provide a clear copy action and contact
>   link.
>
> Never label copying/opening as "Sent." Require explicit "Mark contacted"
> confirmation when delivery cannot be verified. Start follow-up timing
> only after confirmed sending or recorded contact.
>
> Prevent duplicate sends on repeated taps or retries. Show pending,
> success, and failure clearly; do not automatically retry a send whose
> delivery status is uncertain.
>
> Prepare due follow-up drafts through the same review/action experience,
> respecting reply and do-not-contact stop conditions.
>
> No autonomous outreach. No real prospect messages during
> implementation/testing. New integrations, permissions, or spending must
> follow existing approval rules.
>
> Acceptance criterion: from a ready prospect card, I can review and
> either send through a supported integration with one deliberate tap, or
> copy/open the destination with one tap and complete delivery there.
> Clearly report which channels support each behavior.

Implementation note for whoever picks this up: the existing pattern to
reuse is Home's `TodayXPostCard` + its review `AlertDialog` in
`android/app/src/main/java/com/fillbook/growthos/ui/screens/HomeScreen.kt`
(edit-before-copy via an `OutlinedTextField`, a single primary "Copy + Open
X" action, a separate later "Mark posted" confirmation, `openExternalUrl`
for the crash-safe external-app launch) -- Partnerships' prospect card and
its primary action should follow the same shape: one primary action whose
label is truthful to the channel (X has `openExternalUrl` today; email/DM
"send" capability does not exist in this codebase as of this writing --
confirm that during Phase 1 reconciliation rather than assuming either
way), with edit/dismiss/view-research as secondary actions, and a distinct
later "Mark contacted" step, never inferred from copy/open.

## Standing constraints carried over from the rest of this project (apply here too)

- Do not deploy, apply production migrations, raise/invent spending
  budgets, or send any real outreach message during this mission.
- Do not use the Edgelog or Revecta Supabase projects -- Fillbook Growth
  OS's actual project is ref `aijnibayogdygtykidta` (org "Fillbook Growth
  OS", org id `rxebtuxpayscagrzvaak`), confirmed via
  `backend/src/lib/supabaseClient.ts:8` and `backend/.env.example` --
  see docs/PROGRESS_LEDGER.md. As of this writing no MCP-connected
  Supabase project matches; that access gap is a standing blocker to
  report, not to work around by guessing at another project.
- Report honestly when live model execution isn't available locally
  (no `ANTHROPIC_API_KEY` in `backend/.env.local` as of this writing) --
  never claim live-quality verification that didn't actually run.

## Requirement checklist (fill in as work proceeds -- keep these four statuses separate per the mission's own instruction)

Legend: [ ] not started, [~] in progress, [x] done, [B] blocked (state the blocker inline).

### Phase 1 -- Reconciliation
- [ ] Read docs/PROGRESS_LEDGER.md, HANDOFF docs, growth policy docs, master spec
- [ ] Inventory existing Radar/discovery + prospect storage (opportunities, signals, prospecting tables)
- [ ] Inventory existing outreach/inbound tracking (inbound_engagement, outreach_drafts if present)
- [ ] Inventory draft generation + review gates (campaignPipeline, deepReviewGate, ContentQualityGate)
- [ ] Inventory approvals + sending/handoff capability (CampaignFactory.handOffToOwner, ExternalWriteFirewall)
- [ ] Inventory scheduled jobs, notifications, budgets (daily-pipeline.ts, growth-pulse.ts, notificationEngine.ts, costTracking.ts)
- [ ] Inventory referral attribution/reporting if any (attribution, conversions tables per 0001_core_schema.sql)

### Phase 2 -- Pipeline (data model + UI shell)
- [ ] Design partner_prospects schema (stage enum incl. Archived/Do not contact, all required fields)
- [ ] Design dedup strategy against existing outreach data (normalized identifiers)
- [ ] Migration drafted (NOT applied)
- [ ] Android Partnerships section (mobile-friendly, existing nav/design patterns)

### Phase 3 -- Discovery/qualification
- [ ] Manual prospect entry (implementation)
- [ ] Qualification scoring model (explainable, evidence-separated-from-fit)
- [ ] Authorized research integration check -- report exact capability/blocker
- [ ] Up to 10 sourced candidates OR documented dependency

### Phase 4 -- Pitches/approvals
- [ ] Draft generation reusing existing gates (adapted for partnership content type)
- [ ] Edit/approve UI
- [ ] Copy/export + explicit "Mark contacted" (no send capability)
- [ ] Material-edit invalidates prior approval logic

### Phase 5 -- Follow-ups/daily workflow
- [ ] Daily view (ready/awaiting-approval/follow-ups-due/replies/pilots)
- [ ] Bounded follow-up sequence (default max 2), stop conditions
- [ ] Idempotent job re-runs (no duplicate prospects/drafts/interactions)

### Phase 6 -- Pilots/outcomes
- [ ] Pilot term tracking (proposed vs agreed)
- [ ] Outcome tracking with measured/manual/unavailable labeling
- [ ] No affiliate/commission payout system built (explicitly out of scope)

### Phase 7 -- Budget/access
- [ ] Independent Partnerships budget line (separate from X-feed-post's $6/mo)
- [ ] No new spending authorized without explicit owner approval
- [ ] Tenant/secret isolation preserved

### Phase 8 -- Verification
- [ ] Automated tests: dedup, evidence/unknown handling, stage transitions, approval-vs-contact, follow-up limits, job retry/idempotency, budget exhaustion isolation, data-access boundaries, attribution labeling
- [ ] Browser/device verification: phone + desktop, loading/empty/error/populated states
- [ ] End-to-end fixture demo (synthetic data only, no real contacts)
- [ ] typecheck/lint/test/build run, blockers identified precisely

### Delivery
- [ ] Isolated branch/worktree used
- [ ] Migrations + release instructions prepared locally only
- [ ] Final 7-point report delivered
