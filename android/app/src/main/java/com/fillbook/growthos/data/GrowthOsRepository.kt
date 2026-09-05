package com.fillbook.growthos.data

/**
 * Interface the UI depends on. FakeGrowthOsRepository (below) is the only
 * implementation right now, since the backend isn't deployed yet (see
 * docs/PROGRESS_LEDGER.md Phase 7). A future NetworkGrowthOsRepository
 * calling the deployed Vercel API is a drop-in replacement — no screen
 * code should need to change.
 */
interface GrowthOsRepository {
    suspend fun getHomeSummary(): HomeSummary
    suspend fun getHealth(): List<HealthItem>
    suspend fun getOpportunities(): List<Opportunity>
    /**
     * Manually runs one open opportunity through the same draft -> mechanical
     * gate -> deep review pipeline the automated (max 1/day) auto-draft
     * uses. Never publishes anything -- the furthest an asset can reach is
     * ready_for_owner, i.e. it shows up in Approvals for a human decision.
     * Costs real LLM tokens (one draft + up to nine review calls).
     */
    suspend fun runCampaignForOpportunity(opportunityId: String): CampaignRunResult
    /**
     * The lightweight path for a single-post engagement opportunity --
     * one real LLM call, never the multi-agent campaign pipeline. Nothing
     * is persisted server-side; the draft is only ever returned for the
     * owner to review before they copy it themselves.
     */
    suspend fun draftOpportunityReply(opportunityId: String): String
    suspend fun getApprovals(): List<ApprovalAsset>
    suspend fun getCreators(): List<Creator>
    suspend fun getCampaigns(): List<Campaign>
    suspend fun getCostSummary(): CostSummary
    /**
     * Records the human decision -- approve or reject -- for one
     * campaign asset. Never publishes anything; only changes what this
     * app displays. The owner still does the actual posting themselves.
     */
    suspend fun decideApproval(campaignAssetId: String, approve: Boolean)
    /** Wires CampaignFactory.handOffToOwner() -- EXTERNAL_DRAFT only, "opened the composer," never a publish. */
    suspend fun handOffAsset(campaignAssetId: String): HandOffResult

    /** Backs the Settings/System "Pause System" control -- actually stops auto-draft and manual campaign runs server-side, not just a display flag. */
    suspend fun setPaused(paused: Boolean)

    /** The active Inbound Engagement Queue -- everything not yet resolved (new/needs_response/draft_ready/follow_up/review_needed). */
    suspend fun getInboundQueue(): List<InboundEngagement>
    /** Command Center counts: needs response / follow-ups / repeat engagers / overdue. */
    suspend fun getInboundSummary(): InboundSummary
    /** Generates a reply draft via the LLM and moves the item to draft_ready -- never sends anything. */
    suspend fun draftInboundResponse(id: String): InboundEngagement
    /** The ONLY action that sets status=responded -- an explicit confirmation the owner actually replied on the platform themselves. */
    suspend fun markInboundResponded(id: String, note: String? = null)
    suspend fun markInboundFollowUp(id: String)
    suspend fun closeInbound(id: String)
    /** Ignores the ingestion cursor and re-checks the recent window -- the "we found unanswered replies" recovery pass. */
    suspend fun runInboundBacklogRecovery()

    /** The active Prospecting queue -- OTHER people's public X posts worth replying to, ranked highest score first. Marks any still-"new" rows "shown" server-side, so a refresh never presents the same candidate as freshly found twice. */
    suspend fun getProspectingQueue(): List<ProspectingCandidate>
    /** Generates a reply draft via the LLM for one candidate -- never persisted as sent, never posted. Costs one real LLM call. */
    suspend fun draftProspectingReply(id: String): ProspectingCandidate
    /** Records that the owner tapped "Open on X" for this candidate -- timestamp only, no status change. */
    suspend fun openProspectingCandidate(id: String)
    /** The ONLY action that sets status=replied -- an explicit confirmation the owner actually posted on X themselves. Also records outreach so Inbound recognizes this author if they reply back later. */
    suspend fun markProspectingReplied(id: String, finalReply: String?, mentionsFillbook: Boolean?, usedLink: Boolean?): ProspectingCandidate
    suspend fun markProspectingSkipped(id: String, reason: String?)
    suspend fun markProspectingNotRelevant(id: String)
    suspend fun markProspectingAlreadyHandled(id: String)

    /** The latest Strategy Evolution report, or null if none has been generated yet. */
    suspend fun getLatestStrategy(): StrategyVersion?
    /** Forces a fresh strategy report now, regardless of the normal weekly schedule -- for the Strategy screen's manual "Regenerate" action. */
    suspend fun regenerateStrategy(): StrategyVersion

    suspend fun getExperiments(): List<Experiment>
    suspend fun createExperiment(hypothesis: String, scopePlatform: String?, scopeAssetType: String?, guardrailNote: String?, startDate: String, controlWindowDays: Int): Experiment
    /** Refreshes a running experiment's result without ending it. */
    suspend fun measureExperiment(id: String): Experiment
    /** Computes a final result and marks the experiment completed. */
    suspend fun completeExperiment(id: String): Experiment
    suspend fun abortExperiment(id: String)

    /** Real, meaningful-events-only in-app notifications -- see backend/src/notifications/notificationEngine.ts. Not OS-level push (that needs Firebase, a separate owner setup step). */
    suspend fun getNotifications(): Pair<List<AppNotification>, Int>
    suspend fun markNotificationRead(id: String)
    suspend fun markAllNotificationsRead()

    suspend fun getMorningBrief(): MorningBrief
    suspend fun getEveningReport(): EveningReport
}

/**
 * Seeded with real content drawn from FillbookHQ's actual growth history
 * (docs/SEED_DATA_SOURCES.md) rather than generic placeholder text, so the
 * app is honest about what it will actually show once wired to the real
 * backend.
 */
class FakeGrowthOsRepository : GrowthOsRepository {
    override suspend fun getHomeSummary() = HomeSummary(
        signalsAnalyzedToday = 0,
        opportunitiesFound = 1,
        assetsReady = 0,
        pendingReview = 0,
        systemPaused = false,
        analytics = AnalyticsBreakdown(
            totalSignals = 25,
            signalsBySource = mapOf("x_mention" to 19, "youtube_video" to 6),
            opportunitiesByStatus = mapOf("open" to 12, "actioned" to 1),
            campaignAssetsByStage = mapOf("draft" to 1, "final_draft" to 1, "ready_for_owner" to 1),
            totalCostUsd = 0.09,
            todaySpendUsd = 0.0035,
            autoDraft = AutoDraftStatus(
                lastRunDate = "2026-09-08",
                lastRunStatus = "drafted",
                lastRunSkipReason = null,
                backlogCount = 1,
                backlogCap = 3,
                monthSpendUsd = 0.09,
                monthBudgetUsd = 5.0,
            ),
        ),
        todayXPost = TodayXPost(
            state = TodayXPostState.READY,
            campaignAssetId = "asset-fake-1",
            previewText = "Revenge trading doesn't show up as \"revenge\" in your P&L -- it shows up as funded-account breach.",
        ),
    )

    override suspend fun getHealth() = listOf(
        HealthItem("Supabase", HealthStatus.HEALTHY, "fillbook-growth-os project, live"),
        HealthItem("Job queue", HealthStatus.HEALTHY, "0 pending, 0 dead-lettered"),
        HealthItem("Search Console", HealthStatus.NOT_CONNECTED, "Needs a Google Cloud OAuth app (owner action)"),
        HealthItem("X", HealthStatus.NOT_CONNECTED, "Needs an X developer app (owner action)"),
        HealthItem("TikTok", HealthStatus.NOT_CONNECTED, "Promote is account-blocked; organic staging only"),
        HealthItem("YouTube", HealthStatus.NOT_CONNECTED, "Needs a Google Cloud OAuth app (owner action)"),
        HealthItem("AI provider", HealthStatus.NOT_CONNECTED, "Needs an API key for deep content review"),
    )

    override suspend fun getOpportunities() = listOf(
        Opportunity(
            id = "opp-1",
            title = "Trailing drawdown rules confuse more traders than max drawdown",
            score = 78.4,
            urgency = Urgency.HIGH,
            rationale = "High audience relevance (prop-firm traders), strong Fillbook fit (drawdown tracking is a real feature), no recent coverage on this exact angle.",
            channels = listOf("X", "YouTube Shorts"),
        ),
        Opportunity(
            id = "opp-2",
            title = "x_mention: how do you handle a trailing drawdown reset on a funded account?",
            score = 62.0,
            urgency = Urgency.NORMAL,
            rationale = "A single real X mention worth a direct reply, not a full campaign.",
            channels = listOf("X"),
            sourceUrl = "https://x.com/i/web/status/999",
            authorHandle = "someTrader",
        ),
    )

    override suspend fun runCampaignForOpportunity(opportunityId: String) = CampaignRunResult(
        finalStage = "ready_for_owner",
        blockReasons = emptyList(),
        costUsd = 0.03,
    )

    override suspend fun draftOpportunityReply(opportunityId: String) =
        "Depends on the firm -- most reset trailing drawdown at end of day, but a few use a static floor instead. Worth checking your specific rulebook."

    override suspend fun getApprovals() = emptyList<ApprovalAsset>()

    override suspend fun getCreators() = listOf(
        Creator(
            id = "creator-fake-1",
            handle = "@wannabechamp",
            displayName = "Dan Cheung",
            platform = "x",
            category = CreatorCategory.TIER_B,
            readinessScore = 2,
            followerCount = 40100,
            creatorProductMoment = "Journaling / journal-review discussions -- directly the product's core format.",
            notes = "Trading-journal/risk-management educator.",
            rejectionReason = null,
            lastInteractionAt = "2026-08-31T12:00:00Z",
        ),
    )

    override suspend fun getCampaigns() = listOf(
        Campaign(
            id = "campaign-fake-1",
            thesis = "A trader publicly told @FillbookHQ that revenge trading is what's breaching their funded accounts",
            status = "actioned",
            decidedBy = null,
            decidedAt = null,
            assets = listOf(
                CampaignAsset(
                    id = "asset-fake-1",
                    platform = "x",
                    assetType = "post",
                    stage = "ready_for_owner",
                    latestBody = "Revenge trading doesn't show up as \"revenge\" in your P&L -- it shows up as funded-account breach. One trade to fix the last one, every time, until you're done. Track the pattern or keep resetting.",
                    reviewPassCount = 9,
                    reviewFailCount = 0,
                ),
            ),
        ),
    )

    override suspend fun getCostSummary() = CostSummary(
        totalCostUsd = 0.02,
        last24hCostUsd = 0.02,
        totalCalls = 20,
    )

    override suspend fun decideApproval(campaignAssetId: String, approve: Boolean) {
        // No backend to call in fake mode -- no-op.
    }

    override suspend fun setPaused(paused: Boolean) {
        // No backend to call in fake mode -- no-op.
    }

    override suspend fun handOffAsset(campaignAssetId: String) = HandOffResult(campaignAssetId, "handed_off")

    private val inboundItems = mutableListOf(
        InboundEngagement(
            id = "inbound-fake-1",
            platform = "x",
            authorHandle = "someTrader",
            body = "how do you handle trailing drawdown resets on a funded account?",
            inResponseToText = "Revenge trading doesn't show up as \"revenge\" in your P&L...",
            priority = InboundPriority.P1_DIRECT_REPLY,
            status = "needs_response",
            draftResponse = null,
            respondedAt = null,
            isRepeatEngager = false,
            creatorHandle = null,
            observedAt = "2026-09-01T18:00:00Z",
            sourceReference = "https://x.com/i/web/status/1",
        ),
        InboundEngagement(
            id = "inbound-fake-2",
            platform = "x",
            authorHandle = "wannabechamp",
            body = "following up -- did you ever add the journal-review export I asked about?",
            inResponseToText = null,
            priority = InboundPriority.P2_RELATIONSHIP,
            status = "needs_response",
            draftResponse = null,
            respondedAt = null,
            isRepeatEngager = true,
            creatorHandle = "wannabechamp",
            observedAt = "2026-08-30T09:00:00Z",
            sourceReference = "https://x.com/i/web/status/2",
        ),
    )

    override suspend fun getInboundQueue() = inboundItems.filter { it.status != "closed" && it.status != "responded" }

    override suspend fun getInboundSummary() = InboundSummary(
        needsResponse = inboundItems.count { it.status == "needs_response" },
        followUp = inboundItems.count { it.status == "follow_up" },
        repeatEngagers = inboundItems.count { it.isRepeatEngager && it.status != "closed" && it.status != "responded" },
        overdue = 0,
    )

    override suspend fun draftInboundResponse(id: String): InboundEngagement {
        val index = inboundItems.indexOfFirst { it.id == id }
        val updated = inboundItems[index].copy(status = "draft_ready", draftResponse = "Trailing drawdown typically resets at end-of-day on most prop firms -- worth double-checking your specific firm's rule since a few use a static floor instead.")
        inboundItems[index] = updated
        return updated
    }

    override suspend fun markInboundResponded(id: String, note: String?) {
        val index = inboundItems.indexOfFirst { it.id == id }
        inboundItems[index] = inboundItems[index].copy(status = "responded", respondedAt = "2026-09-01T19:00:00Z")
    }

    override suspend fun markInboundFollowUp(id: String) {
        val index = inboundItems.indexOfFirst { it.id == id }
        inboundItems[index] = inboundItems[index].copy(status = "follow_up")
    }

    override suspend fun closeInbound(id: String) {
        val index = inboundItems.indexOfFirst { it.id == id }
        inboundItems[index] = inboundItems[index].copy(status = "closed")
    }

    override suspend fun runInboundBacklogRecovery() {
        // No backend to call in fake mode -- no-op.
    }

    private val prospectingItems = mutableListOf(
        ProspectingCandidate(
            id = "prospect-fake-1",
            discoveryQuery = "trailing_drawdown",
            discoveryLabel = "Trailing drawdown",
            replyClass = "A",
            authorHandle = "futuresGrind",
            authorFollowerCount = 3400,
            authorVerified = false,
            postText = "does trailing drawdown lock in at end of day or is it live the whole session? every firm explains it differently and I'm losing my mind",
            postUrl = "https://x.com/i/web/status/501",
            postCreatedAt = "2026-09-03T18:00:00Z",
            opportunityScore = 78.2,
            scoreBreakdown = mapOf(
                "topicRelevance" to "\"Trailing drawdown\" (risk_management) -> +16",
                "activeDiscussion" to "3 replies, 0 quotes, 9 likes -> +9.8",
                "authorReach" to "3400 followers -> +11.3 (capped at 15)",
                "recency" to "posted 2.1h ago -> +14.3",
                "valueOpportunity" to "asks a question, enough context -> +15",
            ),
            creatorCandidate = false,
            status = "shown",
            draftReply = null,
            replyMentionsFillbook = null,
            replyUsedLink = null,
        ),
        ProspectingCandidate(
            id = "prospect-fake-2",
            discoveryQuery = "blown_account",
            discoveryLabel = "Blown account",
            replyClass = "A",
            authorHandle = "smallAccountTrader",
            authorFollowerCount = 620,
            authorVerified = false,
            postText = "blew my third funded account this year on the same mistake. one bad trade after four good days, every single time",
            postUrl = "https://x.com/i/web/status/502",
            postCreatedAt = "2026-09-03T19:30:00Z",
            opportunityScore = 71.5,
            scoreBreakdown = mapOf(
                "topicRelevance" to "\"Blown account\" (risk_management) -> +16",
                "activeDiscussion" to "1 replies, 0 quotes, 22 likes -> +8.1",
                "authorReach" to "620 followers -> +8.4 (capped at 15)",
                "recency" to "posted 0.6h ago -> +14.8",
                "valueOpportunity" to "no question, enough context -> +7",
            ),
            creatorCandidate = false,
            status = "new",
            draftReply = null,
            replyMentionsFillbook = null,
            replyUsedLink = null,
        ),
    )

    override suspend fun getProspectingQueue(): List<ProspectingCandidate> {
        for (i in prospectingItems.indices) {
            if (prospectingItems[i].status == "new") prospectingItems[i] = prospectingItems[i].copy(status = "shown")
        }
        return prospectingItems.filter { it.status in setOf("new", "shown", "ready") }.sortedByDescending { it.opportunityScore }
    }

    override suspend fun draftProspectingReply(id: String): ProspectingCandidate {
        val index = prospectingItems.indexOfFirst { it.id == id }
        val updated = prospectingItems[index].copy(
            status = "ready",
            draftReply = "Most firms lock it in at the daily close, but a few (Apex included) still trail live intraday -- worth checking your specific firm's rulebook since this trips people up constantly.",
            replyMentionsFillbook = false,
            replyUsedLink = false,
        )
        prospectingItems[index] = updated
        return updated
    }

    override suspend fun openProspectingCandidate(id: String) {
        // No backend to call in fake mode -- no-op.
    }

    override suspend fun markProspectingReplied(id: String, finalReply: String?, mentionsFillbook: Boolean?, usedLink: Boolean?): ProspectingCandidate {
        val index = prospectingItems.indexOfFirst { it.id == id }
        val updated = prospectingItems[index].copy(status = "replied")
        prospectingItems[index] = updated
        return updated
    }

    override suspend fun markProspectingSkipped(id: String, reason: String?) {
        val index = prospectingItems.indexOfFirst { it.id == id }
        if (index >= 0) prospectingItems[index] = prospectingItems[index].copy(status = "skipped")
    }

    override suspend fun markProspectingNotRelevant(id: String) {
        val index = prospectingItems.indexOfFirst { it.id == id }
        if (index >= 0) prospectingItems[index] = prospectingItems[index].copy(status = "not_relevant")
    }

    override suspend fun markProspectingAlreadyHandled(id: String) {
        val index = prospectingItems.indexOfFirst { it.id == id }
        if (index >= 0) prospectingItems[index] = prospectingItems[index].copy(status = "already_handled")
    }

    private var fakeStrategy: StrategyVersion? = StrategyVersion(
        version = 1,
        generatedAt = "2026-09-03T12:00:00Z",
        topicsToIncrease = listOf(
            StrategyItem("Trailing drawdown confusion", "80% review pass rate across 5 campaigns, 4 reached ready-for-owner."),
        ),
        topicsToDecrease = listOf(
            StrategyItem("Generic motivation posts", "Only 20% review pass rate across 4 campaigns."),
        ),
        contentToRetire = emptyList(),
        formatsToTest = listOf(
            StrategyItem("x / post", "85% pass rate across 6 assets -- worth more volume here."),
        ),
        seoOpportunities = listOf(
            SeoOpportunity("prop firm consistency rule", velocity = 3.0, hasExistingOpportunity = false),
        ),
        creatorOpportunities = listOf(
            CreatorOpportunity("creator-fake-1", "@wannabechamp", "tier_b", 2, daysSinceLastInteraction = 34),
        ),
        experimentsToRun = listOf(
            ExperimentSuggestion(
                "Doubling down on \"Trailing drawdown confusion\"-style topics increases the ready-for-owner rate further.",
                "80% review pass rate across 5 campaigns, 4 reached ready-for-owner.",
            ),
        ),
        summary = "1 topic(s) to double down on, 1 to pull back on. 1 rising search topic(s) with no opportunity yet. 1 creator relationship(s) gone quiet.",
        lowConfidence = true,
    )

    override suspend fun getLatestStrategy(): StrategyVersion? = fakeStrategy

    override suspend fun regenerateStrategy(): StrategyVersion {
        val current = fakeStrategy
        val next = (current?.copy(version = current.version + 1) ?: fakeStrategy)!!
        fakeStrategy = next
        return next
    }

    private val fakeExperiments = mutableListOf(
        Experiment(
            id = "exp-fake-1",
            hypothesis = "More video_script assets on tiktok improve the review pass rate",
            scopePlatform = "tiktok",
            scopeAssetType = "video_script",
            guardrailNote = null,
            status = "running",
            startDate = "2026-08-27",
            endDate = null,
            controlWindowStart = "2026-08-13",
            createdAt = "2026-08-27T12:00:00Z",
            result = ExperimentResult(
                controlRate = 0.4,
                treatmentRate = 0.4,
                absoluteDifference = 0.0,
                pValue = null,
                isSignificant = false,
                insufficientSample = true,
                controlSampleSize = 3,
                treatmentSampleSize = 2,
                interpretation = "Not enough data yet (control: 3, treatment: 2 -- both need 5+). Keep running before drawing a conclusion.",
                computedAt = "2026-09-03T12:00:00Z",
            ),
        ),
    )

    override suspend fun getExperiments(): List<Experiment> = fakeExperiments.toList()

    override suspend fun createExperiment(hypothesis: String, scopePlatform: String?, scopeAssetType: String?, guardrailNote: String?, startDate: String, controlWindowDays: Int): Experiment {
        val created = Experiment(
            id = "exp-fake-${fakeExperiments.size + 1}",
            hypothesis = hypothesis,
            scopePlatform = scopePlatform,
            scopeAssetType = scopeAssetType,
            guardrailNote = guardrailNote,
            status = "running",
            startDate = startDate,
            endDate = null,
            controlWindowStart = startDate,
            createdAt = startDate,
            result = null,
        )
        fakeExperiments.add(0, created)
        return created
    }

    override suspend fun measureExperiment(id: String): Experiment = fakeExperiments.first { it.id == id }

    override suspend fun completeExperiment(id: String): Experiment {
        val index = fakeExperiments.indexOfFirst { it.id == id }
        val updated = fakeExperiments[index].copy(status = "completed", endDate = "2026-09-03")
        fakeExperiments[index] = updated
        return updated
    }

    override suspend fun abortExperiment(id: String) {
        val index = fakeExperiments.indexOfFirst { it.id == id }
        if (index >= 0) fakeExperiments[index] = fakeExperiments[index].copy(status = "aborted")
    }

    private val fakeNotifications = mutableListOf(
        AppNotification(
            id = "notif-fake-1",
            type = "high_value_opportunity",
            title = "High-value opportunity: Trailing drawdown confusion",
            body = "Score 80 -- worth a look in Radar.",
            severity = "info",
            createdAt = "2026-09-03T13:00:00Z",
            readAt = null,
            relatedId = "opp-1",
        ),
    )

    override suspend fun getNotifications(): Pair<List<AppNotification>, Int> =
        fakeNotifications.toList() to fakeNotifications.count { it.readAt == null }

    override suspend fun markNotificationRead(id: String) {
        val index = fakeNotifications.indexOfFirst { it.id == id }
        if (index >= 0) fakeNotifications[index] = fakeNotifications[index].copy(readAt = "2026-09-03T13:05:00Z")
    }

    override suspend fun markAllNotificationsRead() {
        for (i in fakeNotifications.indices) {
            if (fakeNotifications[i].readAt == null) fakeNotifications[i] = fakeNotifications[i].copy(readAt = "2026-09-03T13:05:00Z")
        }
    }

    override suspend fun getMorningBrief() = MorningBrief(
        generatedAt = "2026-09-03T13:00:00Z",
        signalsOvernight = 4,
        topNewOpportunities = listOf(OpportunitySummary("opp-1", "Trailing drawdown confusion", 80.0)),
        pendingApprovals = 1,
        inboundNeedsResponse = 2,
        strategySummary = "1 topic(s) to double down on, 1 to pull back on.",
        unreadNotificationCount = 1,
    )

    override suspend fun getEveningReport() = EveningReport(
        generatedAt = "2026-09-03T23:00:00Z",
        assetsDrafted = 2,
        approvedToday = 1,
        rejectedToday = 0,
        reviewPassRate = 0.85,
        costTodayUsd = 0.09,
        inboundResolvedToday = 3,
        topOpportunity = OpportunitySummary("opp-1", "Trailing drawdown confusion", 80.0),
    )
}
