package com.fillbook.growthos.ui.screens

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.fillbook.growthos.ui.components.PrimaryButton
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.SurfaceElevated
import com.fillbook.growthos.ui.theme.TextSecondary

/**
 * The ONLY sign-in this app has: the phone's own lock -- fingerprint,
 * face, or PIN/pattern/password -- via Android's own BiometricPrompt with
 * both BIOMETRIC_STRONG and DEVICE_CREDENTIAL allowed. There is no
 * separate app-level access code to type or lose; the actual API token
 * that authorizes requests server-side is a fixed value compiled into
 * the app (see MainActivity's APP_TOKEN, same trust tier as the existing
 * Vercel protection-bypass secret), never something the owner has to
 * remember or re-enter. If the device has no lock screen configured at
 * all, [canUseDeviceLock] returns false and the caller skips this gate
 * entirely rather than blocking access with a check that can't work.
 */
private const val AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL

fun canUseDeviceLock(context: Context): Boolean =
    BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

@Composable
fun BiometricGateScreen(activity: FragmentActivity, onUnlocked: () -> Unit) {
    var error by remember { mutableStateOf<String?>(null) }

    fun prompt() {
        error = null
        val biometricPrompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onUnlocked()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Any cancellation/interruption (screen locking mid-
                    // prompt, a notification stealing focus, the app
                    // backgrounding, pressing back) just leaves the owner
                    // here with "Try again" -- there is no separate code
                    // to fall back to anymore, so there is nothing to
                    // silently wipe or lose.
                    if (errorCode != BiometricPrompt.ERROR_USER_CANCELED && errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                        error = errString.toString()
                    }
                }

                override fun onAuthenticationFailed() {
                    error = "Not recognized. Try again."
                }
            },
        )
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Growth OS")
            .setSubtitle("Use your fingerprint, face, or device PIN")
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build()
        biometricPrompt.authenticate(promptInfo)
    }

    LaunchedEffect(Unit) { prompt() }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
            Box(
                modifier = Modifier.size(72.dp).background(SurfaceElevated, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Fingerprint, contentDescription = null, tint = Accent, modifier = Modifier.size(32.dp))
            }
            Spacer(Modifier.height(16.dp))
            Text("Fillbook Growth OS", style = MaterialTheme.typography.headlineSmall)
            Text("Locked -- confirm it's you", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = Danger, modifier = Modifier.padding(top = 12.dp))
            }
            PrimaryButton(text = "Try again", onClick = ::prompt, modifier = Modifier.padding(top = 20.dp))
        }
    }
}
