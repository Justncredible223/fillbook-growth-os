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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
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
import com.fillbook.growthos.data.InboundEngagement
import com.fillbook.growthos.data.InboundSummary
import com.fillbook.growthos.ui.components.ExpandableText
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.IconPill
import com.fillbook.growthos.ui.components.InsetRow
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.PrimaryButton
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SecondaryButton
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.StatusChip
import com.fillbook.growthos.ui.components.copyToClipboard
import com.fillbook.growthos.ui.components.inboundPriorityColor
import com.fillbook.growthos.ui.components.inboundPriorityLabel
import com.fillbook.growthos.ui.components.inboundStatusLabel
import com.fillbook.growthos.ui.components.inboundStatusTone
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.components.platformIcon
import com.fillbook.growthos.ui.components.relativeTime
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

/**
 * The Inbound Engagement Queue -- surfaces every person who replied to,
 * mentioned, or quoted @FillbookHQ so a meaningful reply is never missed.
 * Never sends anything: "Draft response" only generates text for the
 * owner to review, and "Mark responded" is the one explicit action that
 * records a reply actually went out (this app cannot verify that via the
 * X API, so it's a human confirmation, not an assumption -- see
 * docs/INBOUND_ENGAGEMENT.md).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboundScreen(repo: GrowthOsRepository) {
    var items by remember { mutableStateOf<List<InboundEngagement>>(emptyList()) }
    var summary by remember { mutableStateOf<InboundSummary?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var recovering by remember { mutableStateOf(false) }
    var busyId by remember { mutableStateOf<String?>(null) }
    // Without this, a "Follow up" tap has no way back -- the item just sits
    // wherever it landed in the date-sorted list, potentially many screens
    // down once a handful of newer items arrive. Defaults to null (all
    // active statuses), same as the pre-filter behavior.
    var statusFilter by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    suspend fun refresh() {
        try {
            items = repo.getInboundQueue()
            summary = repo.getInboundSummary()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load inbound engagement. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    // One combined action instead of a separate Copy button and Open
    // icon -- the owner still does the actual posting, this just removes
    // a redundant tap. Never touches status: opening X must never imply
    // a reply was sent, so "Mark responded" stays its own explicit action.
    fun copyAndOpen(item: InboundEngagement) {
        val draft = item.draftResponse
        if (draft != null) copyToClipboard(context, "Reply to @${item.authorHandle ?: "unknown"}", draft)
        val sourceReference = item.sourceReference
        if (sourceReference != null) {
            context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(sourceReference)))
        }
        val message = when {
            draft != null && sourceReference != null -> "Copied — paste in X"
            draft != null -> "Copied"
            sourceReference != null -> "Opened in X"
            else -> null
        }
        if (message != null) scope.launch { snackbarHostState.showSnackbar(message) }
    }

    fun runAction(id: String, action: suspend () -> Unit) {
        scope.launch {
            busyId = id
            try {
                action()
                actionError = null
                refresh()
            } catch (e: Exception) {
                actionError = "Couldn't complete that action. Check your connection and try again."
            }
            busyId = null
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Inbound",
            "People who engaged with @FillbookHQ -- nothing here ever sends itself.",
            kicker = summary?.takeIf { it.needsResponse > 0 }?.let { "${it.needsResponse} need${if (it.needsResponse == 1) "s" else ""} a response" },
        )

        (errorMessage ?: actionError)?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                if (errorMessage != null) {
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                }
            }
        }

        if (!loaded) {
            SkeletonListLoading()
        } else {
            summary?.let { s ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    MetricTile(
                        "Need response",
                        s.needsResponse.toString(),
                        Icons.Filled.Forum,
                        Modifier.weight(1f),
                        valueColor = if (s.needsResponse > 0) Warning else TextPrimary,
                        highlighted = s.needsResponse > 0,
                        highlightColor = Warning,
                    )
                    MetricTile(
                        "Overdue",
                        s.overdue.toString(),
                        Icons.Filled.Forum,
                        Modifier.weight(1f),
                        valueColor = if (s.overdue > 0) Danger else TextPrimary,
                        highlighted = s.overdue > 0,
                        highlightColor = Danger,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    MetricTile("Follow-ups", s.followUp.toString(), Icons.Filled.Repeat, Modifier.weight(1f))
                    MetricTile("Repeat engagers", s.repeatEngagers.toString(), Icons.Filled.Repeat, Modifier.weight(1f))
                }
                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                    OutlinedButton(
                        onClick = { scope.launch { recovering = true; repo.runInboundBacklogRecovery(); refresh(); recovering = false } },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !recovering,
                    ) {
                        Text(if (recovering) "Checking..." else "Check for missed replies")
                    }
                }
            }

            if (errorMessage == null && items.isEmpty()) {
                PolishedEmptyState(
                    icon = Icons.Filled.Forum,
                    headline = "Nothing waiting on you",
                    subtitle = "New replies, mentions, and follow-ups from @FillbookHQ's audience show up here.",
                )
            } else {
                val availableStatuses = remember(items) { items.map { it.status }.distinct() }
                if (availableStatuses.size > 1) {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 20.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        item { InboundFilterChip("All", statusFilter == null) { statusFilter = null } }
                        items(availableStatuses) { status ->
                            InboundFilterChip(inboundStatusLabel(status), statusFilter == status) { statusFilter = status }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                val filteredItems = remember(items, statusFilter) {
                    statusFilter?.let { s -> items.filter { it.status == s } } ?: items
                }
                PullToRefreshBox(
                    isRefreshing = refreshing,
                    onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(filteredItems, key = { it.id }) { item ->
                            InboundCard(
                                item = item,
                                busy = busyId == item.id,
                                onDraft = { runAction(item.id) { repo.draftInboundResponse(item.id) } },
                                onMarkResponded = { runAction(item.id) { repo.markInboundResponded(item.id) } },
                                onFollowUp = { runAction(item.id) { repo.markInboundFollowUp(item.id) } },
                                onClose = { runAction(item.id) { repo.closeInbound(item.id) } },
                                onCopyAndOpen = { copyAndOpen(item) },
                            )
                        }
                    }
                }
            }
        }
    }
    SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun InboundCard(
    item: InboundEngagement,
    busy: Boolean,
    onDraft: () -> Unit,
    onMarkResponded: () -> Unit,
    onFollowUp: () -> Unit,
    onClose: () -> Unit,
    onCopyAndOpen: () -> Unit,
) {
    GrowthCard(accentBar = inboundPriorityColor(item.priority)) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f)) {
                Text("@${item.authorHandle ?: "unknown"}", style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    IconPill(platformDisplayName(item.platform), platformIcon(item.platform), TextSecondary)
                    Pill(inboundPriorityLabel(item.priority), inboundPriorityColor(item.priority))
                    if (item.isRepeatEngager) Pill("REPEAT", Accent)
                }
            }
            StatusChip(inboundStatusLabel(item.status), inboundStatusTone(item.status))
        }

        Spacer(Modifier.height(10.dp))
        ExpandableText(item.body, style = MaterialTheme.typography.bodyMedium, color = TextPrimary, collapsedMaxLines = 3)

        item.inResponseToText?.let { context ->
            Spacer(Modifier.height(8.dp))
            InsetRow {
                Text("Replying to:", style = MaterialTheme.typography.labelMedium, color = TextTertiary)
                Spacer(Modifier.height(2.dp))
                Text(context, style = MaterialTheme.typography.bodyMedium, color = TextSecondary, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
        }

        item.draftResponse?.let { draft ->
            Spacer(Modifier.height(8.dp))
            InsetRow {
                Text("DRAFT", style = MaterialTheme.typography.labelMedium, color = Accent)
                Spacer(Modifier.height(2.dp))
                Text(draft, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            }
        }

        Spacer(Modifier.height(6.dp))
        relativeTime(item.observedAt)?.let { time ->
            Text(time, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
        }

        Spacer(Modifier.height(12.dp))

        val isActive = item.status !in setOf("responded", "closed")
        if (isActive) {
            if (item.draftResponse == null) {
                PrimaryButton(text = "Draft response", onClick = onDraft, enabled = !busy, busy = busy, modifier = Modifier.fillMaxWidth())
            } else {
                PrimaryButton(
                    text = if (item.sourceReference != null) "Copy + Open X" else "Copy reply",
                    onClick = onCopyAndOpen,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = onFollowUp, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Follow up") }
                TextButton(onClick = onMarkResponded, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Mark responded") }
                TextButton(onClick = onClose, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Close") }
            }
        } else if (item.sourceReference != null) {
            SecondaryButton(text = "Open on ${platformDisplayName(item.platform)}", onClick = onCopyAndOpen, modifier = Modifier.fillMaxWidth())
        }
    }
}


@Composable
private fun InboundFilterChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = Accent.copy(alpha = 0.2f),
            selectedLabelColor = Accent,
            containerColor = Surface,
            labelColor = TextSecondary,
        ),
    )
}
