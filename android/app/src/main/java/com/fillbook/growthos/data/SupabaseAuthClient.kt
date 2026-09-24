package com.fillbook.growthos.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Minimal Supabase email/password auth, talking directly to Supabase's own
 * REST auth endpoints (no supabase-kt dependency -- this app has no
 * existing Supabase client, and the two calls this needs, password grant
 * and refresh-token grant, are a small, stable surface not worth a whole
 * SDK for). This is a SEPARATE credential from AppConfig's PROTECTION_
 * BYPASS_SECRET/APP_TOKEN -- those gate THIS app's own Vercel backend;
 * this is a real Supabase user session for the fillbookhq.com site's
 * project, required because that site's /api/admin re-derives the
 * caller's identity from this exact token (see requireAdmin() in
 * frontend/api/_lib/adminAuth.ts) and only OWNER_EMAIL passes.
 *
 * The owner's password is never stored -- only the access/refresh tokens
 * Supabase issues after a successful sign-in, in EncryptedSharedPreferences
 * (already a dependency here for BiometricGateScreen, just not previously
 * used for token storage).
 */
class SupabaseAuthClient(
    private val supabaseUrl: String,
    private val supabaseAnonKey: String,
    context: Context,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "fillbook_admin_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private fun storeSession(json: JSONObject) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, json.getString("access_token"))
            .putString(KEY_REFRESH_TOKEN, json.getString("refresh_token"))
            // expires_at is Supabase's own unix-seconds field, already
            // absolute -- no need to add a duration to "now" ourselves.
            .putLong(KEY_EXPIRES_AT, json.getLong("expires_at"))
            .apply()
    }

    val isSignedIn: Boolean get() = prefs.getString(KEY_REFRESH_TOKEN, null) != null

    fun signOut() {
        prefs.edit().clear().apply()
    }

    suspend fun signIn(email: String, password: String): Unit = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email).put("password", password)
        val request = Request.Builder()
            .url("$supabaseUrl/auth/v1/token?grant_type=password")
            .header("apikey", supabaseAnonKey)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string() ?: "{}"
            if (!response.isSuccessful) {
                // Supabase's own error body is {"error":"...", "error_description":"..."} --
                // surfaced directly rather than a generic "sign-in failed" so a wrong
                // password or an unconfirmed email shows the real reason.
                val reason = runCatching { JSONObject(responseBody).optString("error_description") }.getOrNull()
                throw NetworkException("Sign-in failed: HTTP ${response.code}${reason?.let { " -- $it" } ?: ""}", response.code)
            }
            storeSession(JSONObject(responseBody))
        }
    }

    private suspend fun refresh(): String = withContext(Dispatchers.IO) {
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null)
            ?: throw NetworkException("Not signed in.", null)
        val body = JSONObject().put("refresh_token", refreshToken)
        val request = Request.Builder()
            .url("$supabaseUrl/auth/v1/token?grant_type=refresh_token")
            .header("apikey", supabaseAnonKey)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string() ?: "{}"
            if (!response.isSuccessful) {
                // A refresh token is only ever rejected because it's been revoked/expired --
                // clear the stored session so the caller re-prompts sign-in instead of
                // retrying a refresh that will just fail again every time.
                signOut()
                throw NetworkException("Session expired -- sign in again.", response.code)
            }
            val json = JSONObject(responseBody)
            storeSession(json)
            json.getString("access_token")
        }
    }

    /**
     * A valid access token, refreshing first if the cached one is expired
     * or about to be (60s margin against clock skew / request latency).
     * Throws (never returns null) when there's no session at all -- callers
     * that can be shown a sign-in prompt should catch that, not treat it
     * like a transient network failure.
     */
    suspend fun getValidAccessToken(): String {
        val expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L)
        val cached = prefs.getString(KEY_ACCESS_TOKEN, null)
        val nowSeconds = System.currentTimeMillis() / 1000
        if (cached != null && expiresAt - nowSeconds > 60) return cached
        return refresh()
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_EXPIRES_AT = "expires_at"
    }
}
