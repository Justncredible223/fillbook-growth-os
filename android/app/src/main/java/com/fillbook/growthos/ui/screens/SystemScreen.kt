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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import com.fillbook.growthos.data.AutoDraftStatus
import com.fillbook.growthos.data.CostSummary
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.HealthItem
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.LoadingIndicator
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.StatusChip
import com.fillbook.growthos.ui.components.healthLabel
import com.fillbook.growthos.ui.components.healthTone
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning

/**
 * Reuses the same real /api/health data Home shows a summary of, at full
 * detail, plus the Pause System control. The pause toggle is disabled --
 * system_settings exists in the schema (migration 0006) but no
 * /api/system-settings endpoint exists yet to read or flip it, so this
 * stays visibly inert rather than pretending to work.
 */
@Composable
fun SystemScreen(repo: GrowthOsRepository) {
    var health by remember { mutableStateOf<List<HealthItem>>(emptyList()) }
    var costSummary by remember { mutableStateOf<CostSummary?>(null) }
    var autoDraft by remember { mutableStateOf<AutoDraftStatus?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            health = repo.getHealth()
            costSummary = repo.getCostSummary()
            autoDraft = repo.getHomeSummary().analytics.autoDraft
        } catch (e: Exception) {
            errorMessage = "Couldn't reach Growth OS. Check your connection and try again."
        }
        loaded = true
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        ScreenHeader("System", "Live diagnostics for every subsystem and integration.")

        errorMessage?.let { message ->
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = Danger,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }

        if (!loaded) {
            LoadingIndicator()
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
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
                item { PauseSystemCard() }
                item {
                    Text(
                        "SUBSYSTEMS".uppercase(),
                        style = MaterialTheme.typography.labelMedium,
                        color = TextSecondary,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                items(health) { item -> SystemHealthCard(item) }
            }
        }
    }
}

@Composable
private fun PauseSystemCard() {
    GrowthCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Pause System", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Not wired yet -- system_settings exists but has no API endpoint.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextTertiary,
                )
            }
            Switch(checked = false, onCheckedChange = null, enabled = false, colors = SwitchDefaults.colors())
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
            "skipped" -> "Last run (${status.lastRunDate}): skipped -- ${status.lastRunSkipReason}"
            "failed" -> "Last run (${status.lastRunDate}): failed"
            else -> "Hasn't run yet"
        }
        Text(lastRunText, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
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
            Column(modifier = Modifier.weight(1f)) {
                Text(item.label, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(2.dp))
                Text(item.detail, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            }
            StatusChip(healthLabel(item.status), healthTone(item.status))
        }
    }
}
