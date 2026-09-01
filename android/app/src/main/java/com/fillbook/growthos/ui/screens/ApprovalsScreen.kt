package com.fillbook.growthos.ui.screens

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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.ApprovalAsset
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary

/**
 * This screen must never contain a button labeled "Publish", "Post",
 * "Send", or similar — every action here either stays internal (Approve,
 * Reject, Regenerate) or opens the destination platform's own composer
 * for the owner to finish (see docs/EXTERNAL_WRITE_FIREWALL.md). This is
 * the UI's half of a boundary enforced server-side in
 * backend/src/firewall — the server rejects EXTERNAL_WRITE regardless of
 * what this screen does, but the screen should never even offer it.
 */
@Composable
fun ApprovalsScreen(repo: GrowthOsRepository) {
    var assets by remember { mutableStateOf<List<ApprovalAsset>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            assets = repo.getApprovals()
        } catch (e: Exception) {
            errorMessage = "Couldn't load approvals. Check your connection and try again."
        }
        loaded = true
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

        errorMessage?.let { message ->
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = com.fillbook.growthos.ui.theme.Danger,
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
                items(assets) { asset -> ApprovalCard(asset) }
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
private fun ApprovalCard(asset: ApprovalAsset) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(16.dp),
    ) {
        Text(asset.campaignTitle, style = MaterialTheme.typography.titleLarge)
        Text(
            "${asset.platform} · ${asset.assetType}",
            style = MaterialTheme.typography.labelLarge,
            color = TextSecondary,
        )
        Spacer(Modifier.height(10.dp))
        Text(asset.previewText, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = { /* internal-only: approve for handoff */ },
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
                Text("Approve internally")
            }
            OutlinedButton(onClick = { /* internal-only: opens platform composer, never publishes */ }) {
                Text("Open in ${asset.platform}")
            }
        }
    }
}
