package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.Handshake
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import com.fillbook.growthos.data.PartnerCategory
import com.fillbook.growthos.data.PartnershipDiscoveryRunResult
import com.fillbook.growthos.data.PartnershipDraftRejectedException
import com.fillbook.growthos.data.PartnershipProspect
import com.fillbook.growthos.data.PartnershipStage
import com.fillbook.growthos.ui.components.ExpandableText
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.PrimaryButton
import com.fillbook.growthos.ui.components.QuietStatusLabel
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.StatusTone
import com.fillbook.growthos.ui.components.copyToClipboard
import com.fillbook.growthos.ui.components.openExternalUrl
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Border
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Success
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

/**
 * Partnerships -- prospect a real organization, qualify it with real
 * evidence, generate and edit a pitch, contact them, and track the
 * relationship through to a pilot or a real partnership. Same
 * non-negotiable guarantee as Prospecting/Inbound: nothing here ever
 * sends anything. The furthest any action reaches is "opened the
 * channel's own composer with the (possibly edited) pitch copied" --
 * "Mark contacted" is a separate, later, explicit confirmation, never
 * inferred from copying or opening a channel. See
 * docs/PARTNERSHIPS_MISSION.md.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PartnershipsScreen(repo: GrowthOsRepository) {
    var items by remember { mutableStateOf<List<PartnershipProspect>>(emptyList()) }
    var lastDiscoveryRun by remember { mutableStateOf<PartnershipDiscoveryRunResult?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    // Full raw reviewer/skip-reason text -- shown only behind an explicit
    // "Show details" disclosure, never dumped alongside the short reason.
    var actionErrorDetails by remember { mutableStateOf<String?>(null) }
    var actionErrorDetailsExpanded by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var discoveryBusy by remember { mutableStateOf(false) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var showCreateDialog by remember { mutableStateOf(false) }
    var contactingId by remember { mutableStateOf<String?>(null) }
    var pilotDialogProspect by remember { mutableStateOf<PartnershipProspect?>(null) }
    var pilotDialogError by remember { mutableStateOf<String?>(null) }
    var pilotDialogBusy by remember { mutableStateOf(false) }
    // Owner edits to the generated pitch before it's sent -- keyed by
    // prospect id, never persisted until "Mark contacted" is tapped.
    val editedDrafts = remember { mutableStateMapOf<String, String>() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    suspend fun refresh() {
        try {
            val summary = repo.getPartnerships()
            items = summary.items
            lastDiscoveryRun = summary.lastDiscoveryRun
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load Partnerships. Check your connection and try again."
        }
        loaded = true
    }

    fun runDiscoveryRefresh() {
        scope.launch {
            discoveryBusy = true
            try {
                lastDiscoveryRun = repo.refreshPartnershipDiscovery()
                refresh()
            } catch (e: Exception) {
                actionError = "Couldn't refresh discovery. Check your connection and try again."
            }
            discoveryBusy = false
        }
    }

    LaunchedEffect(Unit) { refresh() }

    fun runAction(prospect: PartnershipProspect, action: suspend () -> Unit) {
        scope.launch {
            busyId = prospect.id
            try {
                action()
                refresh()
                actionError = null
                actionErrorDetails = null
            } catch (e: PartnershipDraftRejectedException) {
                // A real, meaningful outcome (failed review gate, budget exhausted)
                // -- never a "check your connection" problem. Short reason shown
                // directly; the full raw reviewer text stays behind "Show details"
                // (see actionErrorDetails). The prospect's own existing draft/edit
                // (editedDrafts, items) is untouched here -- refresh() was never
                // called, so nothing about the prior state is replaced.
                actionError = e.shortReason
                actionErrorDetails = e.details
                actionErrorDetailsExpanded = false
            } catch (e: Exception) {
                actionError = "Couldn't complete that action. Check your connection and try again."
                actionErrorDetails = null
            }
            busyId = null
        }
    }

    fun channelForRoute(route: String?): String = when {
        route == null -> "the contact"
        route.startsWith("email", ignoreCase = true) -> "Email"
        route.contains("x", ignoreCase = true) || route.contains("twitter", ignoreCase = true) -> "X"
        else -> "the contact"
    }

    fun copyAndOpen(prospect: PartnershipProspect) {
        val text = editedDrafts[prospect.id] ?: prospect.previewText ?: return
        copyToClipboard(context, "Partnership pitch to ${prospect.organizationName}", text)
        val route = prospect.contactRoute
        val opened = when {
            route == null -> false
            route.startsWith("email", ignoreCase = true) -> {
                val address = route.substringAfter(":").trim()
                openExternalUrl(context, "mailto:$address")
            }
            route.contains("x", ignoreCase = true) -> {
                // A partnership pitch is a DM to a specific recipient, never a
                // public post -- "https://x.com/compose/post" (this screen's
                // old behavior, copied from Home's Today's X Post, which IS a
                // public post) opened the generic "What's happening?" composer
                // instead of anything aimed at the recipient, confirmed on a
                // real device. X has no reliable handle-based DM-compose deep
                // link (only a numeric recipient_id, which discovery never
                // collects), so the honest, correct destination is the
                // recipient's own profile -- the owner taps Message from there.
                val handle = extractXHandle(route)
                if (handle != null) openExternalUrl(context, "https://x.com/$handle") else openExternalUrl(context, "https://x.com/compose/post")
            }
            else -> false
        }
        val isXDm = route?.contains("x", ignoreCase = true) == true
        scope.launch {
            snackbarHostState.showSnackbar(
                when {
                    opened && isXDm -> "Copied -- their X profile opened, tap Message to paste and send"
                    opened -> "Copied -- ${channelForRoute(route)} opened, contacting is still up to you"
                    else -> "Copied, but couldn't open ${channelForRoute(route)} automatically"
                },
            )
        }
        contactingId = prospect.id
    }

    Box(modifier = Modifier.fillMaxSize()) {
    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Partnerships",
            "Real organizations, real evidence, real pilots -- nothing here ever sends itself.",
            kicker = if (loaded && items.isNotEmpty()) "${items.size} prospect${if (items.size == 1) "" else "s"}" else null,
        )

        (errorMessage ?: actionError)?.let { message ->
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                    if (errorMessage != null) {
                        TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                    } else {
                        TextButton(onClick = { actionError = null; actionErrorDetails = null }) { Text("Dismiss") }
                    }
                }
                // The full raw reviewer/skip-reason text -- long and technical
                // (a real one carries all 9 reviewers' own reasoning), so it
                // stays collapsed by default rather than dumped under the
                // short reason above.
                if (errorMessage == null && actionErrorDetails != null) {
                    TextButton(onClick = { actionErrorDetailsExpanded = !actionErrorDetailsExpanded }) {
                        Text(if (actionErrorDetailsExpanded) "Hide details" else "Show details")
                    }
                    if (actionErrorDetailsExpanded) {
                        Text(actionErrorDetails!!, style = MaterialTheme.typography.bodySmall, color = TextTertiary)
                    }
                }
            }
        }

        if (!loaded) {
            SkeletonListLoading()
        } else if (errorMessage == null && items.isEmpty()) {
            PolishedEmptyState(
                icon = Icons.Filled.Handshake,
                headline = "No recommendations yet",
                subtitle = "Discovery hasn't found a qualifying match yet -- tap Refresh discovery below, or add a prospect yourself.",
            )
            Row(modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PrimaryButton(text = if (discoveryBusy) "Searching..." else "Refresh discovery", onClick = { runDiscoveryRefresh() }, enabled = !discoveryBusy, busy = discoveryBusy, modifier = Modifier.weight(1f))
            }
            Row(modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
                TextButton(onClick = { showCreateDialog = true }) { Text("+ Add prospect") }
            }
        } else {
            // Recommendations = not yet contacted (the shortlist the owner reviews and acts on);
            // In progress = already contacted or further along (existing pipeline tracking).
            val recommendations = items
                .filter { it.stage == PartnershipStage.PROSPECT || it.stage == PartnershipStage.QUALIFIED || it.stage == PartnershipStage.DRAFT_READY }
                .sortedByDescending { it.discoveryScore ?: -1 }
            val inProgress = items.filter {
                it.stage == PartnershipStage.CONTACTED || it.stage == PartnershipStage.REPLIED || it.stage == PartnershipStage.PILOT || it.stage == PartnershipStage.ACTIVE_PARTNER
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
                    item {
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Recommended partners", style = MaterialTheme.typography.titleMedium, color = TextPrimary, modifier = Modifier.weight(1f))
                                TextButton(onClick = { runDiscoveryRefresh() }, enabled = !discoveryBusy) { Text(if (discoveryBusy) "Searching..." else "Refresh discovery") }
                            }
                            discoveryStatusLine(lastDiscoveryRun)?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = TextTertiary)
                            }
                        }
                    }
                    if (recommendations.isEmpty()) {
                        item { Text("No recommendations right now.", style = MaterialTheme.typography.bodySmall, color = TextTertiary) }
                    }
                    items(recommendations, key = { it.id }) { prospect ->
                        PartnershipCard(
                            prospect = prospect,
                            editedText = editedDrafts[prospect.id],
                            onEditedTextChange = { editedDrafts[prospect.id] = it },
                            busy = busyId == prospect.id,
                            onQualify = { runAction(prospect) { repo.qualifyPartnership(prospect.id, "Owner-reviewed: futures-relevant audience, no competing journal found.") } },
                            onGenerateDraft = { runAction(prospect) { repo.generatePartnershipDraft(prospect.id) } },
                            onCopyAndOpen = { copyAndOpen(prospect) },
                            onMarkContacted = {
                                val finalText = editedDrafts[prospect.id] ?: prospect.previewText.orEmpty()
                                runAction(prospect) { repo.markPartnershipContacted(prospect.id, channelForRoute(prospect.contactRoute), finalText) }
                            },
                            onRecordReply = { runAction(prospect) { repo.recordPartnershipReply(prospect.id, "Owner recorded a reply.") } },
                            onStartPilot = { pilotDialogProspect = prospect },
                            onArchive = { runAction(prospect) { repo.archivePartnership(prospect.id, "Not pursuing further.") } },
                            onDoNotContact = { runAction(prospect) { repo.markPartnershipDoNotContact(prospect.id, "Owner marked do-not-contact.") } },
                        )
                    }

                    item {
                        Row(modifier = Modifier.padding(top = 4.dp)) {
                            TextButton(onClick = { showCreateDialog = true }) { Text("+ Add prospect") }
                        }
                    }

                    if (inProgress.isNotEmpty()) {
                        item {
                            Text("In progress", style = MaterialTheme.typography.titleMedium, color = TextPrimary, modifier = Modifier.padding(top = 8.dp))
                        }
                        items(inProgress, key = { it.id }) { prospect ->
                            PartnershipCard(
                                prospect = prospect,
                                editedText = editedDrafts[prospect.id],
                                onEditedTextChange = { editedDrafts[prospect.id] = it },
                                busy = busyId == prospect.id,
                                onQualify = { runAction(prospect) { repo.qualifyPartnership(prospect.id, "Owner-reviewed: futures-relevant audience, no competing journal found.") } },
                                onGenerateDraft = { runAction(prospect) { repo.generatePartnershipDraft(prospect.id) } },
                                onCopyAndOpen = { copyAndOpen(prospect) },
                                onMarkContacted = {
                                    val finalText = editedDrafts[prospect.id] ?: prospect.previewText.orEmpty()
                                    runAction(prospect) { repo.markPartnershipContacted(prospect.id, channelForRoute(prospect.contactRoute), finalText) }
                                },
                                onRecordReply = { runAction(prospect) { repo.recordPartnershipReply(prospect.id, "Owner recorded a reply.") } },
                                onStartPilot = { pilotDialogProspect = prospect },
                                onArchive = { runAction(prospect) { repo.archivePartnership(prospect.id, "Not pursuing further.") } },
                                onDoNotContact = { runAction(prospect) { repo.markPartnershipDoNotContact(prospect.id, "Owner marked do-not-contact.") } },
                            )
                        }
                    }
                }
            }
        }
    }
    SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
    }

    if (showCreateDialog) {
        CreatePartnershipDialog(
            onDismiss = { showCreateDialog = false },
            onCreate = { organizationName, category, websiteUrl, collaboration ->
                scope.launch {
                    try {
                        repo.createPartnership(organizationName, null, category, websiteUrl, collaboration)
                        refresh()
                        showCreateDialog = false
                    } catch (e: Exception) {
                        actionError = "Couldn't create that prospect. Check your connection and try again."
                    }
                }
            },
        )
    }

    pilotDialogProspect?.let { prospect ->
        StartPilotDialog(
            organizationName = prospect.organizationName,
            busy = pilotDialogBusy,
            errorMessage = pilotDialogError,
            onDismiss = { pilotDialogProspect = null; pilotDialogError = null },
            onConfirm = { termsAgreed, startDate ->
                scope.launch {
                    pilotDialogBusy = true
                    try {
                        repo.startPartnershipPilot(prospect.id, termsAgreed, startDate)
                        refresh()
                        pilotDialogProspect = null
                        pilotDialogError = null
                    } catch (e: Exception) {
                        pilotDialogError = "Couldn't start the pilot. Check your connection and try again."
                    }
                    pilotDialogBusy = false
                }
            },
        )
    }
}

@Composable
private fun StartPilotDialog(organizationName: String, busy: Boolean, errorMessage: String?, onDismiss: () -> Unit, onConfirm: (String, String) -> Unit) {
    var termsAgreed by remember { mutableStateOf("") }
    var startDate by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Start pilot with $organizationName") },
        text = {
            Column {
                OutlinedTextField(value = termsAgreed, onValueChange = { termsAgreed = it }, label = { Text("Agreed terms") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = startDate, onValueChange = { startDate = it }, label = { Text("Start date (YYYY-MM-DD)") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                errorMessage?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Danger)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(termsAgreed, startDate) },
                enabled = !busy && termsAgreed.isNotBlank() && startDate.isNotBlank(),
            ) { Text(if (busy) "Starting..." else "Start pilot") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CreatePartnershipDialog(onDismiss: () -> Unit, onCreate: (String, PartnerCategory, String?, String?) -> Unit) {
    var organizationName by remember { mutableStateOf("") }
    var websiteUrl by remember { mutableStateOf("") }
    var collaboration by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(PartnerCategory.EDUCATOR_COACH) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add prospect") },
        text = {
            Column {
                OutlinedTextField(value = organizationName, onValueChange = { organizationName = it }, label = { Text("Organization name") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = websiteUrl, onValueChange = { websiteUrl = it }, label = { Text("Website URL (optional)") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = collaboration, onValueChange = { collaboration = it }, label = { Text("Proposed collaboration") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    PartnerCategory.entries.forEach { c ->
                        val selected = c == category
                        TextButton(onClick = { category = c }) {
                            Text(c.name.replace("_", " "), color = if (selected) Accent else TextSecondary)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(organizationName, category, websiteUrl.ifBlank { null }, collaboration.ifBlank { null }) },
                enabled = organizationName.isNotBlank(),
            ) { Text("Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * The four discovery states the mission calls for (running / no qualified
 * matches / source failure / budget exhaustion) plus the two additional
 * real states this feature can actually be in (never run yet; skipped by
 * its own cadence/interval gate, distinct from a genuine zero-matches
 * run). "Running" itself is the caller's own discoveryBusy flag, not
 * something this reads from -- there's no server-tracked async job to
 * poll (see discovery.ts's own doc comment on why "running" is a
 * request-in-flight state here, not a background job status).
 */
private fun discoveryStatusLine(lastRun: PartnershipDiscoveryRunResult?): String? {
    if (lastRun == null) return "Discovery hasn't run yet."
    return when (lastRun.status) {
        "found" -> "Last discovery run found ${lastRun.newCandidates} new candidate${if (lastRun.newCandidates == 1) "" else "s"} (via ${lastRun.sourcesSearched.joinToString(", ")})."
        "no_matches" -> "Last discovery run found no qualifying matches (via ${lastRun.sourcesSearched.joinToString(", ").ifEmpty { "existing records" }})."
        "budget_exhausted" -> "Discovery is paused -- this month's Partnerships budget is used up. ${lastRun.skipReason.orEmpty()}"
        "skipped_cadence" -> lastRun.skipReason?.let { "Discovery was skipped: $it" } ?: "Discovery was skipped."
        "error" -> "Last discovery run failed: ${lastRun.error ?: "unknown error"}."
        else -> null
    }
}

private fun stageLabel(stage: PartnershipStage): String = when (stage) {
    PartnershipStage.PROSPECT -> "Prospect"
    PartnershipStage.QUALIFIED -> "Qualified"
    PartnershipStage.DRAFT_READY -> "Draft ready"
    PartnershipStage.CONTACTED -> "Contacted"
    PartnershipStage.REPLIED -> "Replied"
    PartnershipStage.PILOT -> "Pilot"
    PartnershipStage.ACTIVE_PARTNER -> "Active partner"
    PartnershipStage.CLOSED -> "Closed"
    PartnershipStage.ARCHIVED -> "Archived"
    PartnershipStage.DO_NOT_CONTACT -> "Do not contact"
}

/**
 * True only while the pitch is still a candidate the owner is shaping
 * (QUALIFIED has no draft yet but is included harmlessly; DRAFT_READY is
 * the real editable state). False from CONTACTED onward -- once actually
 * sent, the text is history and must render read-only rather than imply
 * it can still be changed. Extracted as a pure function so this exact
 * gating is unit-testable without a Compose UI test harness, matching
 * this project's PlatformActionsTest.kt convention.
 */
fun isPitchStillEditable(stage: PartnershipStage): Boolean =
    stage == PartnershipStage.QUALIFIED || stage == PartnershipStage.DRAFT_READY

/**
 * Pulls the bare handle out of a contactRoute like "X DM: @phinloco" so
 * Copy + Open can send the owner to that specific recipient's profile
 * instead of X's generic public-post composer -- confirmed wrong on a
 * real device (a partnership pitch is a DM, never a public post, and
 * "https://x.com/compose/post" opens the "What's happening?" screen
 * with no connection to the recipient at all). Null when no handle can
 * be parsed, so the caller can fall back rather than open a broken URL.
 */
fun extractXHandle(contactRoute: String?): String? =
    // Negative lookbehind excludes an "@" embedded mid-word (e.g. the
    // "@example" inside "dana@example.com") -- only a real handle mention
    // (preceded by whitespace, a colon, or the string start) counts.
    contactRoute?.let { Regex("(?<![\\w.])@([A-Za-z0-9_]+)").find(it)?.groupValues?.get(1) }

private fun stageTone(stage: PartnershipStage): StatusTone = when (stage) {
    PartnershipStage.PROSPECT -> StatusTone.NEUTRAL
    PartnershipStage.QUALIFIED -> StatusTone.WAITING
    PartnershipStage.DRAFT_READY -> StatusTone.WAITING
    PartnershipStage.CONTACTED -> StatusTone.ACTIVE
    PartnershipStage.REPLIED -> StatusTone.READY
    PartnershipStage.PILOT -> StatusTone.ACTIVE
    PartnershipStage.ACTIVE_PARTNER -> StatusTone.READY
    PartnershipStage.CLOSED -> StatusTone.NEUTRAL
    PartnershipStage.ARCHIVED -> StatusTone.NEUTRAL
    PartnershipStage.DO_NOT_CONTACT -> StatusTone.BLOCKED
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PartnershipCard(
    prospect: PartnershipProspect,
    editedText: String?,
    onEditedTextChange: (String) -> Unit,
    busy: Boolean,
    onQualify: () -> Unit,
    onGenerateDraft: () -> Unit,
    onCopyAndOpen: () -> Unit,
    onMarkContacted: () -> Unit,
    onRecordReply: () -> Unit,
    onStartPilot: () -> Unit,
    onArchive: () -> Unit,
    onDoNotContact: () -> Unit,
) {
    GrowthCard(accentBar = if (prospect.stage == PartnershipStage.DRAFT_READY) Accent else null) {
        Row(verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f)) {
                Text(prospect.organizationName, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                prospect.contactName?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = TextSecondary) }
            }
            QuietStatusLabel(stageLabel(prospect.stage), stageTone(prospect.stage))
        }

        Spacer(Modifier.height(6.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Pill(prospect.partnerCategory.name.replace("_", " "), TextSecondary)
            prospect.contactRoute?.let { Pill(it, TextTertiary) }
            prospect.discoveryScore?.let { score ->
                Pill("Match ${score}/100 (${prospect.discoveryConfidence ?: "unknown"} confidence)", if (score >= 60) Accent else TextTertiary)
            }
        }

        // A discovered candidate's "why" is the recommendation itself --
        // shown prominently, not buried as generic "research" the way a
        // manually entered prospect's own notes are.
        val isDiscovered = prospect.discoveredVia != "manual"
        if (isDiscovered && prospect.qualificationRationale != null) {
            Spacer(Modifier.height(8.dp))
            Text("WHY THIS PARTNER", style = MaterialTheme.typography.labelMedium, color = Accent)
            Spacer(Modifier.height(2.dp))
            ExpandableText(prospect.qualificationRationale, style = MaterialTheme.typography.bodyMedium, color = TextPrimary, collapsedMaxLines = 3)
        }

        // Secondary "view research" section -- source URLs, evidence, rationale.
        if (prospect.audienceFocus != null || (!isDiscovered && prospect.futuresRelevanceEvidence != null) || (!isDiscovered && prospect.qualificationRationale != null) || prospect.sourceUrls.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Column {
                prospect.audienceFocus?.let { Text("Audience: $it", style = MaterialTheme.typography.bodySmall, color = TextTertiary) }
                if (!isDiscovered) {
                    prospect.futuresRelevanceEvidence?.let { Text("Evidence: $it", style = MaterialTheme.typography.bodySmall, color = TextTertiary) }
                    prospect.qualificationRationale?.let { Text("Rationale: $it", style = MaterialTheme.typography.bodySmall, color = TextTertiary) }
                }
                if (prospect.sourceUrls.isNotEmpty()) {
                    Text("Sources: ${prospect.sourceUrls.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = TextTertiary)
                }
            }
        }

        prospect.proposedCollaboration?.let { collaboration ->
            Spacer(Modifier.height(8.dp))
            Text(if (isDiscovered) "SUGGESTED COLLABORATION" else "PROPOSED COLLABORATION", style = MaterialTheme.typography.labelMedium, color = Accent)
            Spacer(Modifier.height(2.dp))
            ExpandableText(collaboration, style = MaterialTheme.typography.bodyMedium, color = TextPrimary, collapsedMaxLines = 3)
        }

        val draft = prospect.previewText
        // Editable only up through DRAFT_READY -- the message is still a
        // candidate the owner is shaping. From CONTACTED onward, whatever
        // was actually sent is history: showing it in an editable field
        // would wrongly imply it can still be changed, so it renders as
        // plain, non-editable text instead (see the fixture-validation
        // finding this fixed).
        val isStillEditable = isPitchStillEditable(prospect.stage)
        if (draft != null) {
            Spacer(Modifier.height(8.dp))
            Text(if (isStillEditable) "PITCH DRAFT" else "PITCH SENT", style = MaterialTheme.typography.labelMedium, color = Accent)
            Spacer(Modifier.height(4.dp))
            if (isStillEditable) {
                OutlinedTextField(
                    value = editedText ?: draft,
                    onValueChange = onEditedTextChange,
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = MaterialTheme.typography.bodyMedium,
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent, unfocusedBorderColor = Border),
                )
            } else {
                // BUG FOUND on-device while verifying this round's stabilization
                // work: onMarkContacted below sends `editedText ?: draft` as the
                // real finalText (the correct, actually-sent text -- also what
                // gets durably recorded server-side in the interaction log), but
                // this read-only "PITCH SENT" view was showing the server's
                // ORIGINAL, unedited previewText -- silently reverting to a
                // message that was never actually the one sent, right after an
                // owner edit. Falls back to editedText (this session's own edit)
                // first, same source of truth onMarkContacted already uses.
                Text(editedText ?: draft, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            }
        }

        Spacer(Modifier.height(12.dp))
        when (prospect.stage) {
            PartnershipStage.PROSPECT -> PrimaryButton(text = "Qualify", onClick = onQualify, enabled = !busy, busy = busy, modifier = Modifier.fillMaxWidth())
            PartnershipStage.QUALIFIED -> PrimaryButton(text = if (busy) "Generating & reviewing (up to 2 attempts)..." else "Generate draft", onClick = onGenerateDraft, enabled = !busy, busy = busy, modifier = Modifier.fillMaxWidth())
            PartnershipStage.DRAFT_READY -> {
                if (draft != null) {
                    PrimaryButton(text = "Copy + Open ${prospect.contactRoute?.let { if (it.startsWith("email", true)) "Email" else "X" } ?: "channel"}", onClick = onCopyAndOpen, enabled = !busy, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(6.dp))
                    TextButton(onClick = onMarkContacted, enabled = !busy) { Text(if (busy) "Marking..." else "Mark contacted") }
                } else {
                    Text("Draft not yet available.", style = MaterialTheme.typography.bodySmall, color = TextTertiary)
                }
            }
            PartnershipStage.CONTACTED -> {
                Text("Contacted via ${prospect.contactedChannel ?: "unknown channel"}.", style = MaterialTheme.typography.bodySmall, color = TextTertiary)
                Spacer(Modifier.height(6.dp))
                TextButton(onClick = onRecordReply, enabled = !busy) { Text("Record reply") }
            }
            PartnershipStage.REPLIED -> {
                Text("Reply received.", style = MaterialTheme.typography.bodySmall, color = Success)
                Spacer(Modifier.height(6.dp))
                PrimaryButton(text = "Start pilot", onClick = onStartPilot, enabled = !busy, modifier = Modifier.fillMaxWidth())
            }
            PartnershipStage.PILOT -> Text("Pilot in progress.", style = MaterialTheme.typography.bodySmall, color = Success)
            PartnershipStage.ACTIVE_PARTNER -> Text("Active partner.", style = MaterialTheme.typography.bodySmall, color = Success)
            PartnershipStage.CLOSED, PartnershipStage.ARCHIVED, PartnershipStage.DO_NOT_CONTACT -> {}
        }

        if (prospect.stage != PartnershipStage.CLOSED && prospect.stage != PartnershipStage.ARCHIVED && prospect.stage != PartnershipStage.DO_NOT_CONTACT) {
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = onArchive, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Archive", maxLines = 1, overflow = TextOverflow.Ellipsis) }
                TextButton(onClick = onDoNotContact, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Do not contact", maxLines = 1, overflow = TextOverflow.Ellipsis, color = Warning) }
            }
        }
    }
}
