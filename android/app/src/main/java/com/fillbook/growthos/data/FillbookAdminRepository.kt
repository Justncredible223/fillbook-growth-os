package com.fillbook.growthos.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Talks to the fillbookhq.com site's own admin API -- a different backend
 * and a different auth model than GrowthOsRepository (this project's own
 * Vercel app, gated by a static app token). This one needs a real,
 * per-request Supabase user session (see SupabaseAuthClient) because
 * /api/admin re-derives the caller's identity from the bearer token itself
 * and only lets OWNER_EMAIL through -- there's no separate app-level
 * secret to embed here.
 */
interface FillbookAdminRepository {
    val isSignedIn: Boolean
    suspend fun signIn(email: String, password: String)
    /** Browser URL for "Continue with Google"; the result comes back through AuthCallbackActivity. */
    fun beginGoogleSignIn(): String
    fun signOut()
    /** [period]: "today" | "7d" | "30d" | "90d" | "all" -- same values AdminGrowth.tsx's own period selector sends. */
    suspend fun getGrowthStats(period: String): GrowthStats
}

class NetworkFillbookAdminRepository(
    private val baseUrl: String,
    private val auth: SupabaseAuthClient,
) : FillbookAdminRepository {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    override val isSignedIn: Boolean get() = auth.isSignedIn

    override suspend fun signIn(email: String, password: String) = auth.signIn(email, password)

    override fun beginGoogleSignIn(): String = auth.beginGoogleSignIn(AppConfig.OAUTH_REDIRECT_URI)

    override fun signOut() = auth.signOut()

    override suspend fun getGrowthStats(period: String): GrowthStats = withContext(Dispatchers.IO) {
        val accessToken = auth.getValidAccessToken()
        val request = Request.Builder()
            .url("$baseUrl/api/admin?action=growth&period=$period")
            .header("Authorization", "Bearer $accessToken")
            // fillbookhq.com's middleware.ts blocks the default "okhttp/x" agent as a scraper ("Access denied").
            .header("User-Agent", USER_AGENT)
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string() ?: "{}"
            if (!response.isSuccessful) {
                val reason = runCatching { JSONObject(body).optString("error").ifBlank { null } }.getOrNull() ?: body.take(200)
                throw NetworkException("fillbookhq.com refused the stats request (HTTP ${response.code}): $reason", response.code)
            }
            val json = JSONObject(body)
            val metrics = json.getJSONObject("metrics")
            val funnel = json.getJSONObject("funnel")
            GrowthStats(
                period = json.optString("period", period),
                visitors = metrics.getInt("visitors"),
                signups = metrics.getInt("signups"),
                signupStarted = metrics.getInt("signupStarted"),
                activated = metrics.getInt("activated"),
                newSubscribers = metrics.getInt("newSubscribers"),
                cancellations = metrics.getInt("cancellations"),
                // Ordered as AdminGrowth.tsx's own funnel display shows them,
                // not JSONObject.keys() iteration order (unspecified in
                // org.json). optDoubleOrNull mirrors admin.ts's own pct():
                // null (not 0.0) means "not enough data," never masked as a
                // real zero.
                funnel = listOf(
                    "Visitor -> signup" to funnel.optDoubleOrNull("visitorToSignup"),
                    "Signup started -> completed" to funnel.optDoubleOrNull("signupStartedToCompleted"),
                    "Signup -> first trade" to funnel.optDoubleOrNull("signupToFirstTrade"),
                    "First trade -> 5 trades" to funnel.optDoubleOrNull("firstTradeToFiveTrades"),
                    "5 trades -> first insight" to funnel.optDoubleOrNull("fiveTradesToFirstInsight"),
                    "First insight -> pricing" to funnel.optDoubleOrNull("firstInsightToPricing"),
                    "Pricing -> checkout" to funnel.optDoubleOrNull("pricingToCheckout"),
                    "Checkout -> paid" to funnel.optDoubleOrNull("checkoutToPaid"),
                ),
            )
        }
    }
}

internal const val USER_AGENT = "FillbookGrowthOS/1.0 (Android)"

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (isNull(key) || !has(key)) null else getDouble(key)
