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
import androidx.compose.material3.MaterialTheme
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
import com.fillbook.growthos.data.Campaign
import com.fillbook.growthos.data.CampaignAsset
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning

@Composable
fun CampaignsScreen(repo: GrowthOsRepository) {
    var campaigns by remember { mutableStateOf<List<Campaign>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            campaigns = repo.getCampaigns()
        } catch (e: Exception) {
            errorMessage = "Couldn't load campaigns. Check your connection and try again."
        }
        loaded = true
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Campaigns",
            "Every campaign this system has actually run, stage by stage -- rejected drafts included.",
        )

        errorMessage?.let { message ->
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = Danger,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }

        if (loaded && errorMessage == null && campaigns.isEmpty()) {
            EmptyState()
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(campaigns) { campaign -> CampaignCard(campaign) }
            }
        }
    }
}

@Composable
private fun EmptyState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "No campaigns run yet.",
            style = MaterialTheme.typography.titleMedium,
            color = TextSecondary,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "Once an opportunity runs through the pipeline (POST /api/run-campaign), it shows up here.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextTertiary,
        )
    }
}

@Composable
private fun CampaignCard(campaign: Campaign) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(16.dp),
    ) {
        Text(campaign.thesis, style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Pill(campaign.status, if (campaign.status == "actioned") Accent else TextSecondary)
        Spacer(Modifier.height(12.dp))
        campaign.assets.forEach { asset -> AssetRow(asset) }
    }
}

@Composable
private fun AssetRow(asset: CampaignAsset) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill(asset.platform, TextSecondary)
            Pill(stageLabel(asset.stage), stageColor(asset.stage))
            if (asset.reviewPassCount + asset.reviewFailCount > 0) {
                Pill(
                    "${asset.reviewPassCount}/${asset.reviewPassCount + asset.reviewFailCount} agents passed",
                    if (asset.reviewFailCount == 0) Accent else Warning,
                )
            }
        }
        asset.latestBody?.let { body ->
            Spacer(Modifier.height(6.dp))
            Text(body, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        }
    }
}

private fun stageLabel(stage: String): String = stage.replace("_", " ")

private fun stageColor(stage: String) = when (stage) {
    "ready_for_owner", "handed_off" -> Accent
    "final_draft" -> Warning
    else -> TextTertiary
}
