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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.ApprovalAsset
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch
import java.net.URLEncoder

/**
 * This screen must never contain a button labeled "Publish", "Post",
 * "Send", or similar — every action here either stays internal (Approve,
 * Reject) or opens the destination platform's own composer for the owner
 * to finish and press post themselves (see
 * docs/EXTERNAL_WRITE_FIREWALL.md). Approve/Reject only change what this
 * app displays (campaigns.status server-side, via POST /api/approvals) —
 * neither one ever contacts X, YouTube, or any other external platform.
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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text("Approvals", style = MaterialTheme.typography.headlineLarge)
            Text(
                "You always press publish — this app only ever hands off a draft.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
            )
        }

        (errorMessage ?: actionError)?.let { message ->
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = Danger,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }

        if (loaded && errorMessage == null && assets.isEmpty()) {
            EmptyApprovals()
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
private fun EmptyApprovals() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Nothing waiting on you right now.",
            style = MaterialTheme.typography.titleMedium,
            color = TextSecondary,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "Drafts land here once the Campaign Factory finishes review.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextTertiary,
        )
    }
}

@Composable
private fun ApprovalCard(
    asset: ApprovalAsset,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    onOpenInPlatform: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(16.dp),
    ) {
        Text(asset.campaignTitle, style = MaterialTheme.typography.titleLarge)
        Text(
            "${platformDisplayName(asset.platform)} · ${asset.assetType}",
            style = MaterialTheme.typography.labelLarge,
            color = TextSecondary,
        )
        if (asset.isAutoDraft) {
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Pill("AUTO-DRAFT", Warning)
                asset.costUsd?.let { cost -> Pill("$%.4f".format(cost), TextTertiary) }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(asset.previewText, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = onApprove, colors = ButtonDefaults.buttonColors(containerColor = Accent)) {
                Text("Approve internally")
            }
            OutlinedButton(onClick = onReject) {
                Text("Reject")
            }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = onOpenInPlatform) {
            Text("Open in ${platformDisplayName(asset.platform)}")
        }
    }
}
