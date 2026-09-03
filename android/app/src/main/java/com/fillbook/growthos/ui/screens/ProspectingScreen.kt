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
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.ProspectingCandidate
import com.fillbook.growthos.ui.components.ExpandableText
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.PrimaryButton
import com.fillbook.growthos.ui.components.ScoreBadge
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.copyToClipboard
import com.fillbook.growthos.ui.components.relativeTime
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Border
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Success
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import kotlinx.coroutines.launch

/**
 * Prospecting -- the proactive-outreach half of growth, distinct from
 * Radar/Inbound (which only ever surface people already talking TO
 * @FillbookHQ). This queue surfaces OTHER traders' public X posts worth
 * joining. Same non-negotiable guarantee as everywhere else in this app:
 * nothing here ever posts anything. The furthest any action here reaches
 * is "opened X with a draft copied to the clipboard" -- the owner reviews,
 * edits, and posts every reply themselves (see
 * fillbookhq/docs/social/MASTER_SOCIAL_STRATEGY.md's human-execution
 * boundary, which this screen implements as an app UI instead of a manual
 * chat workflow).
 *
 * Designed to be worked as a fast daily queue: highest-opportunity-score
 * candidate first, one glance to judge relevance, one tap to draft, one
 * tap to copy+open, one tap to record the outcome -- the operating target
 * is completing ~8-15 of these a day without it turning into research.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProspectingScreen(repo: GrowthOsRepository) {
    var items by remember { mutableStateOf<List<ProspectingCandidate>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var draftingId by remember { mutableStateOf<String?>(null) }
    var busyId by remember { mutableStateOf<String?>(null) }
    // Edits the owner makes before copying -- keyed by candidate id so
    // switching cards (or a refresh) never mixes up whose edit is whose.
    // Never sent anywhere until "Replied" is tapped; a draft the owner
    // never touches is copied exactly as the LLM wrote it.
    val editedDrafts = remember { mutableStateMapOf<String, String>() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    suspend fun refresh() {
        try {
            items = repo.getProspectingQueue()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load Prospecting. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    fun startDraft(candidate: ProspectingCandidate) {
        scope.launch {
            draftingId = candidate.id
            try {
                val updated = repo.draftProspectingReply(candidate.id)
                items = items.map { if (it.id == updated.id) updated else it }
                editedDrafts[updated.id] = updated.draftReply.orEmpty()
                actionError = null
            } catch (e: Exception) {
                actionError = "Couldn't draft a reply. Check your connection and try again."
            }
            draftingId = null
        }
    }

    fun copyAndOpen(candidate: ProspectingCandidate) {
        val text = editedDrafts[candidate.id] ?: candidate.draftReply
        if (text != null) copyToClipboard(context, "Reply to @${candidate.authorHandle ?: "unknown"}", text)
        context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(candidate.postUrl)))
        scope.launch {
            runCatching { repo.openProspectingCandidate(candidate.id) }
            snackbarHostState.showSnackbar(if (text != null) "Copied — paste in X" else "Opened in X")
        }
    }

    fun runOutcome(candidate: ProspectingCandidate, action: suspend () -> Unit) {
        scope.launch {
            busyId = candidate.id
            try {
                action()
                items = items.filterNot { it.id == candidate.id }
                editedDrafts.remove(candidate.id)
                actionError = null
            } catch (e: Exception) {
                actionError = "Couldn't record that. Check your connection and try again."
            }
            busyId = null
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Prospecting",
            "Real conversations worth joining -- drafted for you, posted by you.",
            kicker = if (loaded && items.isNotEmpty()) "${items.size} opportunit${if (items.size == 1) "y" else "ies"} queued" else null,
        )

        (errorMessage ?: actionError)?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
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
        } else if (errorMessage == null && items.isEmpty()) {
            PolishedEmptyState(
                icon = Icons.Filled.TrendingUp,
                headline = "Queue is clear",
                subtitle = "New opportunities are found once a day. Check back soon, or pull to refresh.",
            )
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
                    items(items, key = { it.id }) { candidate ->
                        ProspectingCard(
                            candidate = candidate,
                            editedText = editedDrafts[candidate.id],
                            onEditedTextChange = { editedDrafts[candidate.id] = it },
                            drafting = draftingId == candidate.id,
                            busy = busyId == candidate.id,
                            onDraft = { startDraft(candidate) },
                            onCopyAndOpen = { copyAndOpen(candidate) },
                            onReplied = {
                                runOutcome(candidate) {
                                    repo.markProspectingReplied(
                                        candidate.id,
                                        editedDrafts[candidate.id]?.takeIf { it != candidate.draftReply },
                                        candidate.replyMentionsFillbook,
                                        candidate.replyUsedLink,
                                    )
                                }
                            },
                            onSkip = { runOutcome(candidate) { repo.markProspectingSkipped(candidate.id, null) } },
                            onNotRelevant = { runOutcome(candidate) { repo.markProspectingNotRelevant(candidate.id) } },
                            onAlreadyHandled = { runOutcome(candidate) { repo.markProspectingAlreadyHandled(candidate.id) } },
                        )
                    }
                }
            }
        }
    }
    SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun ProspectingCard(
    candidate: ProspectingCandidate,
    editedText: String?,
    onEditedTextChange: (String) -> Unit,
    drafting: Boolean,
    busy: Boolean,
    onDraft: () -> Unit,
    onCopyAndOpen: () -> Unit,
    onReplied: () -> Unit,
    onSkip: () -> Unit,
    onNotRelevant: () -> Unit,
    onAlreadyHandled: () -> Unit,
) {
    GrowthCard(accentBar = Accent) {
        Row(verticalAlignment = Alignment.Top) {
            ScoreBadge(score = candidate.opportunityScore.toInt(), semanticLabel = "Opportunity score ${candidate.opportunityScore.toInt()}")
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "@${candidate.authorHandle ?: "unknown"}",
                    style = MaterialTheme.typography.titleLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Pill("CLASS ${candidate.replyClass}", Accent)
                    Pill(candidate.discoveryLabel, TextSecondary)
                    candidate.authorFollowerCount?.let { count -> Pill(formatFollowerCount(count), TextTertiary) }
                    if (candidate.creatorCandidate) Pill("CREATOR CANDIDATE", Success)
                }
                candidate.postCreatedAt?.let { posted ->
                    relativeTime(posted)?.let { time ->
                        Spacer(Modifier.height(2.dp))
                        Text(time, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        ExpandableText(candidate.postText, style = MaterialTheme.typography.bodyMedium, color = TextPrimary, collapsedMaxLines = 3)

        Spacer(Modifier.height(8.dp))
        TextButton(
            onClick = { onCopyAndOpen() },
            contentPadding = PaddingValues(0.dp),
        ) { Text("View original post", style = MaterialTheme.typography.labelMedium, color = Accent) }

        val draft = candidate.draftReply
        if (draft != null) {
            Spacer(Modifier.height(8.dp))
            Text("DRAFT REPLY", style = MaterialTheme.typography.labelMedium, color = Accent)
            Spacer(Modifier.height(4.dp))
            OutlinedTextField(
                value = editedText ?: draft,
                onValueChange = onEditedTextChange,
                modifier = Modifier.fillMaxWidth(),
                textStyle = MaterialTheme.typography.bodyMedium,
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent, unfocusedBorderColor = Border),
            )
            if (candidate.replyMentionsFillbook == true || candidate.replyUsedLink == true) {
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (candidate.replyMentionsFillbook == true) Pill("MENTIONS FILLBOOK", TextSecondary)
                    if (candidate.replyUsedLink == true) Pill("INCLUDES LINK", TextSecondary)
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        if (draft == null) {
            PrimaryButton(text = "Draft reply", onClick = onDraft, enabled = !drafting, busy = drafting, modifier = Modifier.fillMaxWidth())
        } else {
            PrimaryButton(text = "Copy + Open X", onClick = onCopyAndOpen, enabled = !busy, modifier = Modifier.fillMaxWidth())
        }

        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
            TextButton(onClick = onReplied, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Replied", maxLines = 1) }
            TextButton(onClick = onSkip, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Skip", maxLines = 1) }
            TextButton(onClick = onNotRelevant, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Not relevant", maxLines = 1) }
            TextButton(onClick = onAlreadyHandled, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Handled", maxLines = 1) }
        }
    }
}

private fun formatFollowerCount(count: Int): String = when {
    count >= 1_000_000 -> "${count / 1_000_000}M followers"
    count >= 1_000 -> "${count / 1_000}K followers"
    else -> "$count followers"
}
