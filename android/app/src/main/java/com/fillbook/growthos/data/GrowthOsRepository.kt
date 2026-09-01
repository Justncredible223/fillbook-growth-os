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
    suspend fun getApprovals(): List<ApprovalAsset>
    suspend fun getCreators(): List<Creator>
    suspend fun getCampaigns(): List<Campaign>
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
    )

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
}
