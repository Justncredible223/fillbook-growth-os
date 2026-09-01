package com.fillbook.growthos.data

enum class Urgency { LOW, NORMAL, HIGH }

enum class HealthStatus { HEALTHY, DEGRADED, DOWN, NOT_CONNECTED }

data class Opportunity(
    val id: String,
    val title: String,
    val score: Double,
    val urgency: Urgency,
    val rationale: String,
    val channels: List<String>,
)

enum class AssetStage {
    DRAFT, FINAL_DRAFT, READY_FOR_OWNER, HANDED_OFF
}

data class ApprovalAsset(
    val id: String,
    val campaignTitle: String,
    val platform: String,
    val assetType: String,
    val previewText: String,
    val stage: AssetStage,
    val isAutoDraft: Boolean,
    val costUsd: Double?,
    val generatedAt: String?,
)

data class HealthItem(
    val label: String,
    val status: HealthStatus,
    val detail: String,
)

data class AutoDraftStatus(
    val lastRunDate: String?,
    val lastRunStatus: String?,
    val lastRunSkipReason: String?,
    val backlogCount: Int,
    val backlogCap: Int,
    val monthSpendUsd: Double,
    val monthBudgetUsd: Double,
)

data class AnalyticsBreakdown(
    val totalSignals: Int,
    val signalsBySource: Map<String, Int>,
    val opportunitiesByStatus: Map<String, Int>,
    val campaignAssetsByStage: Map<String, Int>,
    val totalCostUsd: Double,
    val autoDraft: AutoDraftStatus,
)

data class HomeSummary(
    val signalsAnalyzedToday: Int,
    val opportunitiesFound: Int,
    val assetsReady: Int,
    val pendingReview: Int,
    val systemPaused: Boolean,
    val analytics: AnalyticsBreakdown,
)

enum class CreatorCategory { TIER_B, RESEARCH_NEXT, REJECTED }

data class Creator(
    val id: String,
    val handle: String,
    val displayName: String?,
    val platform: String,
    val category: CreatorCategory,
    val readinessScore: Int?,
    val followerCount: Int?,
    val creatorProductMoment: String?,
    val notes: String?,
    val rejectionReason: String?,
    val lastInteractionAt: String?,
)

data class CampaignAsset(
    val id: String,
    val platform: String,
    val assetType: String,
    /** Raw stage string from the server -- not every one of the 17 possible
     * CampaignFactory stages has a matching AssetStage case, and this
     * screen shows every campaign regardless of stage, so it's kept as
     * text rather than forced into an enum that would misrepresent
     * unmapped stages. */
    val stage: String,
    val latestBody: String?,
    val reviewPassCount: Int,
    val reviewFailCount: Int,
)

data class Campaign(
    val id: String,
    val thesis: String,
    val status: String,
    val assets: List<CampaignAsset>,
)

data class CostSummary(
    val totalCostUsd: Double,
    val last24hCostUsd: Double,
    val totalCalls: Int,
)
