package com.fillbook.growthos.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import com.fillbook.growthos.data.ApprovalAsset
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.ExpandableText
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScoreBadge
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SearchField
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.StatusTone
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.components.relativeTime
import com.fillbook.growthos.ui.components.statusToneColor
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import kotlinx.coroutines.launch

/**
 * A decision screen, not a report: the review score is the first thing
 * you see on every card, the two decisions (approve/reject) sit at the
 * bottom where a thumb already is, and everything else (auto-draft
 * badge, cost, timestamp) is secondary metadata below the content. This
 * screen must never contain a button labeled "Publish", "Post", "Send",
 * or similar -- every action either stays internal (Approve, Reject) or
 * copies the draft and hands it to whatever app the owner picks to
 * finish and press post themselves (see docs/EXTERNAL_WRITE_FIREWALL.md).
 * Approve/Reject only change what this app displays (campaigns.status
 * server-side) -- neither one ever contacts X, YouTube, or any other
 * external platform.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalsScreen(repo: GrowthOsRepository) {
    var assets by remember { mutableStateOf<List<ApprovalAsset>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var pendingReject by remember { mutableStateOf<ApprovalAsset?>(null) }
    var query by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    suspend fun refresh() {
        try {
            assets = repo.getApprovals()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load approvals. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    val filtered = remember(assets, query) {
        if (query.isBlank()) assets
        else assets.filter { it.campaignTitle.contains(query, ignoreCase = true) || it.previewText.contains(query, ignoreCase = true) }
    }

    fun decide(asset: ApprovalAsset, approve: Boolean) {
        scope.launch {
            try {
                repo.decideApproval(asset.id, approve)
                actionError = null
                refresh()
                snackbarHostState.showSnackbar(if (approve) "Approved" else "Rejected")
            } catch (e: Exception) {
                actionError = "Couldn't record that decision. Check your connection and try again."
            }
        }
    }

    /**
     * Universal, platform-agnostic handoff: copies the draft to the
     * clipboard and opens Android's own share sheet so the owner can pick
     * literally any installed app -- X, YouTube Studio, TikTok, a blog
     * CMS, or anything else -- instead of this app trying to maintain a
     * pre-fill URL scheme per platform (which only ever worked for X).
     * Paste is still the owner's action; nothing here ever posts on its
     * own.
     */
    fun copyAndShare(asset: ApprovalAsset) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Draft", asset.previewText))
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, asset.previewText)
        }
        context.startActivity(Intent.createChooser(shareIntent, "Post to ${platformDisplayName(asset.platform)}"))
        scope.launch { snackbarHostState.showSnackbar("Copied to clipboard") }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            ScreenHeader("Approvals", "You always press publish — this app only ever hands off a draft.")

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
            } else if (errorMessage == null && assets.isEmpty()) {
                PolishedEmptyState(
                    icon = Icons.Filled.CheckCircle,
                    headline = "Nothing waiting on you",
                    subtitle = "Drafts land here once the Campaign Factory finishes AI review.",
                )
            } else {
                SearchField(query, { query = it }, "Search drafts", modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                PullToRefreshBox(
                    isRefreshing = refreshing,
                    onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(filtered, key = { it.id }) { asset ->
                            ApprovalCard(
                                asset = asset,
                                onApprove = { decide(asset, approve = true) },
                                onReject = { pendingReject = asset },
                                onCopyAndShare = { copyAndShare(asset) },
                            )
                        }
                    }
                }
            }
        }
        SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
    }

    pendingReject?.let { asset ->
        AlertDialog(
            onDismissRequest = { pendingReject = null },
            title = { Text("Reject this draft?") },
            text = { Text("\"${asset.campaignTitle}\" will be retired. This can't be undone from here.") },
            confirmButton = {
                TextButton(onClick = { decide(asset, approve = false); pendingReject = null }) { Text("Reject") }
            },
            dismissButton = {
                TextButton(onClick = { pendingReject = null }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun ApprovalCard(
    asset: ApprovalAsset,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    onCopyAndShare: () -> Unit,
) {
    GrowthCard {
        Row(verticalAlignment = Alignment.Top) {
            val total = asset.reviewPassCount + asset.reviewFailCount
            if (total > 0) {
                ScoreBadge(score = (asset.reviewPassCount * 100) / total)
                Spacer(Modifier.width(12.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(asset.campaignTitle, style = MaterialTheme.typography.titleLarge, maxLines = 2)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Pill(platformDisplayName(asset.platform), TextSecondary)
                    if (total > 0) Pill("${asset.reviewPassCount}/$total agents", TextSecondary)
                    if (asset.isAutoDraft) Pill("AUTO-DRAFT", statusToneColor(StatusTone.NEW))
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        ExpandableText(asset.previewText, style = MaterialTheme.typography.bodyMedium, color = TextPrimary, collapsedMaxLines = 4)
        relativeTime(asset.generatedAt)?.let { time ->
            Spacer(Modifier.height(6.dp))
            Text(time, style = MaterialTheme.typography.labelMedium, color = TextTertiary)
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = onCopyAndShare, colors = ButtonDefaults.buttonColors(containerColor = Accent), modifier = Modifier.weight(1f)) {
                Text("Copy & Share")
            }
            OutlinedButton(onClick = onApprove) { Text("Approve") }
            OutlinedButton(onClick = onReject) { Text("Reject") }
        }
    }
}
