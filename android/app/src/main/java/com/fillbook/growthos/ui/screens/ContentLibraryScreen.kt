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

/**
 * Every draft this system has produced, grouped by platform -- the same
 * real data as the Campaigns screen (GET /api/campaigns), just organized
 * for browsing content instead of tracking pipeline progress. No new
 * endpoint: adding one would push this project over Vercel Hobby's
 * 12-serverless-function cap (see docs/PROGRESS_LEDGER.md Phase 15).
 */
@Composable
fun ContentLibraryScreen(repo: GrowthOsRepository) {
    var assetsByPlatform by remember { mutableStateOf<Map<String, List<CampaignAsset>>>(emptyMap()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            val campaigns = repo.getCampaigns()
            assetsByPlatform = campaigns
                .flatMap { it.assets }
                .filter { it.latestBody != null }
                .groupBy { it.platform }
        } catch (e: Exception) {
            errorMessage = "Couldn't load the content library. Check your connection and try again."
        }
        loaded = true
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader("Content Library", "Every draft ever produced, with its real review-agent scores.")

        errorMessage?.let { message ->
            Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.padding(horizontal = 20.dp))
        }

        if (loaded && errorMessage == null && assetsByPlatform.isEmpty()) {
            EmptyLibraryState()
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                assetsByPlatform.entries.sortedByDescending { it.value.size }.forEach { (platform, assets) ->
                    item { SectionLabel("${platform.uppercase()} (${assets.size})") }
                    items(assets) { asset -> LibraryCard(asset) }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = TextTertiary, modifier = Modifier.padding(top = 4.dp, bottom = 2.dp))
}

@Composable
private fun EmptyLibraryState() {
    Column(modifier = Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("No drafts produced yet.", style = MaterialTheme.typography.titleMedium, color = TextSecondary)
        Spacer(Modifier.height(4.dp))
        Text(
            "Once an opportunity runs through the pipeline (POST /api/run-campaign), drafts show up here.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextTertiary,
        )
    }
}

@Composable
private fun LibraryCard(asset: CampaignAsset) {
    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Surface).padding(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill(asset.assetType, TextSecondary)
            Pill(asset.stage.replace("_", " "), stageColor(asset.stage))
            if (asset.reviewPassCount + asset.reviewFailCount > 0) {
                Pill(
                    "${asset.reviewPassCount}/${asset.reviewPassCount + asset.reviewFailCount} agents passed",
                    if (asset.reviewFailCount == 0) Accent else Warning,
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(asset.latestBody ?: "", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
    }
}

private fun stageColor(stage: String) = when (stage) {
    "ready_for_owner", "handed_off" -> Accent
    "final_draft" -> Warning
    else -> TextTertiary
}
