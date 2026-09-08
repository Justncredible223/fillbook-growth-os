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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.AutoDraftStatus
import com.fillbook.growthos.data.CostSummary
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.authErrorMessage
import com.fillbook.growthos.data.HealthItem
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.HealthDot
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.QuietStatusLabel
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SectionHeader
import com.fillbook.growthos.ui.components.autoDraftSkipReasonLabel
import com.fillbook.growthos.ui.components.healthColor
import com.fillbook.growthos.ui.components.healthLabel
import com.fillbook.growthos.ui.components.healthTone
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Success
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

/**
 * Reuses the same real /api/health data Home shows a summary of, at full
 * detail, plus the Pause System control (POST /api/summary {paused},
 * NetworkGrowthOsRepository.setPaused -- genuinely wired, not a display-
 * only toggle). The technical/infrastructure detail an operator doesn't
 * need on the normal Settings screen (backend host, database project)
 * lives here instead, under Diagnostics.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SystemScreen(repo: GrowthOsRepository) {
    var health by remember { mutableStateOf<List<HealthItem>>(emptyList()) }
    var costSummary by remember { mutableStateOf<CostSummary?>(null) }
    var autoDraft by remember { mutableStateOf<AutoDraftStatus?>(null) }
    var systemPaused by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var showPauseConfirm by remember { mutableStateOf(false) }
    // True while the pause/unpause request is in flight -- the switch is
    // disabled so a second tap can't race the first and land the system
    // in the opposite state from what the owner last saw.
    var pauseInFlight by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            health = repo.getHealth()
            costSummary = repo.getCostSummary()
            val summary = repo.getHomeSummary()
            autoDraft = summary.analytics.autoDraft
            systemPaused = summary.systemPaused
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = authErrorMessage(e) ?: "Couldn't reach Growth OS. Check your connection and try again."
        }
        loaded = true
    }

    fun togglePause() {
        if (pauseInFlight) return
        scope.launch {
            pauseInFlight = true
            try {
                repo.setPaused(!systemPaused)
                actionError = null
                refresh()
            } catch (e: Exception) {
                actionError = if (systemPaused) {
                    "Couldn't unpause the system. Check your connection and try again."
                } else {
                    "Couldn't pause the system. Check your connection and try again."
                }
            } finally {
                pauseInFlight = false
            }
        }
    }

    LaunchedEffect(Unit) { refresh() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        ScreenHeader("System", "Live diagnostics for every subsystem and integration.", kicker = "Diagnostics")

        (errorMessage ?: actionError)?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                if (errorMessage != null) {
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                } else {
                    TextButton(onClick = { actionError = null }) { Text("Dismiss") }
                }
            }
        }

        if (!loaded) {
            SkeletonListLoading()
        } else {
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item { OverallHealthCard(health) }
                    costSummary?.let { summary ->
                        item {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                MetricTile("Total LLM spend", "$%.2f".format(summary.totalCostUsd), Icons.Filled.AttachMoney, modifier = Modifier.weight(1f))
                                MetricTile("Last 24h spend", "$%.4f".format(summary.last24hCostUsd), Icons.Filled.Schedule, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                    autoDraft?.let { status ->
                        item {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                MetricTile(
                                    "Draft backlog",
                                    "${status.backlogCount}/${status.backlogCap}",
                                    Icons.Filled.Inbox,
                                    modifier = Modifier.weight(1f),
                                    valueColor = if (status.backlogCount >= status.backlogCap) Warning else MaterialTheme.colorScheme.onSurface,
                                )
                                MetricTile(
                                    "Month spend",
                                    "$%.2f / $%.0f".format(status.monthSpendUsd, status.monthBudgetUsd),
                                    Icons.Filled.Payments,
                                    modifier = Modifier.weight(1f),
                                    valueColor = if (status.monthSpendUsd >= status.monthBudgetUsd) Warning else MaterialTheme.colorScheme.onSurface,
                                )
                            }
                        }
                        item { AutoDraftCard(status) }
                    }
                    item { PauseSystemCard(paused = systemPaused, enabled = !pauseInFlight, onToggle = { showPauseConfirm = true }) }
                    item { SectionHeader("Subsystems") }
                    items(health) { item -> SystemHealthCard(item) }
                    item { SectionHeader("Diagnostics") }
                    item {
                        GrowthCard {
                            DiagnosticRow("Backend", "fillbook-growth-os.vercel.app")
                            Spacer(Modifier.height(10.dp))
                            DiagnosticRow("Database", "Supabase, fillbook-growth-os project")
                        }
                    }
                }
            }
        }
    }

    if (showPauseConfirm) {
        AlertDialog(
            onDismissRequest = { showPauseConfirm = false },
            title = { Text(if (systemPaused) "Unpause the system?" else "Pause the system?") },
            text = {
                Text(
                    if (systemPaused) {
                        "Auto-draft and manual campaign runs will be able to spend LLM tokens again."
                    } else {
                        "Auto-draft and manual campaign runs will stop until you unpause -- nothing currently in Approvals is affected."
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = { showPauseConfirm = false; togglePause() }) {
                    Text(if (systemPaused) "Unpause" else "Pause")
                }
            },
            dismissButton = {
                TextButton(onClick = { showPauseConfirm = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun PauseSystemCard(paused: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    GrowthCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Pause System", style = MaterialTheme.typography.titleMedium)
                Text(
                    when {
                        !enabled -> "Updating..."
                        paused -> "Paused -- auto-draft and manual runs are stopped."
                        else -> "Running -- auto-draft and manual runs are allowed."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextTertiary,
                )
            }
            // The switch is the only actionable control here, so it carries
            // the spoken label; the text beside it is the visual explanation.
            Switch(
                checked = paused,
                onCheckedChange = { onToggle() },
                enabled = enabled,
                colors = SwitchDefaults.colors(),
                modifier = Modifier.semantics { contentDescription = if (paused) "Pause system, on" else "Pause system, off" },
            )
        }
    }
}

@Composable
private fun AutoDraftCard(status: AutoDraftStatus) {
    GrowthCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Text("Auto-Draft", style = MaterialTheme.typography.titleMedium)
            Pill("max 1/day", TextTertiary)
        }
        Spacer(Modifier.height(6.dp))
        val lastRunText = when (status.lastRunStatus) {
            "drafted" -> "Last run (${status.lastRunDate}): drafted a real post for review"
            "skipped" -> "Last run (${status.lastRunDate}): ${autoDraftSkipReasonLabel(status.lastRunSkipReason)}"
            "failed" -> "Last run (${status.lastRunDate}): failed"
            else -> "Hasn't run yet"
        }
        Text(lastRunText, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
    }
}

@Composable
private fun DiagnosticRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.titleMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = TextTertiary)
    }
}

/**
 * The one prominent, unmissable status on this screen -- everything below
 * (subsystem rows, diagnostics) is real but deliberately secondary to
 * this single answer. Green/calm when everything's healthy; the accent
 * bar and headline both shift to amber/red the moment anything isn't.
 */
@Composable
private fun OverallHealthCard(health: List<HealthItem>) {
    val down = health.count { it.status.name == "DOWN" }
    val degraded = health.count { it.status.name == "DEGRADED" }
    val (color, headline, detail) = when {
        down > 0 -> Triple(Danger, "System degraded", "$down subsystem${if (down == 1) "" else "s"} down -- see below.")
        degraded > 0 -> Triple(Warning, "Needs attention", "$degraded subsystem${if (degraded == 1) "" else "s"} degraded -- see below.")
        else -> Triple(Success, "All systems operational", "Every connected subsystem is healthy.")
    }
    GrowthCard(accentBar = color) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            HealthDot(color, modifier = Modifier.size(10.dp))
            Spacer(Modifier.width(10.dp))
            Text(headline, style = MaterialTheme.typography.titleLarge, color = TextPrimary)
        }
        Spacer(Modifier.height(4.dp))
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
    }
}

@Composable
private fun SystemHealthCard(item: HealthItem) {
    GrowthCard {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.Top) {
                HealthDot(healthColor(item.status), modifier = Modifier.padding(top = 6.dp))
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(item.label, style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(2.dp))
                    Text(item.detail, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
                }
            }
            QuietStatusLabel(healthLabel(item.status), healthTone(item.status))
        }
    }
}
