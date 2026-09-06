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

    /**
     * Same fix as generatePartnershipDraft's own 404-body parsing (see
     * extractPartnershipActionErrorMessage's docstring) -- confirmed on
     * inspection that draftProspectingReply/draftInboundResponse had never
     * received it: a thrown ProspectingActionError/InboundActionError
     * (e.g. the reply guardrail rejecting a banned phrase or unverified
     * claim) converts into an HTTP 404 with a real, actionable
     * `{error: message}` body, but without this, it fell through as a bare
     * NetworkException -- ProspectingScreen/InboundScreen's generic
     * `catch (e: Exception)` has no specific handler for that, so it
     * silently became "Couldn't draft a reply. Check your connection and
     * try again.", hiding the real reason the owner needed to see.
     */
    private suspend fun postExpectingDraftRejection(path: String, jsonBody: JSONObject): JSONObject =
        try {
            post(path, jsonBody)
        } catch (e: NetworkException) {
            val parsedError = extractPartnershipActionErrorMessage(e.httpCode, e.message)
            if (parsedError != null) throw DraftRejectedException(parsedError)
            throw e
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
            todayXPost = json.optJSONObject("todayXPost").toTodayXPost(),
        )
    }

    /** Shared parsing for GET /api/summary's embedded todayXPost and the x-feed-post resource's own responses -- same shape from both. */
    private fun JSONObject?.toTodayXPost(): TodayXPost {
        if (this == null) return TodayXPost(TodayXPostState.EMPTY, null, null)
        return TodayXPost(
            state = runCatching { TodayXPostState.valueOf(getString("state").uppercase()) }.getOrDefault(TodayXPostState.EMPTY),
            campaignAssetId = optStringOrNull("campaignAssetId"),
            previewText = optStringOrNull("previewText"),
            topicLabel = optStringOrNull("topicLabel"),
            reason = optStringOrNull("reason"),
            selectionReason = optStringOrNull("selectionReason"),
            canRegenerate = optBoolean("canRegenerate", false),
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

    override suspend fun regenerateTodayXPost(): TodayXPost {
        val json = post("/api/summary?resource=x-feed-post", JSONObject().put("action", "regenerate"))
        return json.optJSONObject("todayXPost").toTodayXPost()
    }

    override suspend fun markTodayXPostPosted(campaignAssetId: String, postedText: String): TodayXPost {
        val body = JSONObject().put("action", "mark-posted").put("campaignAssetId", campaignAssetId).put("postedText", postedText)
        val json = post("/api/summary?resource=x-feed-post", body)
        return json.optJSONObject("todayXPost").toTodayXPost()
    }

    override suspend fun getTodayXPostHistory(): List<XFeedPostHistoryEntry> {
        val json = get("/api/summary?resource=x-feed-post-history")
        return json.getJSONArray("entries").map { item ->
            XFeedPostHistoryEntry(
                operatingDate = item.getString("operatingDate"),
                state = runCatching { XFeedPostHistoryState.valueOf(item.getString("state").uppercase()) }
                    .getOrDefault(XFeedPostHistoryState.FAILED),
                topicLabel = item.optStringOrNull("topicLabel"),
                previewText = item.optStringOrNull("previewText"),
                reason = item.optStringOrNull("reason"),
                campaignAssetId = item.optStringOrNull("campaignAssetId"),
            )
        }
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
        val json = postExpectingDraftRejection("/api/approvals?resource=inbound", JSONObject().put("action", "draft").put("id", id))
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
        val json = postExpectingDraftRejection("/api/approvals?resource=prospecting", JSONObject().put("action", "draft").put("id", id))
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

    private fun JSONObject.toPartnershipProspect(): PartnershipProspect {
        val socialLinksObj = optJSONObject("socialLinks")
        val socialLinks = mutableMapOf<String, String>()
        socialLinksObj?.keys()?.forEach { key -> socialLinks[key] = socialLinksObj.getString(key) }
        return PartnershipProspect(
            id = getString("id"),
            organizationName = getString("organizationName"),
            contactName = optStringOrNull("contactName"),
            partnerCategory = runCatching { PartnerCategory.valueOf(getString("partnerCategory").uppercase()) }.getOrDefault(PartnerCategory.OTHER),
            stage = runCatching { PartnershipStage.valueOf(getString("stage").uppercase()) }.getOrDefault(PartnershipStage.PROSPECT),
            websiteUrl = optStringOrNull("websiteUrl"),
            socialLinks = socialLinks,
            contactRoute = optStringOrNull("contactRoute"),
            contactRouteSource = optStringOrNull("contactRouteSource"),
            audienceFocus = optStringOrNull("audienceFocus"),
            futuresRelevanceEvidence = optStringOrNull("futuresRelevanceEvidence"),
            sourceUrls = optJSONArray("sourceUrls")?.mapStrings() ?: emptyList(),
            researchDate = optStringOrNull("researchDate"),
            competingJournalRelationships = optStringOrNull("competingJournalRelationships"),
            competingJournalEvidence = optStringOrNull("competingJournalEvidence"),
            proposedCollaboration = optStringOrNull("proposedCollaboration"),
            qualificationRationale = optStringOrNull("qualificationRationale"),
            ownerNotes = optStringOrNull("ownerNotes"),
            nextAction = optStringOrNull("nextAction"),
            nextActionDueDate = optStringOrNull("nextActionDueDate"),
            pilotTermsProposed = optStringOrNull("pilotTermsProposed"),
            pilotTermsAgreed = optStringOrNull("pilotTermsAgreed"),
            pilotStartDate = optStringOrNull("pilotStartDate"),
            pilotEndDate = optStringOrNull("pilotEndDate"),
            followUpCount = optInt("followUpCount", 0),
            approvedCampaignAssetId = optStringOrNull("approvedCampaignAssetId"),
            previewText = optStringOrNull("previewText"),
            contactedAt = optStringOrNull("contactedAt"),
            contactedChannel = optStringOrNull("contactedChannel"),
            discoveryScore = if (isNull("discoveryScore")) null else optDouble("discoveryScore").toInt(),
            discoveryConfidence = optStringOrNull("discoveryConfidence"),
            discoveredVia = optString("discoveredVia", "manual"),
            suppressedReason = optStringOrNull("suppressedReason"),
        )
    }

    private fun JSONObject.toDiscoveryRunResult(): PartnershipDiscoveryRunResult = PartnershipDiscoveryRunResult(
        status = getString("status"),
        newCandidates = optInt("newCandidates", 0),
        sourcesSearched = optJSONArray("sourcesSearched")?.mapStrings() ?: emptyList(),
        costUsd = optDouble("costUsd", 0.0),
        error = optStringOrNull("error"),
        skipReason = optStringOrNull("skipReason"),
    )

    override suspend fun getPartnerships(): PartnershipsSummary {
        val json = get("/api/approvals?resource=partnerships")
        val items = json.getJSONArray("items").map { it.toPartnershipProspect() }
        val lastRun = json.optJSONObject("lastDiscoveryRun")?.toDiscoveryRunResult()
        return PartnershipsSummary(items, lastRun)
    }

    override suspend fun refreshPartnershipDiscovery(): PartnershipDiscoveryRunResult {
        val json = post("/api/approvals?resource=partnerships", JSONObject().put("action", "refresh-discovery"))
        return json.toDiscoveryRunResult()
    }

    override suspend fun createPartnership(organizationName: String, contactName: String?, partnerCategory: PartnerCategory, websiteUrl: String?, proposedCollaboration: String?): PartnershipProspect {
        val body = JSONObject()
            .put("action", "create")
            .put("organizationName", organizationName)
            .put("partnerCategory", partnerCategory.name.lowercase())
        if (contactName != null) body.put("contactName", contactName)
        if (websiteUrl != null) body.put("websiteUrl", websiteUrl)
        if (proposedCollaboration != null) body.put("proposedCollaboration", proposedCollaboration)
        return post("/api/approvals?resource=partnerships", body).toPartnershipProspect()
    }

    override suspend fun updatePartnership(id: String, ownerNotes: String?, nextAction: String?, nextActionDueDate: String?, contactRoute: String?, contactRouteSource: String?, audienceFocus: String?, futuresRelevanceEvidence: String?): PartnershipProspect {
        val body = JSONObject().put("action", "update").put("id", id)
        ownerNotes?.let { body.put("ownerNotes", it) }
        nextAction?.let { body.put("nextAction", it) }
        nextActionDueDate?.let { body.put("nextActionDueDate", it) }
        contactRoute?.let { body.put("contactRoute", it) }
        contactRouteSource?.let { body.put("contactRouteSource", it) }
        audienceFocus?.let { body.put("audienceFocus", it) }
        futuresRelevanceEvidence?.let { body.put("futuresRelevanceEvidence", it) }
        return post("/api/approvals?resource=partnerships", body).toPartnershipProspect()
    }

    override suspend fun qualifyPartnership(id: String, rationale: String): PartnershipProspect =
        post("/api/approvals?resource=partnerships", JSONObject().put("action", "qualify").put("id", id).put("rationale", rationale)).toPartnershipProspect()

    override suspend fun generatePartnershipDraft(id: String): PartnershipProspect {
        val result =
            try {
                post("/api/approvals?resource=partnerships", JSONObject().put("action", "generate-draft").put("id", id))
            } catch (e: NetworkException) {
                // approvals.ts converts a thrown PartnershipActionError into an
                // HTTP 404 with a real, actionable {error: message} body (e.g.
                // the evidence-insufficiency guard, or the generation_claimed_at
                // duplicate-request mutex rejection) -- BEFORE this fix, that
                // fell through as a bare NetworkException, which
                // PartnershipsScreen's catch block has no specific handler for,
                // so it silently became the generic "Couldn't complete that
                // action. Check your connection and try again." -- hiding the
                // real, useful reason the owner actually needed to see (add
                // more evidence; wait for the in-flight generation to finish).
                // Confirmed by tracing this exact path end-to-end while
                // verifying this round's new error messages on-device.
                val parsedError = extractPartnershipActionErrorMessage(e.httpCode, e.message)
                if (parsedError != null) throw PartnershipDraftRejectedException(shortReason = parsedError)
                throw e
            }
        // "failed" (didn't pass the mechanical/review gates) and "skipped" (budget
        // exhausted) are real, meaningful outcomes the owner needs to actually see
        // -- not a connection problem, and not something to silently discard.
        // Thrown here (rather than swallowed) so PartnershipsScreen's existing
        // error-display path shows the real reason instead of a generic message.
        when (result.optString("status")) {
            "failed" -> {
                val attempts = result.optInt("attempts", 1)
                throw PartnershipDraftRejectedException(
                    shortReason = "Didn't pass review after $attempts attempt${if (attempts == 1) "" else "s"} -- needs stronger, more specific personalization for this recipient.",
                    details = result.optString("error", "no details returned"),
                )
            }
            "skipped" -> throw PartnershipDraftRejectedException(
                shortReason = "Draft generation skipped -- this month's Partnerships budget is used up.",
                details = result.optString("skipReason", "no details returned"),
            )
        }
        // The generate-draft response is a lightweight result (status/cost), not the full prospect shape --
        // re-fetch this one prospect's real current state (including the new previewText) from the list.
        return getPartnerships().items.first { it.id == id }
    }

    override suspend fun markPartnershipContacted(id: String, channel: String, finalText: String): PartnershipProspect =
        post("/api/approvals?resource=partnerships", JSONObject().put("action", "mark-contacted").put("id", id).put("channel", channel).put("finalText", finalText)).toPartnershipProspect()

    override suspend fun recordPartnershipReply(id: String, summary: String): PartnershipProspect =
        post("/api/approvals?resource=partnerships", JSONObject().put("action", "record-reply").put("id", id).put("summary", summary)).toPartnershipProspect()

    override suspend fun startPartnershipPilot(id: String, termsAgreed: String, startDate: String): PartnershipProspect =
        post("/api/approvals?resource=partnerships", JSONObject().put("action", "start-pilot").put("id", id).put("termsAgreed", termsAgreed).put("startDate", startDate)).toPartnershipProspect()

    override suspend fun activatePartnership(id: String): PartnershipProspect =
        post("/api/approvals?resource=partnerships", JSONObject().put("action", "activate").put("id", id)).toPartnershipProspect()

    override suspend fun closePartnership(id: String, reason: String): PartnershipProspect =
        post("/api/approvals?resource=partnerships", JSONObject().put("action", "close").put("id", id).put("reason", reason)).toPartnershipProspect()

    override suspend fun archivePartnership(id: String, reason: String): PartnershipProspect =
        post("/api/approvals?resource=partnerships", JSONObject().put("action", "archive").put("id", id).put("reason", reason)).toPartnershipProspect()

    override suspend fun markPartnershipDoNotContact(id: String, reason: String): PartnershipProspect =
        post("/api/approvals?resource=partnerships", JSONObject().put("action", "do-not-contact").put("id", id).put("reason", reason)).toPartnershipProspect()

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

/**
 * Pure, unit-testable extraction of the real actionable message
 * approvals.ts sends back when it catches a thrown PartnershipActionError
 * (evidence-insufficiency, the generation_claimed_at duplicate-request
 * mutex) -- it converts that into an HTTP 404 with a JSON `{error: string}`
 * body (see approvals.ts's own catch block), which post()'s generic
 * failure path wraps into `NetworkException("POST $path failed: HTTP 404 --
 * $responseBody", 404)`. Before this existed, that whole message fell
 * through PartnershipsScreen's catch-all as a bare NetworkException,
 * silently replacing the real reason with "Couldn't complete that action.
 * Check your connection and try again." -- confirmed by tracing this exact
 * path while verifying this round's new error messages on-device. Returns
 * null (never throws) for anything that isn't this specific shape, so a
 * genuine network/auth failure still surfaces as NetworkException.
 */
// Deliberately a hand-rolled regex, not JSONObject -- org.json is an
// unmocked Android stub under a plain JVM unit test (no Robolectric in
// this project), so a real parse here would silently return null in every
// test and only work on-device. approvals.ts's error bodies are always a
// single flat `{"error": "..."}` (see its catch block), so this is a
// bounded, safe simplification, not a general JSON parser.
private val ERROR_FIELD_PATTERN = Regex(""""error"\s*:\s*"((?:[^"\\]|\\.)*)"""")

private fun unescapeJsonString(s: String): String =
    s.replace("\\\"", "\"").replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t").replace("\\\\", "\\")

fun extractPartnershipActionErrorMessage(httpCode: Int?, networkExceptionMessage: String?): String? {
    if (httpCode != 404) return null
    val body = networkExceptionMessage?.substringAfter(" -- ", missingDelimiterValue = "") ?: return null
    if (body.isBlank()) return null
    val raw = ERROR_FIELD_PATTERN.find(body)?.groupValues?.get(1) ?: return null
    val error = unescapeJsonString(raw)
    return error.takeIf { it.isNotBlank() }
}

/**
 * A real, meaningful outcome from generate-draft (failed review/mechanical
 * gate, or budget exhaustion) -- distinct from NetworkException so callers
 * never mistake a legitimate content-quality rejection for a connectivity
 * problem. [shortReason] is a plain-language one-liner for the primary
 * error display; [details] is the full raw reviewer/skip text, shown only
 * behind an explicit "Show details" disclosure -- the real per-agent
 * critique is long and technical (confirmed on a real device: nine
 * reviewers' full reasoning at once is a wall of text), not something to
 * dump on the owner by default.
 */
class PartnershipDraftRejectedException(val shortReason: String, val details: String? = null) : Exception(shortReason)

/**
 * Same real-outcome-not-a-connectivity-problem distinction as
 * PartnershipDraftRejectedException above, for Prospecting's and Inbound's
 * draft-reply actions -- e.g. the mechanical reply guardrail (banned
 * generic phrase, an unverified claim, an undeclared link) rejecting a
 * draft before it's ever persisted. Kept as its own, more generically
 * named type rather than reusing the Partnership-named one.
 */
class DraftRejectedException(val shortReason: String) : Exception(shortReason)

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
