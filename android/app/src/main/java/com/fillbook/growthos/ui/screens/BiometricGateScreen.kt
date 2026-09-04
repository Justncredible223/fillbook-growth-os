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
import com.fillbook.growthos.ui.components.GhostButton
import com.fillbook.growthos.ui.components.PrimaryButton
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.SurfaceElevated
import com.fillbook.growthos.ui.theme.TextSecondary

private const val AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK

/**
 * True only when the device both has usable biometric hardware and has at
 * least one Face/Fingerprint actually enrolled -- anything else (no
 * hardware, hardware temporarily down, nothing enrolled) means a
 * biometric gate would just be a dead end, so callers fall back to the
 * plain saved-token flow instead of offering a toggle that can't work.
 */
fun canUseBiometrics(context: Context): Boolean =
    BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

/**
 * Gates an already-saved token behind a Face/Fingerprint check instead of
 * ever asking the owner to retype the access code again. This never
 * re-authenticates against the backend -- the token was already accepted
 * once at LoginScreen and is stored for good (see TokenStore); biometrics
 * here only decide whether THIS unlock proceeds to use it, the same model
 * as a banking app's local app-lock, not a second server-side login.
 */
@Composable
fun BiometricGateScreen(
    activity: FragmentActivity,
    onUnlocked: () -> Unit,
    onUseCodeInstead: () -> Unit,
) {
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
                    // Only an explicit tap on the prompt's own "Use access
                    // code instead" button means the owner actually wants to
                    // fall back and re-enter the code -- that's the sole
                    // trigger for wiping the saved token. ERROR_USER_CANCELED
                    // (and every other error/interruption: the screen
                    // locking mid-prompt, a notification stealing focus, the
                    // app backgrounding, an accidental back-press, or a
                    // failed Face/Fingerprint attempt the owner backed out
                    // of to retry) used to hit this same branch and destroy
                    // the token for no reason -- this was the actual cause
                    // of needing to dig up and retype the access code
                    // multiple times a day. Those cases now just leave the
                    // owner on this screen with "Try again", same as any
                    // normal app-lock.
                    if (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                        onUseCodeInstead()
                    } else {
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
            .setSubtitle("Confirm it's you to continue")
            .setNegativeButtonText("Use access code instead")
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
            GhostButton(text = "Use access code instead", onClick = onUseCodeInstead)
        }
    }
}
