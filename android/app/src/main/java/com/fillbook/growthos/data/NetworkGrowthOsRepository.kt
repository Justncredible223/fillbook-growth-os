package com.fillbook.growthos.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
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
 */
class NetworkGrowthOsRepository(
    private val baseUrl: String,
    private val protectionBypassSecret: String,
) : GrowthOsRepository {

    private val client = OkHttpClient()

    private suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("x-vercel-protection-bypass", protectionBypassSecret)
            .header("x-vercel-set-bypass-cookie", "true")
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string() ?: "{}"
            if (!response.isSuccessful) {
                throw NetworkException("GET $path failed: HTTP ${response.code} -- $body")
            }
            JSONObject(body)
        }
    }

    override suspend fun getHomeSummary(): HomeSummary {
        val json = get("/api/summary")
        return HomeSummary(
            signalsAnalyzedToday = json.getInt("signalsAnalyzedToday"),
            opportunitiesFound = json.getInt("opportunitiesFound"),
            assetsReady = json.getInt("assetsReady"),
            pendingReview = json.getInt("pendingReview"),
            systemPaused = json.getBoolean("systemPaused"),
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
            )
        }
    }
}

class NetworkException(message: String) : Exception(message)

/** Small helpers since org.json's JSONArray predates Kotlin collections. */
private fun <T> JSONArray.map(transform: (JSONObject) -> T): List<T> =
    (0 until length()).map { transform(getJSONObject(it)) }

private fun JSONArray.mapStrings(): List<String> =
    (0 until length()).map { getString(it) }
