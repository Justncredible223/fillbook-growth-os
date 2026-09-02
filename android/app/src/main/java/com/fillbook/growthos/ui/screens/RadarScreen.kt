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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.Opportunity
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.IconPill
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScoreBadge
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SearchField
import com.fillbook.growthos.ui.components.explainOpportunity
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.components.platformIcon
import com.fillbook.growthos.ui.components.scoreBand
import com.fillbook.growthos.ui.components.scoreBandColor
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RadarScreen(repo: GrowthOsRepository) {
    var opportunities by remember { mutableStateOf<List<Opportunity>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var pendingRun by remember { mutableStateOf<Opportunity?>(null) }
    var runningId by remember { mutableStateOf<String?>(null) }
    var runResultMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            opportunities = repo.getOpportunities()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load opportunities. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    fun runCampaign(opp: Opportunity) {
        scope.launch {
            runningId = opp.id
            try {
                val result = repo.runCampaignForOpportunity(opp.id)
                runResultMessage = if (result.finalStage == "ready_for_owner") {
                    "Sent to Approvals for your review."
                } else {
                    "Didn't clear review (${result.finalStage.replace('_', ' ')})" +
                        if (result.blockReasons.isNotEmpty()) ": ${result.blockReasons.joinToString("; ")}" else "."
                }
                refresh()
            } catch (e: Exception) {
                runResultMessage = "Couldn't run that campaign. Check your connection and try again."
            }
            runningId = null
        }
    }

    val filtered = remember(opportunities, query) {
        if (query.isBlank()) opportunities
        else opportunities.filter { it.title.contains(query, ignoreCase = true) || it.rationale.contains(query, ignoreCase = true) }
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader("Radar", "Opportunities found from real signals — nothing here publishes itself.")

        (errorMessage ?: runResultMessage)?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (errorMessage != null) Danger else TextSecondary,
                    modifier = Modifier.weight(1f),
                )
                if (errorMessage != null) {
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                } else {
                    TextButton(onClick = { runResultMessage = null }) { Text("Dismiss") }
                }
            }
        }

        if (!loaded) {
            SkeletonListLoading()
        } else if (errorMessage == null && opportunities.isEmpty()) {
            PolishedEmptyState(
                icon = Icons.Filled.Radar,
                headline = "Nothing on Radar yet",
                subtitle = "Once the daily signal sweep runs, real opportunities show up here.",
            )
        } else {
            SearchField(query, { query = it }, "Search opportunities", modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                if (filtered.isEmpty()) {
                    PolishedEmptyState(
                        icon = Icons.Filled.Radar,
                        headline = "No matches",
                        subtitle = "Nothing on Radar matches \"$query\".",
                    )
                } else {
                    val topScore = filtered.maxOf { it.score }
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(filtered, key = { it.id }) { opp ->
                            OpportunityCard(
                                opp = opp,
                                running = runningId == opp.id,
                                topRanked = opp.score == topScore,
                                onRun = { pendingRun = opp },
                            )
                        }
                    }
                }
            }
        }
    }

    pendingRun?.let { opp ->
        AlertDialog(
            onDismissRequest = { pendingRun = null },
            title = { Text("Run this campaign?") },
            text = {
                Text(
                    "Drafts this opportunity and runs it through the full review pipeline. " +
                        "Costs a small amount of real LLM spend. Nothing publishes -- at most it lands in Approvals for you to decide.",
                )
            },
            confirmButton = {
                TextButton(onClick = { runCampaign(opp); pendingRun = null }) { Text("Run") }
            },
            dismissButton = {
                TextButton(onClick = { pendingRun = null }) { Text("Cancel") }
            },
        )
    }
}

/** Titles come from the backend as "source: text" (real provenance, not fluff) -- split it into a clean headline plus a source chip instead of showing the raw prefix. */
private fun splitTitle(title: String): Pair<String, String?> {
    val idx = title.indexOf(": ")
    if (idx <= 0) return title to null
    return title.substring(idx + 2) to title.substring(0, idx)
}

/**
 * Leads with a human read ("why it surfaced"), not the raw scorer debug
 * text (see [explainOpportunity]) -- the score number and its inputs are
 * unchanged, only what's shown by default changes. Raw reason segments
 * stay one tap away under "View score breakdown" for anyone who wants
 * them. [topRanked] gives the single highest-scored visible card a
 * stronger CTA; every other card gets a compact, low-height action so a
 * long Radar list doesn't turn into a stack of equally-loud green
 * buttons.
 */
@Composable
private fun OpportunityCard(opp: Opportunity, running: Boolean, topRanked: Boolean, onRun: () -> Unit) {
    val (headline, source) = splitTitle(opp.title)
    val band = scoreBand(opp.score.toInt())
    val explanation = explainOpportunity(opp.rationale)
    var showBreakdown by remember(opp.id) { mutableStateOf(false) }

    GrowthCard {
        Row(verticalAlignment = Alignment.Top) {
            ScoreBadge(score = opp.score.toInt())
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Pill(band.label.uppercase(), scoreBandColor(band))
                    if (topRanked) Pill("TOP PICK", Accent)
                }
                Spacer(Modifier.height(4.dp))
                Text(headline, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    opp.channels.forEach { channel -> IconPill(platformDisplayName(channel), platformIcon(channel), TextSecondary) }
                    source?.let { Pill(it.replace("_", " "), TextSecondary) }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text("Why it surfaced", style = MaterialTheme.typography.labelMedium, color = TextTertiary)
        Spacer(Modifier.height(2.dp))
        Text(explanation.summary, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)

        if (explanation.breakdown.isNotEmpty()) {
            TextButton(onClick = { showBreakdown = !showBreakdown }, contentPadding = PaddingValues(0.dp)) {
                Text(if (showBreakdown) "Hide score breakdown" else "View score breakdown", style = MaterialTheme.typography.labelMedium, color = Accent)
            }
            if (showBreakdown) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    explanation.breakdown.forEach { line ->
                        Text("· $line", style = MaterialTheme.typography.bodySmall, color = TextTertiary)
                    }
                }
                Spacer(Modifier.height(4.dp))
            }
        }

        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
            if (topRanked) {
                Button(
                    onClick = onRun,
                    enabled = !running,
                    colors = ButtonDefaults.buttonColors(containerColor = Accent),
                ) {
                    if (running) {
                        CircularProgressIndicator(modifier = Modifier.height(16.dp), color = MaterialTheme.colorScheme.onPrimary)
                    } else {
                        Text("Build campaign")
                    }
                }
            } else {
                TextButton(onClick = onRun, enabled = !running) {
                    if (running) {
                        CircularProgressIndicator(modifier = Modifier.height(16.dp), color = Accent)
                    } else {
                        Text("Build campaign →", color = Accent)
                    }
                }
            }
        }
    }
}
