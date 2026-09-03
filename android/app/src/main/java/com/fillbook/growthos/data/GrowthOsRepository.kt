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
}
