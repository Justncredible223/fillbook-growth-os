package com.fillbook.growthos.ui.screens

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
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
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.VideoRenderStatus
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.IconPill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.PrimaryButton
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

    suspend fun refresh() {
        try {
            renders = repo.getVideoRenderStatuses()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load video status. Check your connection and try again."
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
                        scope.launch { snackbarHostState.showSnackbar("Download failed — the link may have expired. Pull to refresh and try again.") }
                    }
                    pendingDownloads = pendingDownloads - id
                }
            }
        }
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose { context.unregisterReceiver(receiver) }
    }

    fun download(render: VideoRenderStatus) {
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
        val fileName = "fillbook-video-${render.id}.mp4"
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(fileName)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            .setMimeType("video/mp4")
        val id = runCatching { downloadManager.enqueue(request) }.getOrNull()
        if (id == null) {
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

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            ScreenHeader(
                "Video Status",
                "Approve a video script and it renders here — download it, then share it to TikTok or YouTube yourself.",
                kicker = if (loaded && renders.isNotEmpty()) "${renders.size} render${if (renders.size == 1) "" else "s"}" else null,
            )

            errorMessage?.let { message ->
                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                }
            }

            if (!loaded) {
                SkeletonListLoading()
            } else if (errorMessage == null && renders.isEmpty()) {
                PolishedEmptyState(
                    icon = Icons.Filled.Movie,
                    headline = "No videos yet",
                    subtitle = "Approve a video script draft in Approvals and it'll start rendering here.",
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
                        items(renders, key = { it.id }) { render ->
                            VideoRenderCard(
                                render = render,
                                alreadyDownloaded = downloadedUris.containsKey(render.id),
                                onDownload = { download(render) },
                                onShare = { share(render) },
                            )
                        }
                    }
                }
            }
        }
        SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
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
        if (render.status == "ready") {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryButton(text = "Download", onClick = onDownload, modifier = Modifier.weight(1f))
                SecondaryButton(text = "Share", onClick = onShare, enabled = alreadyDownloaded)
            }
            if (!alreadyDownloaded) {
                Spacer(Modifier.height(4.dp))
                Text("Download it first, then Share to TikTok or YouTube.", style = MaterialTheme.typography.labelMedium, color = TextTertiary)
            }
        }
    }
}
