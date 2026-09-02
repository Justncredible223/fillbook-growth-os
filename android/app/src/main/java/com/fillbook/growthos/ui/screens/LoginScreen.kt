package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
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
 */
@Composable
fun LoginScreen(
    baseUrl: String,
    protectionBypassSecret: String,
    onLoginSuccess: (token: String, displayName: String) -> Unit,
) {
    var token by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
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
                onLoginSuccess(candidateToken, candidateName)
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
            Text("Fillbook Growth OS", style = MaterialTheme.typography.headlineLarge)
            Text(
                "Enter your access code and name to continue.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                modifier = Modifier.padding(top = 4.dp, bottom = 24.dp),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it; error = null },
                label = { Text("Access code") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
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
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = Danger, modifier = Modifier.padding(top = 8.dp))
            }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = ::attemptLogin,
                enabled = !loading,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (loading) {
                    CircularProgressIndicator(modifier = Modifier.height(18.dp), color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text("Continue")
                }
            }
        }
    }
}
