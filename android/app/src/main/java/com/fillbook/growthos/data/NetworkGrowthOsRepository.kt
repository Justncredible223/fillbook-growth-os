package com.fillbook.growthos.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

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
 * Unlike the Vercel bypass secret above, this one is never baked into the
 * source or the APK -- the user enters it once on LoginScreen and it's
 * kept in EncryptedSharedPreferences via TokenStore. Every request here
 * sends it as a standard Authorization: Bearer header; the backend
 * rejects anything that doesn't match its own APP_API_TOKEN env var.
 *
 * [deciderName] is the display name entered alongside the access code --
 * not a real account system, just enough to answer "who approved this"
 * when two people share the same phone/token (see migration
 * 0013_campaign_decision_audit.sql).
 */
class NetworkGrowthOsRepository(
    private val baseUrl: String,
    private val protectionBypassSecret: String,
    private val appToken: String,
    private val deciderName: String = "",
) : GrowthOsRepository {

    private val client = OkHttpClient()

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
                throw NetworkException("GET $path failed: HTTP ${response.code} -- $body")
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
                throw NetworkException("POST $path failed: HTTP ${response.code} -- $responseBody")
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
            )
        }
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
        val json = get("/api/cost-summary")
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
}

class NetworkException(message: String) : Exception(message)

/** Small helpers since org.json's JSONArray predates Kotlin collections. */
private fun <T> JSONArray.map(transform: (JSONObject) -> T): List<T> =
    (0 until length()).map { transform(getJSONObject(it)) }

private fun JSONArray.mapStrings(): List<String> =
    (0 until length()).map { getString(it) }

private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key) || !has(key)) null else getString(key)

private fun JSONObject.toIntMap(): Map<String, Int> =
    keys().asSequence().associateWith { key -> getInt(key) }
