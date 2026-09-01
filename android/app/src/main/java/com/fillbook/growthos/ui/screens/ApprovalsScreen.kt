package com.fillbook.growthos.ui.screens

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import com.fillbook.growthos.data.ApprovalAsset
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.ExpandableText
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScoreBadge
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.StatusTone
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.components.statusToneColor
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import kotlinx.coroutines.launch
import java.net.URLEncoder

/**
 * A decision screen, not a report: the review score is the first thing
 * you see on every card, the two decisions (approve/reject) sit at the
 * bottom where a thumb already is, and everything else (auto-draft
 * badge, cost, timestamp) is secondary metadata below the content. This
 * screen must never contain a button labeled "Publish", "Post", "Send",
 * or similar -- every action either stays internal (Approve, Reject) or
 * opens the destination platform's own composer for the owner to finish
 * and press post themselves (see docs/EXTERNAL_WRITE_FIREWALL.md).
 * Approve/Reject only change what this app displays (campaigns.status
 * server-side) -- neither one ever contacts X, YouTube, or any other
 * external platform.
 */
@Composable
fun ApprovalsScreen(repo: GrowthOsRepository) {
    var assets by remember { mutableStateOf<List<ApprovalAsset>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

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

    fun decide(asset: ApprovalAsset, approve: Boolean) {
        scope.launch {
            try {
                repo.decideApproval(asset.id, approve)
                actionError = null
                refresh()
            } catch (e: Exception) {
                actionError = "Couldn't record that decision. Check your connection and try again."
            }
        }
    }

    fun openInPlatform(asset: ApprovalAsset) {
        val text = URLEncoder.encode(asset.previewText, "UTF-8")
        val url = when (asset.platform.lowercase()) {
            "x", "twitter" -> "https://twitter.com/intent/tweet?text=$text"
            else -> null
        }
        if (url != null) {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } else {
            actionError = "No composer wired up yet for ${platformDisplayName(asset.platform)} -- copy the draft manually for now."
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader("Approvals", "You always press publish — this app only ever hands off a draft.")

        (errorMessage ?: actionError)?.let { message ->
            Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.padding(horizontal = 20.dp))
        }

        if (loaded && errorMessage == null && assets.isEmpty()) {
            PolishedEmptyState(
                icon = Icons.Filled.CheckCircle,
                headline = "Nothing waiting on you",
                subtitle = "Drafts land here once the Campaign Factory finishes AI review.",
            )
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(assets, key = { it.id }) { asset ->
                    ApprovalCard(
                        asset = asset,
                        onApprove = { decide(asset, approve = true) },
                        onReject = { decide(asset, approve = false) },
                        onOpenInPlatform = { openInPlatform(asset) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ApprovalCard(
    asset: ApprovalAsset,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    onOpenInPlatform: () -> Unit,
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
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = onOpenInPlatform, colors = ButtonDefaults.buttonColors(containerColor = Accent), modifier = Modifier.weight(1f)) {
                Text("Open in ${platformDisplayName(asset.platform)}")
            }
            OutlinedButton(onClick = onApprove) { Text("Approve") }
            OutlinedButton(onClick = onReject) { Text("Reject") }
        }
    }
}
