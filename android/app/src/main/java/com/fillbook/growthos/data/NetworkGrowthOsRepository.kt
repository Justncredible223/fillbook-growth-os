package com.fillbook.growthos.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Real backend client. Talks to the deployed Vercel API, which is the
 * only thing that ever touches Supabase with the service_role key -- this
 * app never holds that key.
 *
 * [protectionBypassSecret] is Vercel's "Protection Bypass for Automation"
 * token (Settings -> Deployment Protection), NOT the Supabase service_role
 * key. It exists specifically to let a client like this one reach a
 * protected deployment without a human Vercel login, and is safe to embed
 * client-side by design -- see Vercel's own docs on this feature. It is a
 * different trust tier from the Supabase service_role key, which never
 * appears anywhere in this app.
 *
 * [appToken] is the second, separate credential that actually gates this
 * project's own business data (see backend/src/lib/requireAppAuth.ts).
 * Same trust tier as the Vercel bypass secret above -- compiled into the
 * app once (MainActivity's APP_TOKEN), never something the owner types
 * or retrieves. The owner's actual gate is BiometricGateScreen
 * (fingerprint/face/device PIN); this token exists so a stranger who
 * only has the Vercel bypass secret still can't reach this project's
 * data without also having decompiled the APK for this value too. Every
 * request here sends it as a standard Authorization: Bearer header; the
 * backend rejects anything that doesn't match its own APP_API_TOKEN env
 * var.
 *
 * [deciderName] answers "who approved this" for the audit trail (see
 * migration 0013_campaign_decision_audit.sql) -- fixed to "Owner" for
 * this single-owner app rather than a real account system.
 */
class NetworkGrowthOsRepository(
    private val baseUrl: String,
    private val protectionBypassSecret: String,
    private val appToken: String,
    private val deciderName: String = "",
) : GrowthOsRepository {

    // Default OkHttp timeouts are 10s each way -- fine for every other
    // endpoint here, but POST /api/run-campaign drafts content and then runs
    // up to nine sequential LLM review-agent calls server-side, which
    // routinely takes well past 10s. Verified live: a real run reached
    // ready_for_owner in Supabase while the client had already timed out and
    // shown "couldn't run that campaign" -- the campaign wasn't lost, but
    // retrying on that false failure would have spent real LLM tokens
    // drafting the same opportunity a second time.
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("x-vercel-protection-bypass", protectionBypassSecret)
            .header("x-vercel-set-bypass-cookie", "true")
            .header("Authorization", "Bearer $appToken")
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string() ?: "{}"
            if (!response.isSuccessful) {
                throw NetworkException("GET $path failed: HTTP ${response.code} -- $body", response.code)
            }
            JSONObject(body)
        }
    }

    private suspend fun post(path: String, jsonBody: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("x-vercel-protection-bypass", protectionBypassSecret)
            .header("x-vercel-set-bypass-cookie", "true")
            .header("Authorization", "Bearer $appToken")
            .post(jsonBody.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string() ?: "{}"
            if (!response.isSuccessful) {
                throw NetworkException("POST $path failed: HTTP ${response.code} -- $responseBody", response.code)
            }
            JSONObject(responseBody)
        }
    }

    override suspend fun getHomeSummary(): HomeSummary {
        val json = get("/api/summary")
        val analytics = json.getJSONObject("analytics")
        return HomeSummary(
            signalsAnalyzedToday = json.getInt("signalsAnalyzedToday"),
            opportunitiesFound = json.getInt("opportunitiesFound"),
            assetsReady = json.getInt("assetsReady"),
            pendingReview = json.getInt("pendingReview"),
            systemPaused = json.getBoolean("systemPaused"),
            analytics = AnalyticsBreakdown(
                totalSignals = analytics.getInt("totalSignals"),
                signalsBySource = analytics.getJSONObject("signalsBySource").toIntMap(),
                opportunitiesByStatus = analytics.getJSONObject("opportunitiesByStatus").toIntMap(),
                campaignAssetsByStage = analytics.getJSONObject("campaignAssetsByStage").toIntMap(),
                totalCostUsd = analytics.getDouble("totalCostUsd"),
                todaySpendUsd = analytics.getDouble("todaySpendUsd"),
                autoDraft = analytics.getJSONObject("autoDraft").let { ad ->
                    AutoDraftStatus(
                        lastRunDate = ad.optStringOrNull("lastRunDate"),
                        lastRunStatus = ad.optStringOrNull("lastRunStatus"),
                        lastRunSkipReason = ad.optStringOrNull("lastRunSkipReason"),
                        backlogCount = ad.getInt("backlogCount"),
                        backlogCap = ad.getInt("backlogCap"),
                        monthSpendUsd = ad.getDouble("monthSpendUsd"),
                        monthBudgetUsd = ad.getDouble("monthBudgetUsd"),
                    )
                },
            ),
            todayXPost = json.optJSONObject("todayXPost")?.let { post ->
                TodayXPost(
                    state = runCatching { TodayXPostState.valueOf(post.getString("state").uppercase()) }
                        .getOrDefault(TodayXPostState.EMPTY),
                    campaignAssetId = post.optStringOrNull("campaignAssetId"),
                    previewText = post.optStringOrNull("previewText"),
                )
            } ?: TodayXPost(TodayXPostState.EMPTY, null, null),
        )
    }

    override suspend fun getHealth(): List<HealthItem> {
        val json = get("/api/health")
        return json.getJSONArray("health").map { item ->
            HealthItem(
                label = item.getString("label"),
                status = runCatching { HealthStatus.valueOf(item.getString("status")) }
                    .getOrDefault(HealthStatus.NOT_CONNECTED),
                detail = item.getString("detail"),
            )
        }
    }

    override suspend fun getOpportunities(): List<Opportunity> {
        val json = get("/api/opportunities")
        return json.getJSONArray("opportunities").map { item ->
            Opportunity(
                id = item.getString("id"),
                title = item.getString("title"),
                score = item.getDouble("score"),
                urgency = runCatching { Urgency.valueOf(item.getString("urgency").uppercase()) }
                    .getOrDefault(Urgency.NORMAL),
                rationale = item.getString("rationale"),
                channels = item.getJSONArray("recommendedChannels").mapStrings(),
                sourceUrl = item.optStringOrNull("sourceUrl"),
                authorHandle = item.optStringOrNull("authorHandle"),
            )
        }
    }

    override suspend fun draftOpportunityReply(opportunityId: String): String {
        val body = JSONObject().put("action", "draft-reply").put("opportunityId", opportunityId)
        val json = post("/api/opportunities", body)
        return json.getString("draft")
    }

    override suspend fun runCampaignForOpportunity(opportunityId: String): CampaignRunResult {
        val json = post("/api/run-campaign", JSONObject().put("opportunityId", opportunityId))
        val result = json.getJSONObject("result")
        return CampaignRunResult(
            finalStage = result.getString("finalStage"),
            blockReasons = result.optJSONArray("mechanicalBlockReasons")?.mapStrings() ?: emptyList(),
            costUsd = json.getDouble("costUsd"),
        )
    }

    override suspend fun getApprovals(): List<ApprovalAsset> {
        val json = get("/api/approvals")
        return json.getJSONArray("approvals").map { item ->
            ApprovalAsset(
                id = item.getString("id"),
                campaignTitle = item.getString("campaignTitle"),
                platform = item.getString("platform"),
                assetType = item.getString("assetType"),
                previewText = item.getString("previewText"),
                stage = runCatching { AssetStage.valueOf(item.getString("stage")) }
                    .getOrDefault(AssetStage.READY_FOR_OWNER),
                isAutoDraft = item.getBoolean("isAutoDraft"),
                costUsd = if (item.isNull("costUsd")) null else item.getDouble("costUsd"),
                generatedAt = item.optStringOrNull("generatedAt"),
                reviewPassCount = item.optInt("reviewPassCount", 0),
                reviewFailCount = item.optInt("reviewFailCount", 0),
                trackingQuery = item.optStringOrNull("trackingQuery") ?: "",
            )
        }
    }

    override suspend fun getCreators(): List<Creator> {
        val json = get("/api/creators")
        return json.getJSONArray("creators").map { item ->
            Creator(
                id = item.getString("id"),
                handle = item.getString("handle"),
                displayName = item.optStringOrNull("displayName"),
                platform = item.getString("platform"),
                category = runCatching { CreatorCategory.valueOf(item.getString("category").uppercase()) }
                    .getOrDefault(CreatorCategory.RESEARCH_NEXT),
                readinessScore = if (item.isNull("readinessScore")) null else item.getInt("readinessScore"),
                followerCount = if (item.isNull("followerCount")) null else item.getInt("followerCount"),
                creatorProductMoment = item.optStringOrNull("creatorProductMoment"),
                notes = item.optStringOrNull("notes"),
                rejectionReason = item.optStringOrNull("rejectionReason"),
                lastInteractionAt = item.optStringOrNull("lastInteractionAt"),
            )
        }
    }

    override suspend fun getCampaigns(): List<Campaign> {
        val json = get("/api/campaigns")
        return json.getJSONArray("campaigns").map { item ->
            Campaign(
                id = item.getString("id"),
                thesis = item.getString("thesis"),
                status = item.getString("status"),
                decidedBy = item.optStringOrNull("decidedBy"),
                decidedAt = item.optStringOrNull("decidedAt"),
                assets = item.getJSONArray("assets").map { asset ->
                    CampaignAsset(
                        id = asset.getString("id"),
                        platform = asset.getString("platform"),
                        assetType = asset.getString("assetType"),
                        stage = asset.getString("stage"),
                        latestBody = asset.optStringOrNull("latestBody"),
                        reviewPassCount = asset.getInt("reviewPassCount"),
                        reviewFailCount = asset.getInt("reviewFailCount"),
                    )
                },
            )
        }
    }

    override suspend fun getCostSummary(): CostSummary {
        // Folded into /api/summary (?view=cost) to free a serverless-function
        // slot for /api/growth-pulse -- see backend/api/summary.ts's doc
        // comment. Response shape is unchanged, only the URL moved.
        val json = get("/api/summary?view=cost")
        return CostSummary(
            totalCostUsd = json.getDouble("totalCostUsd"),
            last24hCostUsd = json.getDouble("last24hCostUsd"),
            totalCalls = json.getInt("totalCalls"),
        )
    }

    override suspend fun decideApproval(campaignAssetId: String, approve: Boolean) {
        val body = JSONObject()
            .put("campaignAssetId", campaignAssetId)
            .put("action", if (approve) "approve" else "reject")
            .put("decidedBy", deciderName)
        post("/api/approvals", body)
    }

    override suspend fun setPaused(paused: Boolean) {
        post("/api/summary", JSONObject().put("paused", paused))
    }

    override suspend fun handOffAsset(campaignAssetId: String): HandOffResult {
        val body = JSONObject().put("action", "hand-off").put("campaignAssetId", campaignAssetId)
        val json = post("/api/approvals", body)
        return HandOffResult(campaignAssetId = json.getString("campaignAssetId"), stage = json.getString("stage"))
    }

    private fun JSONObject.toInboundEngagement() = InboundEngagement(
        id = getString("id"),
        platform = getString("platform"),
        authorHandle = optStringOrNull("authorHandle"),
        body = getString("body"),
        inResponseToText = optStringOrNull("inResponseToText"),
        priority = runCatching { InboundPriority.valueOf(getString("priority").uppercase()) }
            .getOrDefault(InboundPriority.P4_MENTION),
        status = getString("status"),
        draftResponse = optStringOrNull("draftResponse"),
        respondedAt = optStringOrNull("respondedAt"),
        isRepeatEngager = getBoolean("isRepeatEngager"),
        creatorHandle = optStringOrNull("creatorHandle"),
        observedAt = getString("observedAt"),
        sourceReference = optStringOrNull("sourceReference"),
    )

    // Folded into /api/approvals (?resource=inbound) rather than a new endpoint --
    // Vercel Hobby's 12-serverless-function cap is already fully used (see api/ingest.ts
    // for the same reasoning applied to signal sources).
    override suspend fun getInboundQueue(): List<InboundEngagement> {
        val json = get("/api/approvals?resource=inbound")
        return json.getJSONArray("items").map { it.toInboundEngagement() }
    }

    override suspend fun getInboundSummary(): InboundSummary {
        val json = get("/api/approvals?resource=inbound&summary=1")
        return InboundSummary(
            needsResponse = json.getInt("needsResponse"),
            followUp = json.getInt("followUp"),
            repeatEngagers = json.getInt("repeatEngagers"),
            overdue = json.getInt("overdue"),
        )
    }

    override suspend fun draftInboundResponse(id: String): InboundEngagement {
        val json = post("/api/approvals?resource=inbound", JSONObject().put("action", "draft").put("id", id))
        return json.toInboundEngagement()
    }

    override suspend fun markInboundResponded(id: String, note: String?) {
        val body = JSONObject().put("action", "mark-responded").put("id", id)
        if (note != null) body.put("note", note)
        post("/api/approvals?resource=inbound", body)
    }

    override suspend fun markInboundFollowUp(id: String) {
        post("/api/approvals?resource=inbound", JSONObject().put("action", "follow-up").put("id", id))
    }

    override suspend fun closeInbound(id: String) {
        post("/api/approvals?resource=inbound", JSONObject().put("action", "close").put("id", id))
    }

    override suspend fun runInboundBacklogRecovery() {
        post("/api/approvals?resource=inbound", JSONObject().put("action", "backlog-recover"))
    }

    private fun JSONObject.toProspectingCandidate() = ProspectingCandidate(
        id = getString("id"),
        // Every row has a platform server-side; "x" is only the fallback for a
        // response predating the field, never a guess about a Reddit row.
        platform = optStringOrNull("platform") ?: "x",
        discoveryQuery = getString("discoveryQuery"),
        discoveryLabel = optStringOrNull("discoveryLabel") ?: getString("discoveryQuery"),
        replyClass = optStringOrNull("replyClass") ?: "B",
        authorHandle = optStringOrNull("authorHandle"),
        authorFollowerCount = if (isNull("authorFollowerCount")) null else getInt("authorFollowerCount"),
        authorVerified = if (isNull("authorVerified")) null else getBoolean("authorVerified"),
        postText = getString("postText"),
        postUrl = getString("postUrl"),
        postCreatedAt = optStringOrNull("postCreatedAt"),
        opportunityScore = getDouble("opportunityScore"),
        scoreBreakdown = optJSONObject("scoreBreakdown")?.toStringMap() ?: emptyMap(),
        creatorCandidate = optBoolean("creatorCandidate", false),
        status = getString("status"),
        draftReply = optStringOrNull("draftReply"),
        replyMentionsFillbook = if (isNull("replyMentionsFillbook")) null else getBoolean("replyMentionsFillbook"),
        replyUsedLink = if (isNull("replyUsedLink")) null else getBoolean("replyUsedLink"),
    )

    // Folded into /api/approvals (?resource=prospecting) -- same 12-function-cap reasoning as inbound above.
    override suspend fun getProspectingQueue(): List<ProspectingCandidate> {
        val json = get("/api/approvals?resource=prospecting")
        return json.getJSONArray("items").map { it.toProspectingCandidate() }
    }

    override suspend fun draftProspectingReply(id: String): ProspectingCandidate {
        val json = post("/api/approvals?resource=prospecting", JSONObject().put("action", "draft").put("id", id))
        return json.toProspectingCandidate()
    }

    override suspend fun openProspectingCandidate(id: String) {
        post("/api/approvals?resource=prospecting", JSONObject().put("action", "open").put("id", id))
    }

    override suspend fun markProspectingReplied(id: String, finalReply: String?, mentionsFillbook: Boolean?, usedLink: Boolean?): ProspectingCandidate {
        val body = JSONObject().put("action", "mark-replied").put("id", id)
        if (finalReply != null) body.put("finalReply", finalReply)
        if (mentionsFillbook != null) body.put("mentionsFillbook", mentionsFillbook)
        if (usedLink != null) body.put("usedLink", usedLink)
        val json = post("/api/approvals?resource=prospecting", body)
        return json.toProspectingCandidate()
    }

    override suspend fun markProspectingSkipped(id: String, reason: String?) {
        val body = JSONObject().put("action", "skip").put("id", id)
        if (reason != null) body.put("reason", reason)
        post("/api/approvals?resource=prospecting", body)
    }

    override suspend fun markProspectingNotRelevant(id: String) {
        post("/api/approvals?resource=prospecting", JSONObject().put("action", "not-relevant").put("id", id))
    }

    override suspend fun markProspectingAlreadyHandled(id: String) {
        post("/api/approvals?resource=prospecting", JSONObject().put("action", "already-handled").put("id", id))
    }

    private fun JSONObject.toStrategyItemList(key: String): List<StrategyItem> =
        getJSONArray(key).map { StrategyItem(label = it.optStringOrNull("topic") ?: it.getString("platform") + " / " + it.getString("assetType"), reason = it.getString("reason")) }

    private fun JSONObject.toStrategyVersion(): StrategyVersion = StrategyVersion(
        version = getInt("version"),
        generatedAt = getString("generatedAt"),
        topicsToIncrease = toStrategyItemList("topicsToIncrease"),
        topicsToDecrease = toStrategyItemList("topicsToDecrease"),
        contentToRetire = toStrategyItemList("contentToRetire"),
        formatsToTest = toStrategyItemList("formatsToTest"),
        seoOpportunities = getJSONArray("seoOpportunities").map {
            SeoOpportunity(topic = it.getString("topic"), velocity = it.getDouble("velocity"), hasExistingOpportunity = it.getBoolean("hasExistingOpportunity"))
        },
        creatorOpportunities = getJSONArray("creatorOpportunities").map {
            CreatorOpportunity(
                id = it.getString("id"),
                handle = it.getString("handle"),
                category = it.getString("category"),
                readinessScore = if (it.isNull("readinessScore")) null else it.getInt("readinessScore"),
                daysSinceLastInteraction = if (it.isNull("daysSinceLastInteraction")) null else it.getInt("daysSinceLastInteraction"),
            )
        },
        experimentsToRun = getJSONArray("experimentsToRun").map {
            ExperimentSuggestion(hypothesis = it.getString("hypothesis"), rationale = it.getString("rationale"))
        },
        summary = getString("summary"),
        lowConfidence = getBoolean("lowConfidence"),
    )

    // Folded into /api/summary (?resource=strategy) -- same 12-function-cap reasoning as inbound/prospecting above.
    override suspend fun getLatestStrategy(): StrategyVersion? {
        val json = get("/api/summary?resource=strategy")
        return json.optJSONObject("strategy")?.toStrategyVersion()
    }

    override suspend fun regenerateStrategy(): StrategyVersion {
        val json = post("/api/summary?resource=strategy", JSONObject())
        return json.getJSONObject("strategy").toStrategyVersion()
    }

    private fun JSONObject.toExperimentResult(): ExperimentResult? {
        if (isNull("result")) return null
        val r = getJSONObject("result")
        return ExperimentResult(
            controlRate = if (r.isNull("controlRate")) null else r.getDouble("controlRate"),
            treatmentRate = if (r.isNull("treatmentRate")) null else r.getDouble("treatmentRate"),
            absoluteDifference = if (r.isNull("absoluteDifference")) null else r.getDouble("absoluteDifference"),
            pValue = if (r.isNull("pValue")) null else r.getDouble("pValue"),
            isSignificant = r.getBoolean("isSignificant"),
            insufficientSample = r.getBoolean("insufficientSample"),
            controlSampleSize = r.getInt("controlSampleSize"),
            treatmentSampleSize = r.getInt("treatmentSampleSize"),
            interpretation = r.getString("interpretation"),
            computedAt = r.getString("computedAt"),
        )
    }

    private fun JSONObject.toExperiment(): Experiment {
        val scope = optJSONObject("scope")
        return Experiment(
            id = getString("id"),
            hypothesis = getString("hypothesis"),
            scopePlatform = scope?.optStringOrNull("platform"),
            scopeAssetType = scope?.optStringOrNull("assetType"),
            guardrailNote = optStringOrNull("guardrailNote"),
            status = getString("status"),
            startDate = getString("startDate"),
            endDate = optStringOrNull("endDate"),
            controlWindowStart = getString("controlWindowStart"),
            createdAt = getString("createdAt"),
            result = toExperimentResult(),
        )
    }

    // Folded into /api/summary (?resource=experiments) -- same 12-function-cap reasoning as strategy above.
    override suspend fun getExperiments(): List<Experiment> {
        val json = get("/api/summary?resource=experiments")
        return json.getJSONArray("experiments").map { it.toExperiment() }
    }

    override suspend fun createExperiment(hypothesis: String, scopePlatform: String?, scopeAssetType: String?, guardrailNote: String?, startDate: String, controlWindowDays: Int): Experiment {
        val scope = JSONObject()
        if (scopePlatform != null) scope.put("platform", scopePlatform)
        if (scopeAssetType != null) scope.put("assetType", scopeAssetType)
        val body = JSONObject()
            .put("hypothesis", hypothesis)
            .put("scope", scope)
            .put("startDate", startDate)
            .put("controlWindowDays", controlWindowDays)
        if (guardrailNote != null) body.put("guardrailNote", guardrailNote)
        val json = post("/api/summary?resource=experiments", body)
        return json.getJSONObject("experiment").toExperiment()
    }

    override suspend fun measureExperiment(id: String): Experiment {
        val json = post("/api/summary?resource=experiments", JSONObject().put("id", id).put("action", "measure"))
        return json.getJSONObject("experiment").toExperiment()
    }

    override suspend fun completeExperiment(id: String): Experiment {
        val json = post("/api/summary?resource=experiments", JSONObject().put("id", id).put("action", "complete"))
        return json.getJSONObject("experiment").toExperiment()
    }

    override suspend fun abortExperiment(id: String) {
        post("/api/summary?resource=experiments", JSONObject().put("id", id).put("action", "abort"))
    }

    private fun JSONObject.toAppNotification() = AppNotification(
        id = getString("id"),
        type = getString("type"),
        title = getString("title"),
        body = getString("body"),
        severity = getString("severity"),
        createdAt = getString("createdAt"),
        readAt = optStringOrNull("readAt"),
        relatedId = optStringOrNull("relatedId"),
    )

    override suspend fun getNotifications(): Pair<List<AppNotification>, Int> {
        val json = get("/api/summary?resource=notifications")
        val items = json.getJSONArray("notifications").map { it.toAppNotification() }
        return items to json.getInt("unreadCount")
    }

    override suspend fun markNotificationRead(id: String) {
        post("/api/summary?resource=notifications", JSONObject().put("id", id).put("action", "mark-read"))
    }

    override suspend fun markAllNotificationsRead() {
        post("/api/summary?resource=notifications", JSONObject().put("action", "mark-all-read"))
    }

    private fun JSONObject.toOpportunitySummary() = OpportunitySummary(
        id = getString("id"),
        title = getString("title"),
        score = getDouble("score"),
    )

    override suspend fun getMorningBrief(): MorningBrief {
        val json = get("/api/summary?resource=brief")
        return MorningBrief(
            generatedAt = json.getString("generatedAt"),
            signalsOvernight = json.getInt("signalsOvernight"),
            topNewOpportunities = json.getJSONArray("topNewOpportunities").map { it.toOpportunitySummary() },
            pendingApprovals = json.getInt("pendingApprovals"),
            inboundNeedsResponse = json.getInt("inboundNeedsResponse"),
            strategySummary = json.optStringOrNull("strategySummary"),
            unreadNotificationCount = json.getJSONArray("unreadNotifications").length(),
        )
    }

    override suspend fun getEveningReport(): EveningReport {
        val json = get("/api/summary?resource=evening-report")
        return EveningReport(
            generatedAt = json.getString("generatedAt"),
            assetsDrafted = json.getInt("assetsDrafted"),
            approvedToday = json.getInt("approvedToday"),
            rejectedToday = json.getInt("rejectedToday"),
            reviewPassRate = if (json.isNull("reviewPassRate")) null else json.getDouble("reviewPassRate"),
            costTodayUsd = json.getDouble("costTodayUsd"),
            inboundResolvedToday = json.getInt("inboundResolvedToday"),
            topOpportunity = json.optJSONObject("topOpportunity")?.toOpportunitySummary(),
        )
    }
}

/** [httpCode] lets callers tell an auth/config problem (401/500) apart from an unrelated server/network failure -- both used to surface as the same generic message before this existed. */
class NetworkException(message: String, val httpCode: Int? = null) : Exception(message)

/** Small helpers since org.json's JSONArray predates Kotlin collections. */
private fun <T> JSONArray.map(transform: (JSONObject) -> T): List<T> =
    (0 until length()).map { transform(getJSONObject(it)) }

private fun JSONArray.mapStrings(): List<String> =
    (0 until length()).map { getString(it) }

private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key) || !has(key)) null else getString(key)

private fun JSONObject.toIntMap(): Map<String, Int> =
    keys().asSequence().associateWith { key -> getInt(key) }

private fun JSONObject.toStringMap(): Map<String, String> =
    keys().asSequence().associateWith { key -> getString(key) }
