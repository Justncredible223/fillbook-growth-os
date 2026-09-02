package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.NetworkException
import com.fillbook.growthos.data.NetworkGrowthOsRepository
import java.io.IOException
import com.fillbook.growthos.ui.components.PrimaryButton
import com.fillbook.growthos.ui.theme.AppTypography
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.OverlineStyle
import com.fillbook.growthos.ui.theme.TextSecondary
import kotlinx.coroutines.launch

/**
 * The gate the app never had: nothing past this screen loads without a
 * token the backend actually verifies (see backend/src/lib/
 * requireAppAuth.ts). "Continue" makes one real request with the entered
 * code and only proceeds if the backend accepts it -- a typo reads as
 * "that access code didn't work," not a generic network error. The name
 * field isn't a real account system, just enough identity to record who
 * approved/rejected a given draft when the app is shared (see migration
 * 0013_campaign_decision_audit.sql).
 *
 * The token itself is ALWAYS saved for good once accepted here (see
 * TokenStore) -- that part was never the friction. What this screen's
 * checkbox controls is only whether reopening the app later requires a
 * Face/Fingerprint check first (see BiometricGateScreen) before that saved
 * token gets used, versus no gate at all. Only shown when the device
 * actually has usable biometric hardware -- offering a toggle for
 * something that can't work is worse than not offering it.
 */
@Composable
fun LoginScreen(
    baseUrl: String,
    protectionBypassSecret: String,
    biometricAvailable: Boolean,
    onLoginSuccess: (token: String, displayName: String, requireBiometric: Boolean) -> Unit,
) {
    var token by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var requireBiometric by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun attemptLogin() {
        val candidateToken = token.trim()
        val candidateName = name.trim()
        if (candidateToken.isEmpty()) {
            error = "Enter your access code."
            return
        }
        if (candidateName.isEmpty()) {
            error = "Enter your name."
            return
        }
        loading = true
        error = null
        scope.launch {
            try {
                NetworkGrowthOsRepository(baseUrl, protectionBypassSecret, candidateToken).getHealth()
                onLoginSuccess(candidateToken, candidateName, biometricAvailable && requireBiometric)
            } catch (e: NetworkException) {
                // A wrong/missing token is the only case that's actually about the
                // access code (see backend/src/lib/requireAppAuth.ts) -- any other
                // HTTP status is a real server-side problem this message used to
                // misreport as "your code is wrong," sending people to re-type a
                // code that was never the issue.
                error = when (e.httpCode) {
                    401 -> "That access code didn't work. Check it and try again."
                    else -> "The server rejected the request (HTTP ${e.httpCode ?: "?"}). This may not be your access code -- check System status or try again shortly."
                }
            } catch (e: IOException) {
                error = "Couldn't reach Growth OS. Check your connection and try again."
            } finally {
                loading = false
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
        Column(modifier = Modifier.fillMaxWidth().padding(32.dp)) {
            Text("OPERATOR CONSOLE", style = OverlineStyle, color = Accent)
            Spacer(Modifier.height(6.dp))
            Text("Fillbook Growth OS", style = AppTypography.displayLarge)
            Text(
                "Enter your access code and name to continue.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                modifier = Modifier.padding(top = 6.dp, bottom = 24.dp),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it; error = null },
                label = { Text("Access code") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = name,
                onValueChange = { name = it; error = null },
                label = { Text("Your name") },
                singleLine = true,
                isError = error != null,
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = Danger, modifier = Modifier.padding(top = 8.dp))
            }
            if (biometricAvailable) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                ) {
                    Checkbox(
                        checked = requireBiometric,
                        onCheckedChange = { requireBiometric = it },
                        colors = CheckboxDefaults.colors(checkedColor = Accent),
                    )
                    Text(
                        "Require Face/Fingerprint to reopen the app",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary,
                    )
                }
                Text(
                    if (requireBiometric) "You'll never need to retype this code -- just unlock with biometrics next time."
                    else "Stay signed in with no prompt at all, even without biometrics.",
                    style = MaterialTheme.typography.labelMedium,
                    color = TextSecondary,
                    modifier = Modifier.padding(top = 4.dp, start = 40.dp),
                )
            }
            Spacer(Modifier.height(20.dp))
            PrimaryButton(
                text = "Continue",
                onClick = ::attemptLogin,
                enabled = !loading,
                busy = loading,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
