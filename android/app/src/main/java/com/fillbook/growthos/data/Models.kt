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
)

data class HealthItem(
    val label: String,
    val status: HealthStatus,
    val detail: String,
)

data class HomeSummary(
    val signalsAnalyzedToday: Int,
    val opportunitiesFound: Int,
    val assetsReady: Int,
    val pendingReview: Int,
    val systemPaused: Boolean,
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
