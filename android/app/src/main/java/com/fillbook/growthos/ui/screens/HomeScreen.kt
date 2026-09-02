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
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.HealthItem
import com.fillbook.growthos.data.HomeSummary
import com.fillbook.growthos.data.InboundSummary
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.HeroActionCard
import com.fillbook.growthos.ui.components.InsetRow
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.QuickActionChip
import com.fillbook.growthos.ui.components.SectionHeader
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.autoDraftSkipReasonLabel
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
    var inbound by remember { mutableStateOf<InboundSummary?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            summary = repo.getHomeSummary()
            health = repo.getHealth()
            inbound = repo.getInboundSummary()
            errorMessage = null
        } catch (e: Exception) {
            android.util.Log.e("GrowthOsDiag", "refresh() failed", e)
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
                        MetricTile(
                            "Waiting on you",
                            s.pendingReview.toString(),
                            Icons.Filled.CheckCircle,
                            Modifier.weight(1f),
                            valueColor = if (s.pendingReview > 0) Accent else TextPrimary,
                            highlighted = s.pendingReview > 0,
                        )
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
                            highlighted = issueCount > 0,
                            highlightColor = Warning,
                        )
                    }
                }

                if (issueCount > 0) {
                    item { SystemIssuesCard(health, issueCount, onNavigate) }
                }

                item { NextBestActionCard(s, inbound, onNavigate) }

                inbound?.let { i ->
                    if (i.needsResponse > 0 || i.followUp > 0 || i.repeatEngagers > 0) {
                        item { SectionHeader("Inbound") }
                        item { InboundSummaryCard(i, onNavigate) }
                    }
                }

                item {
                    SectionHeader("Quick actions")
                }
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        QuickActionChip(Icons.Filled.Forum, "Inbound", { onNavigate("inbound") }, Modifier.weight(1f))
                        QuickActionChip(Icons.Filled.CheckCircle, "Approvals", { onNavigate("approvals") }, Modifier.weight(1f))
                        QuickActionChip(Icons.Filled.Radar, "Radar", { onNavigate("radar") }, Modifier.weight(1f))
                    }
                }

                item { SectionHeader("Recent activity") }
                item { RecentActivity(s, health) }
            }
        }
    }
}

/**
 * Priority order matches the explicit model: unresolved inbound engagement
 * outranks drafts waiting for review, which outrank fresh outbound
 * discovery -- a stranger's cold-discovery topic idea should never bury a
 * real person waiting on a reply.
 */
@Composable
private fun NextBestActionCard(summary: HomeSummary, inbound: InboundSummary?, onNavigate: (String) -> Unit) {
    val (title, subtitle, actionLabel, route, icon) = when {
        inbound != null && inbound.needsResponse > 0 -> NextAction(
            "${inbound.needsResponse} inbound repl${if (inbound.needsResponse == 1) "y" else "ies"} need${if (inbound.needsResponse == 1) "s" else ""} a response",
            if (inbound.overdue > 0) "${inbound.overdue} of these have been waiting over 48 hours." else "Real people who engaged with @FillbookHQ, waiting to hear back.",
            "Open Inbound",
            "inbound",
            Icons.Filled.Forum,
        )
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

    HeroActionCard(
        icon = icon,
        title = title,
        subtitle = subtitle,
        actionLabel = actionLabel,
        onClick = { onNavigate(route) },
    )
}

/**
 * Makes the "N issues" metric tile actionable instead of a dead end --
 * summarizes the real DOWN/DEGRADED subsystems (same /api/health data the
 * tile above already fetched) so the operator sees what's actually wrong
 * without leaving Home, then one tap into System for the full diagnostic
 * list. Never rendered when healthy (issueCount == 0) -- a restrained
 * healthy state has nothing to show here.
 */
@Composable
private fun SystemIssuesCard(health: List<com.fillbook.growthos.data.HealthItem>, issueCount: Int, onNavigate: (String) -> Unit) {
    val issues = health.filter { it.status.name == "DOWN" || it.status.name == "DEGRADED" }
    GrowthCard(onClick = { onNavigate("system") }) {
        Text(
            "$issueCount system issue${if (issueCount == 1) "" else "s"}",
            style = MaterialTheme.typography.titleMedium,
            color = Warning,
        )
        Spacer(Modifier.height(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            issues.take(2).forEach { item ->
                Text(
                    "${item.label} ${if (item.status.name == "DOWN") "is down" else "needs attention"}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text("View diagnostics", style = MaterialTheme.typography.labelLarge, color = Accent)
            Spacer(Modifier.width(4.dp))
            Text("→", style = MaterialTheme.typography.labelLarge, color = Accent)
        }
    }
}

/** The exact scannable counts the spec asks for: "3 need response / 1 follow-up / 1 repeat engager / 0 overdue," one tap into the full queue. */
@Composable
private fun InboundSummaryCard(inbound: InboundSummary, onNavigate: (String) -> Unit) {
    GrowthCard(onClick = { onNavigate("inbound") }) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            InboundStat(inbound.needsResponse, "need response")
            InboundStat(inbound.followUp, "follow-ups")
            InboundStat(inbound.repeatEngagers, "repeat engager")
            InboundStat(inbound.overdue, "overdue", emphasize = inbound.overdue > 0)
        }
    }
}

@Composable
private fun InboundStat(count: Int, label: String, emphasize: Boolean = false) {
    Column {
        Text(count.toString(), style = MaterialTheme.typography.headlineMedium, color = if (emphasize) Danger else TextPrimary)
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextSecondary)
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

    val rows = buildList {
        autoDraft.lastRunDate?.let { date ->
            add(
                "Auto-draft ($date)" to when (autoDraft.lastRunStatus) {
                    "drafted" -> "Produced a real draft"
                    "skipped" -> autoDraftSkipReasonLabel(autoDraft.lastRunSkipReason)
                    "failed" -> "Failed -- see System"
                    else -> autoDraft.lastRunStatus ?: "Unknown"
                },
            )
        }
        syncedSources.take(2).forEach { item ->
            add(item.label to item.detail.substringAfter("last synced ").take(19))
        }
    }

    GrowthCard {
        if (rows.isEmpty()) {
            Text("No activity recorded yet.", style = MaterialTheme.typography.bodyMedium, color = TextTertiary)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                rows.forEach { (label, detail) -> ActivityRow(label, detail) }
            }
        }
    }
}

@Composable
private fun ActivityRow(label: String, detail: String) {
    InsetRow {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            Text(detail, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
        }
    }
}
