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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.HealthItem
import com.fillbook.growthos.data.HomeSummary
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.healthColor
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

/**
 * Command center, not a text report: a top status row you can read in
 * one glance, one "next best action" card so there's never a question
 * of what to do first, quick-jump actions, and a short real activity
 * list. Every number here is real (same /api/summary + /api/health this
 * app has always used) -- this screen changes how it's organized, not
 * what it claims.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(repo: GrowthOsRepository, onNavigate: (String) -> Unit) {
    var summary by remember { mutableStateOf<HomeSummary?>(null) }
    var health by remember { mutableStateOf<List<HealthItem>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            summary = repo.getHomeSummary()
            health = repo.getHealth()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't reach Growth OS. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Column {
                    Text("Fillbook Growth OS", style = MaterialTheme.typography.headlineLarge)
                    Spacer(Modifier.height(2.dp))
                    Text("Mission Control", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
                }
            }

            errorMessage?.let { message ->
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                    }
                }
            }

            if (!loaded) {
                item { SkeletonListLoading(horizontalPadding = 0.dp) }
            }

            summary?.let { s ->
                val issueCount = health.count { it.status.name == "DOWN" || it.status.name == "DEGRADED" }

                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        MetricTile("Opportunities", s.opportunitiesFound.toString(), Icons.Filled.Search, Modifier.weight(1f))
                        MetricTile("Waiting on you", s.pendingReview.toString(), Icons.Filled.CheckCircle, Modifier.weight(1f), valueColor = if (s.pendingReview > 0) Accent else TextPrimary)
                    }
                }
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        MetricTile("Today's spend", "$%.4f".format(s.analytics.totalCostUsd), Icons.Filled.Bolt, Modifier.weight(1f))
                        MetricTile(
                            "System health",
                            if (issueCount == 0) "All clear" else "$issueCount issue${if (issueCount == 1) "" else "s"}",
                            Icons.Filled.PauseCircle,
                            Modifier.weight(1f),
                            valueColor = if (issueCount == 0) Accent else Warning,
                        )
                    }
                }

                item { NextBestActionCard(s, onNavigate) }

                item {
                    SectionLabel("Quick actions")
                }
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { onNavigate("approvals") }, modifier = Modifier.weight(1f)) { Text("Approvals") }
                        OutlinedButton(onClick = { onNavigate("radar") }, modifier = Modifier.weight(1f)) { Text("Radar") }
                        OutlinedButton(onClick = { onNavigate("analytics") }, modifier = Modifier.weight(1f)) { Text("Analytics") }
                    }
                }

                item { SectionLabel("Recent activity") }
                item { RecentActivity(s, health) }
            }
        }
    }
}

@Composable
private fun NextBestActionCard(summary: HomeSummary, onNavigate: (String) -> Unit) {
    val (title, subtitle, actionLabel, route, icon) = when {
        summary.pendingReview > 0 -> NextAction(
            "${summary.pendingReview} draft${if (summary.pendingReview == 1) "" else "s"} ready to review",
            "AI-reviewed and waiting on your decision -- approve, reject, or open in-platform.",
            "Review now",
            "approvals",
            Icons.Filled.CheckCircle,
        )
        summary.opportunitiesFound > 0 -> NextAction(
            "${summary.opportunitiesFound} open opportunities on Radar",
            "Real signals the system found -- nothing drafted from them yet unless you trigger it.",
            "View Radar",
            "radar",
            Icons.Filled.Radar,
        )
        else -> NextAction(
            "All caught up",
            "No open opportunities and nothing waiting for review right now.",
            "View Analytics",
            "analytics",
            Icons.Filled.Insights,
        )
    }

    GrowthCard(onClick = { onNavigate(route) }) {
        Row(verticalAlignment = Alignment.Top) {
            Icon(icon, contentDescription = null, tint = Accent, modifier = Modifier.height(22.dp))
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(4.dp))
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(actionLabel, style = MaterialTheme.typography.labelLarge, color = Accent)
    }
}

private data class NextAction(
    val title: String,
    val subtitle: String,
    val actionLabel: String,
    val route: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)

@Composable
private fun RecentActivity(summary: HomeSummary, health: List<HealthItem>) {
    val autoDraft = summary.analytics.autoDraft
    val syncedSources = health.filter { it.detail.contains("Verified live") }

    GrowthCard {
        var shown = 0
        autoDraft.lastRunDate?.let { date ->
            ActivityRow(
                label = "Auto-draft ($date)",
                detail = when (autoDraft.lastRunStatus) {
                    "drafted" -> "Produced a real draft"
                    "skipped" -> autoDraft.lastRunSkipReason ?: "Skipped"
                    "failed" -> "Failed -- see System"
                    else -> autoDraft.lastRunStatus ?: "Unknown"
                },
            )
            shown++
        }
        syncedSources.take(2).forEach { item ->
            if (shown > 0) Spacer(Modifier.height(10.dp))
            ActivityRow(label = item.label, detail = item.detail.substringAfter("last synced ").take(19))
            shown++
        }
        if (shown == 0) {
            Text("No activity recorded yet.", style = MaterialTheme.typography.bodyMedium, color = TextTertiary)
        }
    }
}

@Composable
private fun ActivityRow(label: String, detail: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
        Text(detail, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = TextSecondary,
        modifier = Modifier.padding(top = 4.dp),
    )
}
