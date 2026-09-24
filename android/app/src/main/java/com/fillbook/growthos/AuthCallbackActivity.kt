package com.fillbook.growthos

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Receives com.fillbook.growthos://auth-callback from the browser after "Continue with Google" and hands it to
 * the app's existing MainActivity. A separate, invisible activity because the browser launches this link in its own
 * task; forwarding with CLEAR_TOP/SINGLE_TOP brings back the running app instead of stacking a second copy.
 */
class AuthCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                action = ACTION_OAUTH_CALLBACK
                data = intent?.data
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
        )
        finish()
    }

    companion object {
        const val ACTION_OAUTH_CALLBACK = "com.fillbook.growthos.OAUTH_CALLBACK"
    }
}
