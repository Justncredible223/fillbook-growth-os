package com.fillbook.growthos.ui.screens

import android.content.Intent
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.Opportunity
import com.fillbook.growthos.ui.components.GhostButton
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.IconPill
import com.fillbook.growthos.ui.components.InsetRow
import com.fillbook.growthos.ui.components.PrimaryButton
import com.fillbook.growthos.ui.components.assetStageDisplayName
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScoreBadge
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SearchField
import com.fillbook.growthos.ui.components.copyToClipboard
import com.fillbook.growthos.ui.components.explainOpportunity
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.components.platformIcon
import com.fillbook.growthos.ui.components.scoreBand
import com.fillbook.growthos.ui.components.scoreBandColor
import com.fillbook.growthos.ui.components.signalSourceDisplayName
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
    var pendingReply by remember { mutableStateOf<Opportunity?>(null) }
    var replyDraft by remember { mutableStateOf<String?>(null) }
    var draftingReplyId by remember { mutableStateOf<String?>(null) }
    var replyError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

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
                    "Didn't clear review (${assetStageDisplayName(result.finalStage)})" +
                        if (result.blockReasons.isNotEmpty()) ": ${result.blockReasons.joinToString("; ")}" else "."
                }
                refresh()
            } catch (e: Exception) {
                runResultMessage = "Couldn't run that campaign. Check your connection and try again."
            }
            runningId = null
        }
    }

    fun startReply(opp: Opportunity) {
        scope.launch {
            draftingReplyId = opp.id
            replyError = null
            try {
                replyDraft = repo.draftOpportunityReply(opp.id)
                pendingReply = opp
            } catch (e: Exception) {
                replyError = "Couldn't draft a reply. Check your connection and try again."
            }
            draftingReplyId = null
        }
    }

    fun copyAndOpenReply(opp: Opportunity, draft: String) {
        copyToClipboard(context, "Reply to ${opp.title}", draft)
        opp.sourceUrl?.let { url ->
            context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)))
        }
        pendingReply = null
        replyDraft = null
        scope.launch { snackbarHostState.showSnackbar("Copied — paste in X") }
    }

    val filtered = remember(opportunities, query) {
        if (query.isBlank()) opportunities
        else opportunities.filter { it.title.contains(query, ignoreCase = true) || it.rationale.contains(query, ignoreCase = true) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Radar",
            "Opportunities found from real signals — nothing here publishes itself.",
            kicker = if (loaded && opportunities.isNotEmpty()) "${opportunities.size} open signal${if (opportunities.size == 1) "" else "s"}" else null,
        )

        (errorMessage ?: replyError ?: runResultMessage)?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (errorMessage != null || replyError != null) Danger else TextSecondary,
                    modifier = Modifier.weight(1f),
                )
                if (errorMessage != null) {
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                } else {
                    TextButton(onClick = { runResultMessage = null; replyError = null }) { Text("Dismiss") }
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
                                draftingReply = draftingReplyId == opp.id,
                                topRanked = opp.score == topScore,
                                onRun = { pendingRun = opp },
                                onReply = { startReply(opp) },
                            )
                        }
                    }
                }
            }
        }
    }
    SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
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

    pendingReply?.let { opp ->
        val draft = replyDraft
        AlertDialog(
            onDismissRequest = { pendingReply = null; replyDraft = null },
            title = { Text("Reply on X") },
            text = {
                Column {
                    Text(
                        "Review the draft below, then copy it and open the post -- posting is still up to you.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary,
                    )
                    Spacer(Modifier.height(10.dp))
                    if (draft != null) {
                        Text(draft, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                    } else {
                        CircularProgressIndicator(modifier = Modifier.height(18.dp))
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { draft?.let { copyAndOpenReply(opp, it) } },
                    enabled = draft != null,
                ) { Text("Copy + Open X") }
            },
            dismissButton = {
                TextButton(onClick = { pendingReply = null; replyDraft = null }) { Text("Cancel") }
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
 * stay one tap away under "View score breakdown," framed as an analysis
 * disclosure (a bordered inset block, small monospace-adjacent bullet
 * lines) rather than looking like leaked debug output.
 *
 * The left signal-rail (a thin colored bar, via GrowthCard's accentBar)
 * is Radar's own identity mark -- the score band's color runs the full
 * height of the card, so priority reads at a glance scrolling past, not
 * just from the badge. [topRanked] additionally gets a filled primary CTA
 * and a brighter card border; every other card gets a quiet text-only
 * action so a long list doesn't turn into a stack of equally-loud buttons.
 */
@Composable
private fun OpportunityCard(
    opp: Opportunity,
    running: Boolean,
    draftingReply: Boolean,
    topRanked: Boolean,
    onRun: () -> Unit,
    onReply: () -> Unit,
) {
    val (headline, source) = splitTitle(opp.title)
    val band = scoreBand(opp.score.toInt())
    val bandColor = scoreBandColor(band)
    val explanation = explainOpportunity(opp.rationale)
    var showBreakdown by remember(opp.id) { mutableStateOf(false) }

    GrowthCard(accentBar = bandColor) {
        Row(verticalAlignment = Alignment.Top) {
            ScoreBadge(score = opp.score.toInt(), semanticLabel = "Opportunity score ${opp.score.toInt()}, ${band.label}")
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Pill(band.label.uppercase(), bandColor)
                    if (topRanked) Pill("TOP PICK", Accent)
                    if (opp.isEngagementOpportunity) Pill("ENGAGEMENT", TextSecondary)
                }
                Spacer(Modifier.height(6.dp))
                Text(headline, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    opp.channels.forEach { channel -> IconPill(platformDisplayName(channel), platformIcon(channel), TextSecondary) }
                    source?.let { Pill(signalSourceDisplayName(it), TextSecondary) }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        InsetRow {
            Text("WHY IT SURFACED", style = MaterialTheme.typography.labelMedium, color = TextTertiary)
            Spacer(Modifier.height(4.dp))
            Text(explanation.summary, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)

            if (explanation.breakdown.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                TextButton(
                    onClick = { showBreakdown = !showBreakdown },
                    contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.semantics { stateDescription = if (showBreakdown) "Expanded" else "Collapsed" },
                ) {
                    Text(if (showBreakdown) "Hide score breakdown" else "View score breakdown", style = MaterialTheme.typography.labelMedium, color = Accent)
                }
                if (showBreakdown) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(com.fillbook.growthos.ui.theme.Background, androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        explanation.breakdown.forEach { line ->
                            Text(line, style = MaterialTheme.typography.bodySmall.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace), color = TextTertiary)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
            if (opp.isEngagementOpportunity) {
                if (topRanked) {
                    PrimaryButton(text = "Reply on X", onClick = onReply, enabled = !draftingReply, busy = draftingReply)
                } else {
                    GhostButton(text = "Reply on X →", onClick = onReply, enabled = !draftingReply)
                }
            } else if (topRanked) {
                PrimaryButton(text = "Build campaign", onClick = onRun, enabled = !running, busy = running)
            } else {
                GhostButton(text = "Build campaign →", onClick = onRun, enabled = !running)
            }
        }
    }
}
