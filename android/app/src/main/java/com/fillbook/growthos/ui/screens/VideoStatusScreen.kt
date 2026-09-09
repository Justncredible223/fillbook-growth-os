package com.fillbook.growthos.ui.screens

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.Opportunity
import com.fillbook.growthos.data.VideoRenderMetadata
import com.fillbook.growthos.data.VideoRenderStatus
import com.fillbook.growthos.data.authErrorMessage
import com.fillbook.growthos.data.extractVideoScriptRequestErrorMessage
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.IconPill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.PrimaryButton
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SecondaryButton
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.StatusTone
import com.fillbook.growthos.ui.components.assetStageDisplayName
import com.fillbook.growthos.ui.components.copyToClipboard
import com.fillbook.growthos.ui.components.relativeTime
import com.fillbook.growthos.ui.components.statusToneColor
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import kotlinx.coroutines.launch

/**
 * The durable status view for every video render the owner has ever
 * approved -- queued/rendering/ready/failed/canceled -- independent of
 * whether a push notification about it was ever delivered (a lost push is
 * a convenience miss, never a lost video or a lost "it's ready" fact; see
 * the render-worker's own "Honest limit on exactly-once" note). Download
 * and Share here only ever hand the finished MP4 to Android's own share
 * sheet / Downloads -- this screen never uploads or posts to TikTok or
 * YouTube itself, matching docs/EXTERNAL_WRITE_FIREWALL.md exactly the
 * same way ApprovalsScreen's Copy & Share does for text.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideoStatusScreen(repo: GrowthOsRepository) {
    var renders by remember { mutableStateOf<List<VideoRenderStatus>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    // videoRenderId -> the local download's content Uri, once this
    // session's download for it has actually completed -- a per-session
    // cache only (never persisted), so re-opening the screen after the
    // app was killed correctly shows "Download" again rather than
    // pretending a stale reference is still good.
    var downloadedUris by remember { mutableStateOf<Map<String, Uri>>(emptyMap()) }
    // videoRenderId -> the system DownloadManager id for an in-flight download, so the completion receiver knows which render it belongs to.
    var pendingDownloads by remember { mutableStateOf<Map<Long, String>>(emptyMap()) }
    // Duplicate-tap guard (2026-09-07 release audit): renderIds with a
    // download currently in flight -- checked before starting a new one and
    // used to disable/show-busy on that render's own Download button, so a
    // rapid double-tap can't enqueue two DownloadManager requests for the
    // same video. Released in every path: enqueue failure (synchronously,
    // right in download()), and both the success and failure branches of
    // the completion broadcast receiver below -- there is no user-facing
    // cancel action in this screen, so "cancellation" here is exactly the
    // same DownloadManager non-success outcome the failure branch already
    // handles.
    var downloadingIds by remember { mutableStateOf<Set<String>>(emptySet()) }

    // "Create Fillbook Video" (2026-09-08): a fresh, real video_script
    // request for either a custom topic or an existing Radar opportunity.
    // Two-step flow -- the entry dialog collects the topic/opportunity
    // choice, the confirmation dialog is the one place the required
    // real-draft/LLM-budget/no-auto-post/approval-starts-render disclosure
    // lives, separately from the entry step so it can never be skipped by
    // habit (e.g. auto-filling remembered field values).
    var showCreateVideoDialog by remember { mutableStateOf(false) }
    var showVideoConfirmDialog by remember { mutableStateOf(false) }
    var videoTopicInput by rememberSaveable { mutableStateOf("") }
    // false = custom topic, true = pick an existing opportunity. A plain
    // Boolean survives rotation fine via rememberSaveable.
    var useExistingOpportunity by rememberSaveable { mutableStateOf(false) }
    // Only the id is saved/tracked here, not the Opportunity object itself
    // -- same reasoning as PartnershipsScreen's pilotDialogProspectId: a
    // network/domain object is never a candidate for persisted UI state.
    var selectedOpportunityId by rememberSaveable { mutableStateOf<String?>(null) }
    var eligibleOpportunities by remember { mutableStateOf<List<Opportunity>>(emptyList()) }
    var loadingOpportunities by remember { mutableStateOf(false) }
    // Doubles as both the busy/spinner state AND the duplicate-tap guard --
    // a rapid double-tap on Confirm can't fire two requests since the
    // button is disabled the instant the first tap sets this true.
    var creatingVideoScript by remember { mutableStateOf(false) }
    var createVideoResultMessage by remember { mutableStateOf<String?>(null) }
    val suggestedVideoTopics = remember { getWeeklySuggestedTopics() }

    suspend fun refresh() {
        try {
            renders = repo.getVideoRenderStatuses()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = authErrorMessage(e) ?: "Couldn't load video status. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    // Registered once for the screen's lifetime -- DownloadManager posts
    // this broadcast for EVERY completed download system-wide (not just
    // this app's), so pendingDownloads is what filters it down to ones
    // this screen actually started.
    DisposableEffect(Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                val videoRenderId = pendingDownloads[id] ?: return
                val downloadManager = context.getSystemService<DownloadManager>() ?: return
                val query = DownloadManager.Query().setFilterById(id)
                downloadManager.query(query).use { cursor ->
                    if (!cursor.moveToFirst()) return@use
                    val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                    val status = if (statusIndex >= 0) cursor.getInt(statusIndex) else DownloadManager.STATUS_FAILED
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        val uri = downloadManager.getUriForDownloadedFile(id)
                        downloadedUris = downloadedUris + (videoRenderId to uri)
                        scope.launch { snackbarHostState.showSnackbar("Downloaded — tap Share to send it") }
                    } else {
                        // Most likely cause for THIS feature specifically: the
                        // signed URL's ~1h expiry passed between fetching status
                        // and the download actually running -- pulling to
                        // refresh mints a fresh one (see videoStatusHandlers.ts).
                        // Also where a user-cancelled download lands (DownloadManager
                        // reports cancellation as a non-successful status, same as
                        // any other failure) -- the guard below is released either way.
                        scope.launch { snackbarHostState.showSnackbar("Download failed — the link may have expired. Pull to refresh and try again.") }
                    }
                    pendingDownloads = pendingDownloads - id
                    downloadingIds = downloadingIds - videoRenderId
                }
            }
        }
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose { context.unregisterReceiver(receiver) }
    }

    fun download(render: VideoRenderStatus) {
        // Defensive: the button itself is already disabled while this
        // render's id is in downloadingIds, but a second tap can still land
        // in the same frame before recomposition disables it.
        if (render.id in downloadingIds) return
        val url = render.downloadUrl
        if (url == null) {
            scope.launch { snackbarHostState.showSnackbar("No download link yet — pull to refresh.") }
            return
        }
        val downloadManager = context.getSystemService<DownloadManager>()
        if (downloadManager == null) {
            scope.launch { snackbarHostState.showSnackbar("Downloads aren't available on this device.") }
            return
        }
        downloadingIds = downloadingIds + render.id
        val fileName = "fillbook-video-${render.id}.mp4"
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(fileName)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            .setMimeType("video/mp4")
        val id = runCatching { downloadManager.enqueue(request) }.getOrNull()
        if (id == null) {
            // Enqueue itself failed (or threw) -- release the guard right
            // here since no broadcast will ever arrive for a download that
            // never started.
            downloadingIds = downloadingIds - render.id
            scope.launch { snackbarHostState.showSnackbar("Couldn't start the download. Check your connection and try again.") }
            return
        }
        pendingDownloads = pendingDownloads + (id to render.id)
        scope.launch { snackbarHostState.showSnackbar("Downloading…") }
    }

    fun share(render: VideoRenderStatus) {
        val uri = downloadedUris[render.id]
        if (uri == null) {
            scope.launch { snackbarHostState.showSnackbar("Download it first, then Share.") }
            return
        }
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "video/mp4"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        // A generic chooser (not a package-targeted intent) needs no
        // <queries> manifest declaration to see installed apps like TikTok
        // or YouTube -- that visibility restriction only applies to intents
        // naming a specific target package.
        context.startActivity(Intent.createChooser(shareIntent, "Share video"))
    }

    fun loadEligibleOpportunities() {
        scope.launch {
            loadingOpportunities = true
            eligibleOpportunities = try {
                // Engagement (reply-worthy) opportunities are never a fit for
                // a shootable video production package -- same real
                // discriminator RadarScreen already uses, not a new concept.
                repo.getOpportunities().filter { !it.isEngagementOpportunity }
            } catch (e: Exception) {
                emptyList()
            }
            loadingOpportunities = false
        }
    }

    fun requestVideoScript() {
        // Duplicate-tap guard: the Confirm button is also disabled while
        // this is true, but a second tap can still land in the same frame
        // before recomposition disables it.
        if (creatingVideoScript) return
        val topic = videoTopicInput.trim()
        val opportunityId = selectedOpportunityId
        scope.launch {
            creatingVideoScript = true
            try {
                val result = repo.requestVideoScript(
                    topic = if (!useExistingOpportunity) topic else null,
                    opportunityId = if (useExistingOpportunity) opportunityId else null,
                )
                createVideoResultMessage = if (result.finalStage == "ready_for_owner") {
                    "Video script sent to Approvals for your review."
                } else {
                    "Didn't clear review (${assetStageDisplayName(result.finalStage)})" +
                        if (result.blockReasons.isNotEmpty()) ": ${result.blockReasons.joinToString("; ")}" else "."
                }
                showVideoConfirmDialog = false
                showCreateVideoDialog = false
                videoTopicInput = ""
                selectedOpportunityId = null
                useExistingOpportunity = false
                refresh()
            } catch (e: com.fillbook.growthos.data.NetworkException) {
                createVideoResultMessage = extractVideoScriptRequestErrorMessage(e.httpCode, e.message)
                    ?: authErrorMessage(e)
                    ?: "Couldn't create the video script. Check your connection and try again."
            } catch (e: Exception) {
                createVideoResultMessage = "Couldn't create the video script. Check your connection and try again."
            }
            creatingVideoScript = false
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            ScreenHeader(
                "Video Status",
                "Approve a video script and it renders here — download it, then share it to TikTok or YouTube yourself.",
                kicker = if (loaded && renders.isNotEmpty()) "${renders.size} render${if (renders.size == 1) "" else "s"}" else null,
            )

            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp)) {
                SecondaryButton(
                    text = "+ Create Fillbook Video",
                    onClick = {
                        videoTopicInput = ""
                        selectedOpportunityId = null
                        useExistingOpportunity = false
                        showCreateVideoDialog = true
                    },
                )
            }

            errorMessage?.let { message ->
                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                }
            }

            createVideoResultMessage?.let { message ->
                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(message, style = MaterialTheme.typography.bodyMedium, color = TextSecondary, modifier = Modifier.weight(1f))
                    TextButton(onClick = { createVideoResultMessage = null }) { Text("Dismiss") }
                }
            }

            if (!loaded) {
                SkeletonListLoading()
            } else {
                // Same nested-scroll fix as ProspectingScreen (2026-09-07):
                // PullToRefreshBox only detects the pull gesture through a
                // scrollable descendant's nested-scroll connection. The
                // empty state used to sit entirely outside PullToRefreshBox
                // (and even wrapped, a bare PolishedEmptyState -- a plain,
                // non-scrollable Column -- would never dispatch drag deltas
                // to it anyway). Fix: PullToRefreshBox now wraps both
                // branches, and the empty branch uses a LazyColumn (the same
                // genuine nested-scroll participant the populated branch
                // already uses) instead of a bare Column.
                PullToRefreshBox(
                    isRefreshing = refreshing,
                    onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    if (errorMessage == null && renders.isEmpty()) {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            item {
                                PolishedEmptyState(
                                    icon = Icons.Filled.Movie,
                                    headline = "No videos yet",
                                    subtitle = "Approve a video script draft in Approvals and it'll start rendering here.",
                                )
                            }
                        }
                    } else {
                        LazyColumn(
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(renders, key = { it.id }) { render ->
                                VideoRenderCard(
                                    render = render,
                                    alreadyDownloaded = downloadedUris.containsKey(render.id),
                                    downloading = render.id in downloadingIds,
                                    onDownload = { download(render) },
                                    onShare = { share(render) },
                                )
                            }
                        }
                    }
                }
            }
        }
        SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
    }

    if (showCreateVideoDialog) {
        val canContinue = if (useExistingOpportunity) selectedOpportunityId != null else videoTopicInput.trim().length >= 3
        AlertDialog(
            onDismissRequest = { showCreateVideoDialog = false },
            title = { Text("Create Fillbook Video") },
            text = {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = !useExistingOpportunity, onClick = { useExistingOpportunity = false })
                        Text("Custom topic", style = MaterialTheme.typography.bodyMedium)
                    }
                    if (!useExistingOpportunity) {
                        Text(
                            "This week's topics — tap to use:",
                            style = MaterialTheme.typography.labelMedium,
                            color = TextTertiary,
                            modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
                        )
                        LazyColumn(modifier = Modifier.fillMaxWidth().height(160.dp)) {
                            items(suggestedVideoTopics) { topic ->
                                Text(
                                    topic,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Accent,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { videoTopicInput = topic }
                                        .padding(vertical = 5.dp),
                                )
                            }
                        }
                        OutlinedTextField(
                            value = videoTopicInput,
                            onValueChange = { videoTopicInput = it },
                            label = { Text("Futures/prop-firm/trading-discipline topic") },
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
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 6.dp),
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
                    onClick = { showCreateVideoDialog = false; showVideoConfirmDialog = true },
                    enabled = canContinue,
                ) { Text("Continue") }
            },
            dismissButton = {
                TextButton(onClick = { showCreateVideoDialog = false }) { Text("Cancel") }
            },
        )
    }

    if (showVideoConfirmDialog) {
        val topicSummary = if (useExistingOpportunity) {
            eligibleOpportunities.firstOrNull { it.id == selectedOpportunityId }?.title ?: "the selected opportunity"
        } else {
            "\"${videoTopicInput.trim()}\""
        }
        AlertDialog(
            onDismissRequest = { if (!creatingVideoScript) showVideoConfirmDialog = false },
            title = { Text("Create a real video draft?") },
            text = {
                Column {
                    Text(
                        "This uses paid LLM/render budget and creates a REAL video draft for $topicSummary.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("• It will render on the video worker once approved.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                    Text("• It will NOT post anywhere automatically.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                    Text("• It lands in Approvals first -- approving it there is what starts the render.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                }
            },
            confirmButton = {
                TextButton(onClick = { requestVideoScript() }, enabled = !creatingVideoScript) {
                    Text(if (creatingVideoScript) "Creating…" else "Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showVideoConfirmDialog = false }, enabled = !creatingVideoScript) { Text("Cancel") }
            },
        )
    }
}

internal fun statusTone(status: String): StatusTone = when (status) {
    "ready" -> StatusTone.READY
    "rendering", "queued" -> StatusTone.WAITING
    "failed" -> StatusTone.FAILED
    "canceled" -> StatusTone.SKIPPED
    else -> StatusTone.NEUTRAL
}

internal fun statusLabel(status: String): String = when (status) {
    "queued" -> "Queued"
    "rendering" -> "Rendering"
    "ready" -> "Ready"
    "failed" -> "Failed"
    "canceled" -> "Canceled"
    else -> status.replaceFirstChar { it.uppercase() }
}

@Composable
private fun VideoRenderCard(
    render: VideoRenderStatus,
    alreadyDownloaded: Boolean,
    downloading: Boolean,
    onDownload: () -> Unit,
    onShare: () -> Unit,
) {
    val tone = statusTone(render.status)
    GrowthCard(accentBar = statusToneColor(tone)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val icon = when (render.status) {
                "ready" -> Icons.Filled.CloudDone
                "rendering" -> Icons.Filled.CloudSync
                "queued" -> Icons.Filled.HourglassEmpty
                "failed" -> Icons.Filled.ErrorOutline
                else -> Icons.Filled.Movie
            }
            IconPill(statusLabel(render.status), icon, statusToneColor(tone))
            Spacer(Modifier.width(8.dp))
            if (render.status == "rendering") {
                CircularProgressIndicator(modifier = Modifier.height(14.dp).width(14.dp), strokeWidth = 2.dp, color = statusToneColor(tone))
            }
            Spacer(Modifier.weight(1f))
            relativeTime(render.updatedAt)?.let { time ->
                Text(time, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
            }
        }
        Spacer(Modifier.height(10.dp))
        render.durationSeconds?.let { seconds ->
            Text("${seconds.toInt()}s video", style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
            Spacer(Modifier.height(6.dp))
        }
        render.error?.let { error ->
            Text(error, style = MaterialTheme.typography.bodySmall, color = Danger, maxLines = 4)
            Spacer(Modifier.height(6.dp))
        }
        if (render.status == "queued" || render.status == "rendering") {
            Text(
                "This can take a minute or two — pull to refresh, or wait for the notification.",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
            )
        }
        render.videoMetadata?.let { meta ->
            Spacer(Modifier.height(10.dp))
            VideoMetadataSection(
                label = "YOUTUBE SHORTS",
                copyLabel = "YouTube Shorts metadata",
                body = listOfNotNull(
                    "Title: ${meta.youtubeTitle}",
                    "",
                    meta.youtubeDescription,
                    meta.hashtags.takeIf { it.isNotEmpty() }?.joinToString(" ") { "#$it" },
                    meta.disclosureCta,
                ).joinToString("\n"),
            )
            meta.youtubeThumbnailConcept?.let { concept ->
                Spacer(Modifier.height(8.dp))
                VideoMetadataSection(
                    label = "YOUTUBE THUMBNAIL CONCEPT",
                    copyLabel = "YouTube thumbnail concept",
                    body = concept,
                )
            }
            Spacer(Modifier.height(8.dp))
            VideoMetadataSection(
                label = "TIKTOK",
                copyLabel = "TikTok metadata",
                body = listOfNotNull(
                    meta.tiktokCaption,
                    meta.hashtags.takeIf { it.isNotEmpty() }?.joinToString(" ") { "#$it" },
                    meta.disclosureCta,
                ).joinToString("\n"),
            )
        }
        if (render.status == "ready") {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryButton(text = "Download", onClick = onDownload, enabled = !downloading, busy = downloading, modifier = Modifier.weight(1f))
                SecondaryButton(text = "Share", onClick = onShare, enabled = alreadyDownloaded)
            }
            if (!alreadyDownloaded) {
                Spacer(Modifier.height(4.dp))
                Text("Download it first, then Share to TikTok or YouTube.", style = MaterialTheme.typography.labelMedium, color = TextTertiary)
            }
        }
    }
}

/**
 * A copyable metadata block ("Create Fillbook Video", 2026-09-08) -- the
 * owner pastes this straight into TikTok's/YouTube's own upload flow when
 * they manually publish, since this app never uploads to either platform
 * itself (see docs/EXTERNAL_WRITE_FIREWALL.md).
 */
@Composable
private fun VideoMetadataSection(label: String, copyLabel: String, body: String) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(com.fillbook.growthos.ui.theme.Background, androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = TextTertiary, modifier = Modifier.weight(1f))
            TextButton(
                onClick = { copyToClipboard(context, copyLabel, body) },
                contentPadding = PaddingValues(0.dp),
            ) { Text("Copy", style = MaterialTheme.typography.labelMedium, color = Accent) }
        }
        Spacer(Modifier.height(4.dp))
        Text(body, style = MaterialTheme.typography.bodySmall, color = TextPrimary)
    }
}

private val WEEKLY_TOPIC_SETS: List<List<String>> = listOf(
    // Week set 0
    listOf(
        "why funded traders who journal outperform those who don't",
        "how to build a morning trading routine that sets up winning trades",
        "what revenge trading really costs funded account holders",
        "how to calculate position sizing without blowing your daily loss limit",
        "how to track your drawdown before it tracks you out of funding",
    ),
    // Week set 1
    listOf(
        "the one thing consistent prop firm traders do that others skip",
        "how to use your trading journal to find your best setups",
        "why your losing streak isn't random and what your trade journal reveals",
        "how to handle a losing streak without blowing the account",
        "what a trading plan actually needs to work for funded traders",
    ),
    // Week set 2
    listOf(
        "why most traders break their rules and how a trading journal fixes it",
        "how to build trading habits that survive a funded account",
        "the trading psychology mistake that kills most evaluation accounts",
        "why your trading routine matters more than your entry strategy",
        "how to stop strategy hopping and commit to one edge",
    ),
    // Week set 3
    listOf(
        "what separates funded traders from those who blow their accounts",
        "how to use a trade review to build real consistency as a funded trader",
        "what every funded trader needs to know about drawdown rules",
        "how to create a trading plan that you'll actually follow",
        "why your best trading days tell you more than your worst",
    ),
    // Week set 4
    listOf(
        "why prop firm traders who track their trades get funded faster",
        "how to avoid revenge trading after a tough loss",
        "why prop firm traders should track emotions, not just trades",
        "how to pass a trading combine on your next attempt",
        "how to set daily loss limits you won't break under pressure",
    ),
    // Week set 5
    listOf(
        "how a trading journal helps you stop making the same mistakes",
        "what your trading routine should look like before the market opens",
        "why most prop firm traders fail their second evaluation",
        "how to identify your trading edge using historical trade data",
        "what the best-performing funded traders have in common",
    ),
    // Week set 6
    listOf(
        "why traders who skip journaling keep repeating the same costly mistakes",
        "how to stay consistent when your prop firm account hits max drawdown",
        "what stop-loss discipline actually looks like for funded traders",
        "how to use backtesting to validate your trading strategy",
        "how to do a trade review that actually improves your win rate",
    ),
    // Week set 7
    listOf(
        "how reviewing your trading journal daily can cut your losing streak in half",
        "what position sizing mistakes cost prop firm traders the most",
        "how to manage risk when trading futures near your daily loss limit",
        "why funded traders who track their psychology outperform those who don't",
        "how to build a consistent trading routine from scratch",
    ),
)

internal fun getWeeklySuggestedTopics(): List<String> {
    val weekOfYear = java.time.LocalDate.now().get(java.time.temporal.WeekFields.ISO.weekOfYear())
    return WEEKLY_TOPIC_SETS[(weekOfYear - 1) % WEEKLY_TOPIC_SETS.size]
}
