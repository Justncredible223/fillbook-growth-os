package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.FillbookAdminRepository
import com.fillbook.growthos.data.GrowthStats
import com.fillbook.growthos.data.authErrorMessage
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextTertiary
import kotlinx.coroutines.launch

private val PERIODS = listOf("today", "7d", "30d", "90d", "all")
private fun periodLabel(p: String) = when (p) { "today" -> "Today"; "7d" -> "7d"; "30d" -> "30d"; "90d" -> "90d"; else -> "All" }

/**
 * Fillbook Stats: the fillbookhq.com site's own owner-only growth
 * dashboard (AdminGrowth.tsx), surfaced here too so the owner doesn't need
 * to switch to a browser to check it. Talks directly to that site's
 * /api/admin, not to this project's own backend -- see
 * FillbookAdminRepository's kdoc. Requires a real Supabase sign-in as the
 * owner account the first time (or after a very long absence); after that
 * the session refreshes silently.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FillbookStatsScreen(repo: FillbookAdminRepository) {
    var signedIn by remember { mutableStateOf(repo.isSignedIn) }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Fillbook Stats",
            "The same growth numbers as fillbookhq.com's own admin dashboard.",
            kicker = "Site statistics",
        )
        if (!signedIn) {
            FillbookSignInForm(repo, onSignedIn = { signedIn = true })
        } else {
            FillbookStatsBody(repo, onSignedOut = { signedIn = false })
        }
    }
}

@Composable
private fun FillbookSignInForm(repo: FillbookAdminRepository, onSignedIn: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var signingIn by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(modifier = Modifier.padding(20.dp)) {
        Text(
            "Sign in with the fillbookhq.com owner account (justwilliams407@gmail.com) to load site statistics.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextTertiary,
        )
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        errorMessage?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = Danger)
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    signingIn = true
                    errorMessage = null
                    try {
                        repo.signIn(email.trim(), password)
                        onSignedIn()
                    } catch (e: Exception) {
                        errorMessage = e.message ?: "Sign-in failed. Check your email and password and try again."
                    }
                    signingIn = false
                }
            },
            enabled = !signingIn && email.isNotBlank() && password.isNotBlank(),
        ) {
            Text(if (signingIn) "Signing in..." else "Sign in")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FillbookStatsBody(repo: FillbookAdminRepository, onSignedOut: () -> Unit) {
    var period by remember { mutableStateOf("30d") }
    var stats by remember { mutableStateOf<GrowthStats?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            stats = repo.getGrowthStats(period)
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = authErrorMessage(e) ?: e.message ?: "Couldn't load stats. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(period) { loaded = false; refresh() }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            SingleChoiceSegmentedButtonRow {
                PERIODS.forEachIndexed { index, p ->
                    SegmentedButton(
                        selected = period == p,
                        onClick = { period = p },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = PERIODS.size),
                    ) { Text(periodLabel(p)) }
                }
            }
            TextButton(onClick = { repo.signOut(); onSignedOut() }) { Text("Sign out") }
        }

        errorMessage?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
            }
        }

        if (!loaded) {
            SkeletonListLoading()
            return@Column
        }
        val data = stats ?: return@Column

        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Column {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricTile("Visitors", data.visitors.toString(), Icons.Filled.People, modifier = Modifier.weight(1f))
                            MetricTile("Signups", data.signups.toString(), Icons.Filled.PersonAdd, modifier = Modifier.weight(1f))
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricTile("Activated", data.activated.toString(), Icons.Filled.TrendingUp, modifier = Modifier.weight(1f))
                            MetricTile("New subscribers", data.newSubscribers.toString(), Icons.Filled.Inbox, modifier = Modifier.weight(1f))
                        }
                    }
                }
                item {
                    GrowthCard {
                        Text("Funnel", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(6.dp))
                        data.funnel.forEach { (label, rate) ->
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(label, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    rate?.let { "%.0f%%".format(it) } ?: "N/A",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = if (rate == null) TextTertiary else MaterialTheme.colorScheme.onSurface,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
