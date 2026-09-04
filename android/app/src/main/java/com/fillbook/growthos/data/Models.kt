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
    /**
     * Only present when this opportunity traces back to exactly one real
     * X mention (see SupabaseOpportunityRepository.attachSourceUrls on
     * the backend) -- its presence, not any title/label heuristic, is
     * what marks this as an "engagement" opportunity (reply-worthy)
     * rather than a "campaign/content" opportunity.
     */
    val sourceUrl: String? = null,
    /** The real @handle X resolved for the mention's author, when it did. Never guessed -- null, not a fake handle, when X couldn't resolve one. */
    val authorHandle: String? = null,
) {
    val isEngagementOpportunity: Boolean get() = sourceUrl != null
}

/** Result of handing a ready campaign asset off to the owner (opened the platform composer) -- never a publish confirmation. */
data class HandOffResult(val campaignAssetId: String, val stage: String)

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
    val reviewPassCount: Int,
    val reviewFailCount: Int,
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
    val todayXPost: TodayXPost = TodayXPost(TodayXPostState.EMPTY, null, null),
)

enum class TodayXPostState { EMPTY, READY, HANDED_OFF }

/**
 * Never fabricated: EMPTY means no real X asset was created today, full
 * stop -- Home must not invent a placeholder. READY/HANDED_OFF only ever
 * reflect a genuine campaign_assets row (see api/summary.ts). HANDED_OFF
 * means the owner already opened X with this draft -- never "published,"
 * this app has no way to confirm an actual post happened.
 */
data class TodayXPost(
    val state: TodayXPostState,
    val campaignAssetId: String?,
    val previewText: String?,
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
    val decidedBy: String?,
    val decidedAt: String?,
    val assets: List<CampaignAsset>,
)

data class CostSummary(
    val totalCostUsd: Double,
    val last24hCostUsd: Double,
    val totalCalls: Int,
)

/**
 * Result of manually running one opportunity through POST /api/run-campaign.
 * `finalStage` reaching "ready_for_owner" means it landed in Approvals;
 * anything else means the mechanical gate or deep review blocked it --
 * `blockReasons` is why, not a failure of the request itself.
 */
data class CampaignRunResult(
    val finalStage: String,
    val blockReasons: List<String>,
    val costUsd: Double,
)

enum class InboundPriority { P1_DIRECT_REPLY, P2_RELATIONSHIP, P3_COMMENT, P4_MENTION, LOW_VALUE }

/** Raw status string kept as-is (not every server value maps to something the UI treats specially) rather than an enum that could silently drop an unrecognized future status. */
data class InboundEngagement(
    val id: String,
    val platform: String,
    val authorHandle: String?,
    val body: String,
    val inResponseToText: String?,
    val priority: InboundPriority,
    val status: String,
    val draftResponse: String?,
    val respondedAt: String?,
    val isRepeatEngager: Boolean,
    val creatorHandle: String?,
    val observedAt: String,
    val sourceReference: String?,
)

data class InboundSummary(
    val needsResponse: Int,
    val followUp: Int,
    val repeatEngagers: Int,
    val overdue: Int,
)

/**
 * Someone else's public X post found by Prospecting -- NOT a person who
 * mentioned/replied to @FillbookHQ (that's InboundEngagement). Raw status
 * string kept as-is, same rationale as InboundEngagement.status: the
 * server owns the state machine.
 */
data class ProspectingCandidate(
    val id: String,
    val discoveryQuery: String,
    val discoveryLabel: String,
    /** "A" = direct fit, "B" = adjacent fit, "C" = relationship fit (no Fillbook mention required) -- see backend/src/prospecting/prospectingTopics.ts. */
    val replyClass: String,
    val authorHandle: String?,
    val authorFollowerCount: Int?,
    val authorVerified: Boolean?,
    val postText: String,
    val postUrl: String,
    /** ISO timestamp of the original post, when X reported one -- null (not fabricated) when unavailable. */
    val postCreatedAt: String?,
    val opportunityScore: Double,
    /** Human-readable reasons behind the score, keyed by factor name ("topicRelevance", "activeDiscussion", ...) -- never fabricated, comes straight from the server's own scoring breakdown. */
    val scoreBreakdown: Map<String, String>,
    /** Flagged only by a simple follower-count heuristic server-side -- never auto-added to Creators; a human still decides. */
    val creatorCandidate: Boolean,
    val status: String,
    /** Only present once a draft has actually been generated -- never fabricated client-side. */
    val draftReply: String?,
    val replyMentionsFillbook: Boolean?,
    val replyUsedLink: Boolean?,
)

/** A topic or format worth acting on, with the plain-English reason the server computed it -- never a bare label with no evidence attached. */
data class StrategyItem(val label: String, val reason: String)

/** A rising search topic Growth OS hasn't turned into an opportunity yet. */
data class SeoOpportunity(val topic: String, val velocity: Double, val hasExistingOpportunity: Boolean)

/** A creator relationship that's gone quiet (30+ days) or was never actually contacted, surfaced so it doesn't just decay silently. */
data class CreatorOpportunity(
    val id: String,
    val handle: String,
    val category: String,
    val readinessScore: Int?,
    val daysSinceLastInteraction: Int?,
)

data class ExperimentSuggestion(val hypothesis: String, val rationale: String)

/**
 * One versioned Strategy Evolution report (see backend/src/strategy/types.ts).
 * Built entirely from Growth OS's own data -- real conversion/attribution
 * data from FillbookHQ itself isn't available to this project by design
 * (see docs/ARCHITECTURE.md), so [lowConfidence] exists specifically to
 * flag a report that doesn't yet have enough completed campaigns behind
 * it to mean much -- never hide that caveat from the owner.
 */
data class StrategyVersion(
    val version: Int,
    val generatedAt: String,
    val topicsToIncrease: List<StrategyItem>,
    val topicsToDecrease: List<StrategyItem>,
    val contentToRetire: List<StrategyItem>,
    val formatsToTest: List<StrategyItem>,
    val seoOpportunities: List<SeoOpportunity>,
    val creatorOpportunities: List<CreatorOpportunity>,
    val experimentsToRun: List<ExperimentSuggestion>,
    val summary: String,
    val lowConfidence: Boolean,
)
