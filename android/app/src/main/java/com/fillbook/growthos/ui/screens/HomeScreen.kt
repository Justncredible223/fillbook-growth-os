package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import android.content.Intent
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.HealthItem
import com.fillbook.growthos.data.HomeSummary
import com.fillbook.growthos.data.InboundSummary
import com.fillbook.growthos.data.TodayXPost
import com.fillbook.growthos.data.TodayXPostState
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.HeroActionCard
import com.fillbook.growthos.ui.components.InsetRow
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.QuickActionChip
import com.fillbook.growthos.ui.components.QuietStatusLabel
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SectionHeader
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.StatusTone
import com.fillbook.growthos.ui.components.autoDraftSkipReasonLabel
import com.fillbook.growthos.ui.components.copyToClipboard
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Success
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

/**
 * Command center, not a text report. Structure, top to bottom: masthead
 * -> Next Best Action (the single strongest surface on the screen, by
 * design -- see HeroActionCard) -> a compact operational-summary strip ->
 * system issues (visible but deliberately quieter than the hero above it)
 * -> inbound snapshot when there's something live -> quick actions -> a
 * quiet, timeline-style recent-activity list. Every number here is real
 * (same /api/summary + /api/health this app has always used) -- this
 * screen changes how it's organized and how loudly each part speaks, not
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
    var reviewingXPost by remember { mutableStateOf(false) }
    var handingOff by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

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

    fun handOffXPost(assetId: String, previewText: String) {
        scope.launch {
            handingOff = true
            try {
                repo.handOffAsset(assetId)
                copyToClipboard(context, "Today's X post", previewText)
                context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://x.com/compose/post")))
                reviewingXPost = false
                refresh()
                snackbarHostState.showSnackbar("Opened in X — posting is still up to you")
            } catch (e: Exception) {
                snackbarHostState.showSnackbar("Couldn't complete that -- check your connection and try again.")
            }
            handingOff = false
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { ScreenHeader("Fillbook Growth OS", "Mission Control", kicker = "Operator console") }

            errorMessage?.let { message ->
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(horizontal = 20.dp)) {
                        Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                    }
                }
            }

            if (!loaded) {
                item { SkeletonListLoading() }
            }

            summary?.let { s ->
                val issueCount = health.count { it.status.name == "DOWN" || it.status.name == "DEGRADED" }

                item { Box20 { NextBestActionCard(s, inbound, onNavigate) } }

                item { Box20 { TodayXPostCard(s.todayXPost, onReview = { reviewingXPost = true }) } }

                item {
                    Box20 {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricTile("Opportunities", s.opportunitiesFound.toString(), Icons.Filled.Search, Modifier.weight(1f))
                            MetricTile(
                                "Waiting on you",
                                s.pendingReview.toString(),
                                Icons.Filled.CheckCircle,
                                Modifier.weight(1f),
                                valueColor = if (s.pendingReview > 0) Warning else TextPrimary,
                                highlighted = s.pendingReview > 0,
                                highlightColor = Warning,
                            )
                        }
                    }
                }
                item {
                    Box20 {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricTile("Today's spend", "$%.4f".format(s.analytics.todaySpendUsd), Icons.Filled.Bolt, Modifier.weight(1f))
                            MetricTile(
                                "System health",
                                if (issueCount == 0) "All clear" else "$issueCount issue${if (issueCount == 1) "" else "s"}",
                                Icons.Filled.PauseCircle,
                                Modifier.weight(1f),
                                valueColor = if (issueCount == 0) Success else Warning,
                                highlighted = issueCount > 0,
                                highlightColor = Warning,
                            )
                        }
                    }
                }

                if (issueCount > 0) {
                    item { Box20 { SystemIssuesCard(health, issueCount, onNavigate) } }
                }

                inbound?.let { i ->
                    if (i.needsResponse > 0 || i.followUp > 0 || i.repeatEngagers > 0) {
                        item { Box20 { SectionHeader("Inbound") } }
                        item { Box20 { InboundSummaryCard(i, onNavigate) } }
                    }
                }

                item { Box20 { SectionHeader("Quick actions") } }
                item {
                    Box20 {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            QuickActionChip(Icons.Filled.Forum, "Inbound", { onNavigate("inbound") }, Modifier.weight(1f))
                            QuickActionChip(Icons.Filled.CheckCircle, "Approvals", { onNavigate("approvals") }, Modifier.weight(1f))
                            QuickActionChip(Icons.Filled.Radar, "Radar", { onNavigate("radar") }, Modifier.weight(1f))
                        }
                    }
                }

                item { Box20 { SectionHeader("Recent activity") } }
                item { Box20 { RecentActivity(s, health) } }
            }
        }
    }
    SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
    }

    if (reviewingXPost) {
        val post = summary?.todayXPost
        AlertDialog(
            onDismissRequest = { if (!handingOff) reviewingXPost = false },
            title = { Text("Today's X Post") },
            text = {
                Column {
                    Text(
                        "Review the draft below, then copy it and open X -- posting is still up to you.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(post?.previewText.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val assetId = post?.campaignAssetId
                        val text = post?.previewText
                        if (assetId != null && text != null) handOffXPost(assetId, text)
                    },
                    enabled = !handingOff && post?.campaignAssetId != null,
                ) { Text(if (handingOff) "Opening..." else "Copy + Open X") }
            },
            dismissButton = {
                TextButton(onClick = { reviewingXPost = false }, enabled = !handingOff) { Text("Cancel") }
            },
        )
    }
}

/** contentPadding was 20dp all around on the old flat LazyColumn; the masthead needs full-bleed control of its own padding now, so every other item opts into the same 20dp horizontal inset individually. */
@Composable
private fun Box20(content: @Composable () -> Unit) {
    Column(modifier = Modifier.padding(horizontal = 20.dp)) { content() }
}

/**
 * Priority order matches the explicit model: unresolved inbound engagement
 * outranks drafts waiting for review, which outrank fresh outbound
 * discovery -- a stranger's cold-discovery topic idea should never bury a
 * real person waiting on a reply. This card is deliberately the first and
 * strongest thing on the screen after the masthead -- see HeroActionCard.
 */
@Composable
private fun NextBestActionCard(summary: HomeSummary, inbound: InboundSummary?, onNavigate: (String) -> Unit) {
    val (kicker, title, subtitle, actionLabel, route, icon) = when {
        inbound != null && inbound.needsResponse > 0 -> NextAction(
            "Next best action",
            "${inbound.needsResponse} inbound repl${if (inbound.needsResponse == 1) "y" else "ies"} need${if (inbound.needsResponse == 1) "s" else ""} a response",
            if (inbound.overdue > 0) "${inbound.overdue} of these have been waiting over 48 hours." else "Real people who engaged with @FillbookHQ, waiting to hear back.",
            "Open Inbound",
            "inbound",
            Icons.Filled.Forum,
        )
        summary.pendingReview > 0 -> NextAction(
            "Next best action",
            "${summary.pendingReview} draft${if (summary.pendingReview == 1) "" else "s"} ready to review",
            "AI-reviewed and waiting on your decision -- approve, reject, or open in-platform.",
            "Review now",
            "approvals",
            Icons.Filled.CheckCircle,
        )
        summary.opportunitiesFound > 0 -> NextAction(
            "Next best action",
            "${summary.opportunitiesFound} open opportunities on Radar",
            "Real signals the system found -- nothing drafted from them yet unless you trigger it.",
            "View Radar",
            "radar",
            Icons.Filled.Radar,
        )
        else -> NextAction(
            "All caught up",
            "Nothing needs you right now",
            "No open opportunities and nothing waiting for review right now.",
            "View Analytics",
            "analytics",
            Icons.Filled.Insights,
        )
    }

    HeroActionCard(
        icon = icon,
        kicker = kicker,
        title = title,
        subtitle = subtitle,
        actionLabel = actionLabel,
        onClick = { onNavigate(route) },
    )
}

/**
 * A separate, quieter card from the Next Best Action hero above it --
 * NBA answers "what needs my attention right now" (interrupt-driven);
 * this answers a different, routine question ("did I handle Fillbook's
 * own X post today"), so it never competes with or reorders NBA's
 * priority. Only ever shows a real campaign_assets row (see
 * api/summary.ts's todayXPost) -- EMPTY is a genuine, honest state, not
 * a loading placeholder, and HANDED_OFF never claims to know the post
 * actually went out on X.
 */
@Composable
private fun TodayXPostCard(post: TodayXPost, onReview: () -> Unit) {
    GrowthCard(
        onClick = if (post.state == TodayXPostState.READY) onReview else null,
        accentBar = if (post.state == TodayXPostState.READY) Accent else null,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Tag, contentDescription = null, tint = TextTertiary, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Today's X Post", style = MaterialTheme.typography.titleMedium, color = TextPrimary, modifier = Modifier.weight(1f))
            when (post.state) {
                TodayXPostState.READY -> QuietStatusLabel("Ready for review", StatusTone.WAITING)
                TodayXPostState.HANDED_OFF -> QuietStatusLabel("Opened in X", StatusTone.READY)
                TodayXPostState.EMPTY -> {}
            }
        }
        when (post.state) {
            TodayXPostState.READY -> {
                Spacer(Modifier.height(6.dp))
                Text(
                    post.previewText.orEmpty(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    maxLines = 2,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
            }
            TodayXPostState.HANDED_OFF -> {
                Spacer(Modifier.height(4.dp))
                Text("You already opened X with this draft today.", style = MaterialTheme.typography.bodySmall, color = TextTertiary)
            }
            TodayXPostState.EMPTY -> {
                Spacer(Modifier.height(4.dp))
                Text("Nothing queued for X today.", style = MaterialTheme.typography.bodySmall, color = TextTertiary)
            }
        }
    }
}

/**
 * Makes the "N issues" metric tile actionable instead of a dead end --
 * summarizes the real DOWN/DEGRADED subsystems (same /api/health data the
 * tile above already fetched) so the operator sees what's actually wrong
 * without leaving Home, then one tap into System for the full diagnostic
 * list. Deliberately quieter than the Next Best Action hero above it --
 * a small warning dot per line, not a shouting amber headline -- since a
 * system issue is real but is not automatically the most urgent thing on
 * the screen. Never rendered when healthy (issueCount == 0).
 */
@Composable
private fun SystemIssuesCard(health: List<com.fillbook.growthos.data.HealthItem>, issueCount: Int, onNavigate: (String) -> Unit) {
    val issues = health.filter { it.status.name == "DOWN" || it.status.name == "DEGRADED" }
    GrowthCard(onClick = { onNavigate("system") }, accentBar = Warning) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "$issueCount system issue${if (issueCount == 1) "" else "s"}",
                style = MaterialTheme.typography.titleMedium,
                color = TextPrimary,
            )
        }
        Spacer(Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            issues.take(2).forEach { item ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(6.dp).background(Warning, CircleShape))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "${item.label} ${if (item.status.name == "DOWN") "is down" else "needs attention"}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary,
                    )
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
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
        Text(count.toString(), style = com.fillbook.growthos.ui.theme.KpiNumberStyleSmall, color = if (emphasize) Danger else TextPrimary)
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextSecondary)
    }
}

private data class NextAction(
    val kicker: String,
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

    if (rows.isEmpty()) {
        GrowthCard {
            Text("No activity recorded yet.", style = MaterialTheme.typography.bodyMedium, color = TextTertiary)
        }
    } else {
        // A quiet timeline, not another card -- a small dot-and-line rail
        // to the left of each row, so Recent Activity visually reads as
        // "history" rather than one more equally-weighted info card
        // competing with the hero surface above it.
        Column {
            rows.forEachIndexed { index, (label, detail) ->
                TimelineRow(label, detail, isLast = index == rows.lastIndex)
            }
        }
    }
}

@Composable
private fun TimelineRow(label: String, detail: String, isLast: Boolean) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(20.dp)) {
            Box(modifier = Modifier.size(7.dp).background(TextTertiary, CircleShape))
            if (!isLast) {
                Box(modifier = Modifier.width(1.dp).height(28.dp).background(com.fillbook.growthos.ui.theme.Border))
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.padding(bottom = if (isLast) 0.dp else 14.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            Text(detail, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
        }
    }
}
