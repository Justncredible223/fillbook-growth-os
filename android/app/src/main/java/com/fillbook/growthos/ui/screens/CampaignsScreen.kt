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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.Campaign
import com.fillbook.growthos.data.CampaignAsset
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.StatusChip
import com.fillbook.growthos.ui.components.assetStageTone
import com.fillbook.growthos.ui.components.campaignStatusTone
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextSecondary
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
            Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.padding(horizontal = 20.dp))
        }

        if (!loaded) {
            SkeletonListLoading()
        } else if (errorMessage == null && campaigns.isEmpty()) {
            PolishedEmptyState(
                icon = Icons.Filled.Campaign,
                headline = "No campaigns run yet",
                subtitle = "Once an opportunity runs through the pipeline, it shows up here -- pass or fail.",
            )
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
private fun CampaignCard(campaign: Campaign) {
    GrowthCard {
        Text(campaign.thesis, style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        StatusChip(campaign.status.replace("_", " "), campaignStatusTone(campaign.status))
        Spacer(Modifier.height(12.dp))
        campaign.assets.forEach { asset -> AssetRow(asset) }
    }
}

@Composable
private fun AssetRow(asset: CampaignAsset) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill(platformDisplayName(asset.platform), TextSecondary)
            StatusChip(asset.stage.replace("_", " "), assetStageTone(asset.stage))
            if (asset.reviewPassCount + asset.reviewFailCount > 0) {
                Pill(
                    "${asset.reviewPassCount}/${asset.reviewPassCount + asset.reviewFailCount} agents",
                    if (asset.reviewFailCount == 0) Accent else Warning,
                )
            }
        }
        asset.latestBody?.let { body ->
            Spacer(Modifier.height(6.dp))
            Text(body, style = MaterialTheme.typography.bodyMedium, color = TextSecondary, maxLines = 3)
        }
    }
}
