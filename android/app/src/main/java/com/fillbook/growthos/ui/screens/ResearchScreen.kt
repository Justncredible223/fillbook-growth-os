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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Science
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.NetworkException
import com.fillbook.growthos.data.Opportunity
import com.fillbook.growthos.data.ResearchRecord
import com.fillbook.growthos.data.authErrorMessage
import com.fillbook.growthos.data.extractResearchRequestErrorMessage
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.IconPill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SecondaryButton
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.StatusTone
import com.fillbook.growthos.ui.components.relativeTime
import com.fillbook.growthos.ui.components.statusToneColor
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import kotlinx.coroutines.launch

/**
 * Research Lab (2026-09-07): the owner requests a private, internal
 * research document (never published or shown to anyone else directly --
 * see backend/src/content/researchWriter.ts's own doc comment) on either a
 * custom typed topic or an existing Radar opportunity, and reviews the
 * finished report here before deciding whether it should inform any
 * public content. Mirrors VideoStatusScreen's own "Create Fillbook
 * Video" two-step entry+confirmation flow and busy-state/error-handling
 * conventions exactly -- this is the same pipeline (grounding, budget/
 * paused gate, idempotency) with a different, lighter-reviewed content
 * shape, not a separate feature built from scratch.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResearchScreen(repo: GrowthOsRepository, onNavigateToApprovals: (() -> Unit)? = null) {
    var records by remember { mutableStateOf<List<ResearchRecord>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    // Only the id is saved/tracked here, never the ResearchRecord object
    // itself -- an explicit established rule from the video feature's own
    // bugfix (a network/domain object is never a candidate for persisted
    // UI state; see VideoStatusScreen's selectedOpportunityId for the
    // same reasoning).
    var selectedRecordId by rememberSaveable { mutableStateOf<String?>(null) }

    var showCreateDialog by remember { mutableStateOf(false) }
    var showConfirmDialog by remember { mutableStateOf(false) }
    var topicInput by rememberSaveable { mutableStateOf("") }
    var useExistingOpportunity by rememberSaveable { mutableStateOf(false) }
    var selectedOpportunityId by rememberSaveable { mutableStateOf<String?>(null) }
    var eligibleOpportunities by remember { mutableStateOf<List<Opportunity>>(emptyList()) }
    var loadingOpportunities by remember { mutableStateOf(false) }
    // Doubles as busy/spinner state AND the duplicate-tap guard -- same
    // pattern as VideoStatusScreen's creatingVideoScript.
    var creatingResearch by remember { mutableStateOf(false) }
    var createResultMessage by remember { mutableStateOf<String?>(null) }

    suspend fun refresh() {
        try {
            records = repo.listResearch()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = authErrorMessage(e) ?: "Couldn't load research. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    fun loadEligibleOpportunities() {
        scope.launch {
            loadingOpportunities = true
            eligibleOpportunities = try {
                // Same discriminator VideoStatusScreen already uses --
                // engagement (reply-worthy) opportunities are never a fit
                // for a research report either.
                repo.getOpportunities().filter { !it.isEngagementOpportunity }
            } catch (e: Exception) {
                emptyList()
            }
            loadingOpportunities = false
        }
    }

    fun requestResearch() {
        // Duplicate-tap guard: the Confirm button is also disabled while
        // this is true, but a second tap can still land in the same frame
        // before recomposition disables it.
        if (creatingResearch) return
        val topic = topicInput.trim()
        val opportunityId = selectedOpportunityId
        scope.launch {
            creatingResearch = true
            try {
                val result = repo.requestResearch(
                    topic = if (!useExistingOpportunity) topic else null,
                    opportunityId = if (useExistingOpportunity) opportunityId else null,
                )
                createResultMessage = if (result.finalStage == "ready_for_owner") {
                    "Research sent to Approvals for your review."
                } else {
                    "Didn't clear the mechanical check" +
                        if (result.blockReasons.isNotEmpty()) ": ${result.blockReasons.joinToString("; ")}" else "."
                }
                showConfirmDialog = false
                showCreateDialog = false
                topicInput = ""
                selectedOpportunityId = null
                useExistingOpportunity = false
                refresh()
            } catch (e: NetworkException) {
                createResultMessage = extractResearchRequestErrorMessage(e.httpCode, e.message)
                    ?: authErrorMessage(e)
                    ?: "Couldn't create the research report. Check your connection and try again."
            } catch (e: Exception) {
                createResultMessage = "Couldn't create the research report. Check your connection and try again."
            }
            creatingResearch = false
        }
    }

    val selectedRecord = records.firstOrNull { it.id == selectedRecordId }

    Box(modifier = Modifier.fillMaxSize()) {
        if (selectedRecord != null) {
            ResearchDetailView(
                record = selectedRecord,
                onBack = { selectedRecordId = null },
                onGoToApprovals = onNavigateToApprovals,
            )
        } else {
            Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                ScreenHeader(
                    "Research Lab",
                    "Request a private research report before committing to a bigger content bet -- reviewed here first, never auto-published.",
                    kicker = if (loaded && records.isNotEmpty()) "${records.size} report${if (records.size == 1) "" else "s"}" else null,
                )

                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp)) {
                    SecondaryButton(
                        text = "+ Create research",
                        onClick = {
                            topicInput = ""
                            selectedOpportunityId = null
                            useExistingOpportunity = false
                            showCreateDialog = true
                        },
                    )
                }

                errorMessage?.let { message ->
                    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                    }
                }

                createResultMessage?.let { message ->
                    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(message, style = MaterialTheme.typography.bodyMedium, color = TextSecondary, modifier = Modifier.weight(1f))
                        TextButton(onClick = { createResultMessage = null }) { Text("Dismiss") }
                    }
                }

                if (!loaded) {
                    SkeletonListLoading()
                } else {
                    // Same PullToRefreshBox-wraps-both-branches fix already
                    // applied to VideoStatusScreen/ProspectingScreen -- the
                    // empty branch uses a LazyColumn (a genuine nested-scroll
                    // participant), never a bare PolishedEmptyState, so pull-
                    // to-refresh actually works while the list is empty.
                    PullToRefreshBox(
                        isRefreshing = refreshing,
                        onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        if (errorMessage == null && records.isEmpty()) {
                            LazyColumn(modifier = Modifier.fillMaxSize()) {
                                item {
                                    PolishedEmptyState(
                                        icon = Icons.Filled.Science,
                                        headline = "No research yet",
                                        subtitle = "Request research on a topic or an existing Radar opportunity to see it here.",
                                    )
                                }
                            }
                        } else {
                            LazyColumn(
                                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                items(records, key = { it.id }) { record ->
                                    ResearchRecordCard(record = record, onClick = { selectedRecordId = record.id })
                                }
                            }
                        }
                    }
                }
            }
        }
        SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
    }

    if (showCreateDialog) {
        val canContinue = if (useExistingOpportunity) selectedOpportunityId != null else topicInput.trim().length >= 3
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text("Create research") },
            text = {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = !useExistingOpportunity, onClick = { useExistingOpportunity = false })
                        Text("Custom topic", style = MaterialTheme.typography.bodyMedium)
                    }
                    if (!useExistingOpportunity) {
                        OutlinedTextField(
                            value = topicInput,
                            onValueChange = { topicInput = it },
                            label = { Text("Futures/prop-firm/trading-discipline research question") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text(
                            "Must be about futures trading, prop firms, or trading discipline -- an unrelated topic is rejected before anything is generated.",
                            style = MaterialTheme.typography.labelMedium,
                            color = TextTertiary,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(
                            selected = useExistingOpportunity,
                            onClick = {
                                useExistingOpportunity = true
                                if (eligibleOpportunities.isEmpty() && !loadingOpportunities) loadEligibleOpportunities()
                            },
                        )
                        Text("Existing Radar opportunity", style = MaterialTheme.typography.bodyMedium)
                    }
                    if (useExistingOpportunity) {
                        if (loadingOpportunities) {
                            CircularProgressIndicator(modifier = Modifier.height(18.dp))
                        } else if (eligibleOpportunities.isEmpty()) {
                            Text("No eligible opportunities right now.", style = MaterialTheme.typography.bodySmall, color = TextTertiary)
                        } else {
                            LazyColumn(modifier = Modifier.fillMaxWidth().height(180.dp)) {
                                items(eligibleOpportunities, key = { it.id }) { opp ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        RadioButton(
                                            selected = selectedOpportunityId == opp.id,
                                            onClick = { selectedOpportunityId = opp.id },
                                        )
                                        Text(opp.title, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { showCreateDialog = false; showConfirmDialog = true },
                    enabled = canContinue,
                ) { Text("Continue") }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) { Text("Cancel") }
            },
        )
    }

    if (showConfirmDialog) {
        val topicSummary = if (useExistingOpportunity) {
            eligibleOpportunities.firstOrNull { it.id == selectedOpportunityId }?.title ?: "the selected opportunity"
        } else {
            "\"${topicInput.trim()}\""
        }
        AlertDialog(
            onDismissRequest = { if (!creatingResearch) showConfirmDialog = false },
            title = { Text("Create a real research report?") },
            text = {
                Column {
                    Text(
                        "This uses paid LLM budget and creates a REAL research draft for $topicSummary.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("• It will NOT post or publish anywhere automatically.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                    Text("• It lands in Approvals as a private document requiring your review.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                    Text("• You still decide separately whether and how to turn it into content.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                }
            },
            confirmButton = {
                TextButton(onClick = { requestResearch() }, enabled = !creatingResearch) {
                    Text(if (creatingResearch) "Creating…" else "Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmDialog = false }, enabled = !creatingResearch) { Text("Cancel") }
            },
        )
    }
}

internal fun researchStatusTone(status: String): StatusTone = when (status) {
    "approved" -> StatusTone.READY
    "ready_for_review" -> StatusTone.WAITING
    "rejected", "failed" -> StatusTone.FAILED
    else -> StatusTone.NEUTRAL
}

internal fun researchStatusLabel(status: String): String = when (status) {
    "ready_for_review" -> "Ready for review"
    "approved" -> "Approved"
    "rejected" -> "Rejected"
    "failed" -> "Failed"
    else -> status.replaceFirstChar { it.uppercase() }
}

@Composable
private fun ResearchRecordCard(record: ResearchRecord, onClick: () -> Unit) {
    val tone = researchStatusTone(record.status)
    GrowthCard(accentBar = statusToneColor(tone), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconPill(researchStatusLabel(record.status), Icons.Filled.Science, statusToneColor(tone))
            Spacer(Modifier.weight(1f))
            relativeTime(record.createdAt)?.let { time ->
                Text(time, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(record.title, style = MaterialTheme.typography.titleMedium, color = TextPrimary, maxLines = 2)
        Spacer(Modifier.height(4.dp))
        Text(record.summary, style = MaterialTheme.typography.bodyMedium, color = TextSecondary, maxLines = 3)
        record.costUsd?.let { cost ->
            Spacer(Modifier.height(6.dp))
            Text("Cost: \$${"%.3f".format(cost)}", style = MaterialTheme.typography.labelMedium, color = TextTertiary)
        }
    }
}

@Composable
private fun ResearchDetailView(record: ResearchRecord, onBack: () -> Unit, onGoToApprovals: (() -> Unit)?) {
    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Back to research list")
            }
            Text(record.title, style = MaterialTheme.typography.titleLarge, color = TextPrimary, maxLines = 2, modifier = Modifier.weight(1f))
        }
        LazyColumn(contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                val tone = researchStatusTone(record.status)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconPill(researchStatusLabel(record.status), Icons.Filled.Science, statusToneColor(tone))
                    Spacer(Modifier.weight(1f))
                    relativeTime(record.createdAt)?.let { time ->
                        Text(time, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
                    }
                }
            }
            item { ResearchSection("QUESTION", record.question) }
            item { ResearchSection("SUMMARY", record.summary) }
            item { ResearchListSection("KEY FINDINGS", record.findings) }
            item { ResearchListSection("EVIDENCE/SOURCES", record.evidenceReferences, emptyText = "(none cited)") }
            item { ResearchListSection("CAVEATS/LIMITATIONS", record.caveats, emptyText = "(none)") }
            item { ResearchListSection("SUGGESTED CONTENT ANGLES", record.contentAngles) }
            record.costUsd?.let { cost ->
                item { Text("Cost: \$${"%.3f".format(cost)}", style = MaterialTheme.typography.labelMedium, color = TextTertiary) }
            }
            if (record.status == "ready_for_review" && onGoToApprovals != null) {
                item {
                    SecondaryButton(
                        text = "Go to Approvals",
                        onClick = onGoToApprovals,
                    )
                }
            }
            if (record.status == "approved") {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = statusToneColor(StatusTone.READY))
                        Spacer(Modifier.height(0.dp))
                        Text(" Approved -- you've decided to act on this research.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                    }
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun ResearchSection(label: String, body: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
        Spacer(Modifier.height(4.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
    }
}

@Composable
private fun ResearchListSection(label: String, items: List<String>, emptyText: String? = null) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
        Spacer(Modifier.height(4.dp))
        if (items.isEmpty()) {
            Text(emptyText ?: "(none)", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        } else {
            items.forEach { entry ->
                Text("• $entry", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            }
        }
    }
}
