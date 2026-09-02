package com.fillbook.growthos.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The one thing standing between this app and the backend now, instead
 * of a static bypass secret baked into the source (see git history prior
 * to this file, and NetworkGrowthOsRepository's kdoc). Stored in
 * EncryptedSharedPreferences (AES256-GCM, key in the Android Keystore) so
 * it survives app restarts but never sits in plaintext on disk the way a
 * hardcoded string in the APK effectively does.
 */
class TokenStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "growth_os_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    /** The name entered at login -- purely local identity for the decided_by audit column, not a real account system. */
    fun getDisplayName(): String? = prefs.getString(KEY_DISPLAY_NAME, null)

    fun saveDisplayName(name: String) {
        prefs.edit().putString(KEY_DISPLAY_NAME, name).apply()
    }

    fun clearToken() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_DISPLAY_NAME).remove(KEY_BIOMETRIC_LOCK).apply()
    }

    /**
     * Whether reopening the app should require a Face/Fingerprint check
     * before using the already-saved token. Defaults to true (once
     * hardware supports it): the token was already going to stay signed
     * in forever the moment it's saved, so the actual choice this
     * controls is "gate that with a biometric check" vs "no gate at all" --
     * not whether the session persists, which it always does.
     */
    fun isBiometricLockEnabled(): Boolean = prefs.getBoolean(KEY_BIOMETRIC_LOCK, true)

    fun setBiometricLockEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_BIOMETRIC_LOCK, enabled).apply()
    }

    companion object {
        private const val KEY_TOKEN = "app_api_token"
        private const val KEY_DISPLAY_NAME = "display_name"
        private const val KEY_BIOMETRIC_LOCK = "biometric_lock_enabled"
    }
}
