package com.fillbook.growthos.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
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
                val reason = supabaseErrorReason(responseBody)
                val hint = if (response.code == 400) " If you normally use \"Continue with Google\" on fillbookhq.com, set a password there first via \"Forgot password\"." else ""
                throw NetworkException("Sign-in failed: ${reason ?: "HTTP ${response.code}"}.$hint", response.code)
            }
            storeSession(JSONObject(responseBody))
        }
    }

    /**
     * Starts "Continue with Google" using Supabase's PKCE flow: the verifier stays on this device and only its
     * SHA-256 challenge goes into the browser URL, so an intercepted redirect code is useless without it.
     */
    fun beginGoogleSignIn(redirectUri: String): String {
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        prefs.edit().putString(KEY_PKCE_VERIFIER, verifier).apply()
        return googleAuthorizeUrl(supabaseUrl, redirectUri, pkceChallenge(verifier))
    }

    suspend fun completeOAuthSignIn(authCode: String): Unit = withContext(Dispatchers.IO) {
        val verifier = prefs.getString(KEY_PKCE_VERIFIER, null)
            ?: throw NetworkException("Google sign-in expired -- tap Continue with Google again.", null)
        val body = JSONObject().put("auth_code", authCode).put("code_verifier", verifier)
        val request = Request.Builder()
            .url("$supabaseUrl/auth/v1/token?grant_type=pkce")
            .header("apikey", supabaseAnonKey)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string() ?: "{}"
            prefs.edit().remove(KEY_PKCE_VERIFIER).apply()
            if (!response.isSuccessful) {
                throw NetworkException("Google sign-in failed: ${supabaseErrorReason(responseBody) ?: "HTTP ${response.code}"}.", response.code)
            }
            storeSession(JSONObject(responseBody))
        }
    }

    private suspend fun refresh(): String = withContext(Dispatchers.IO) {
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null)
            ?: throw SignInRequiredException("Sign in to load site statistics.")
        val body = JSONObject().put("refresh_token", refreshToken)
        val request = Request.Builder()
            .url("$supabaseUrl/auth/v1/token?grant_type=refresh_token")
            .header("apikey", supabaseAnonKey)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string() ?: "{}"
            if (response.code in 400..499) {
                // Supabase rejected the refresh token itself (revoked, expired, or already rotated): the session is over.
                signOut()
                throw SignInRequiredException("Your session ended (${supabaseErrorReason(responseBody) ?: "HTTP ${response.code}"}). Sign in again.")
            }
            if (!response.isSuccessful) {
                // A server or network problem says nothing about the session -- keep it and let the caller retry.
                throw NetworkException("Couldn't refresh the session (HTTP ${response.code}). Try again.", response.code)
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
        cachedValidToken()?.let { return it }
        // One refresh at a time across every client instance: Supabase rotates the refresh token, so a second,
        // concurrent refresh with the old token would fail and sign the owner out.
        return refreshLock.withLock { cachedValidToken() ?: refresh() }
    }

    private fun cachedValidToken(): String? {
        val expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L)
        val cached = prefs.getString(KEY_ACCESS_TOKEN, null)
        val nowSeconds = System.currentTimeMillis() / 1000
        return if (cached != null && expiresAt - nowSeconds > 60) cached else null
    }

    companion object {
        private val refreshLock = Mutex()
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_EXPIRES_AT = "expires_at"
        private const val KEY_PKCE_VERIFIER = "pkce_verifier"
    }
}

/** Current Supabase Auth returns {"error_code","msg"}; older versions {"error","error_description"}. */
internal fun supabaseErrorReason(responseBody: String): String? = runCatching {
    val json = JSONObject(responseBody)
    listOf("msg", "error_description", "message").map { json.optString(it) }.firstOrNull { it.isNotBlank() }
}.getOrNull()

internal fun pkceChallenge(verifier: String): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

internal fun googleAuthorizeUrl(supabaseUrl: String, redirectUri: String, challenge: String): String {
    fun enc(v: String) = URLEncoder.encode(v, "UTF-8")
    return "$supabaseUrl/auth/v1/authorize?provider=google&redirect_to=${enc(redirectUri)}" +
        "&code_challenge=${enc(challenge)}&code_challenge_method=s256"
}

/** The stored session is missing or was rejected by Supabase: the UI should show sign-in, not a retryable error. */
class SignInRequiredException(message: String) : Exception(message)
