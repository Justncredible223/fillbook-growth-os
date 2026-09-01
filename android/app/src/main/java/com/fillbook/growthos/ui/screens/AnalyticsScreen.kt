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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.AnalyticsBreakdown
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary

/**
 * Real internal-system analytics -- signal/opportunity/campaign counts
 * and real LLM spend, all derived from the same tables every other
 * screen reads. NOT attribution/conversion analytics: FillbookHQ's own
 * UTM tracking for TikTok/X is broken/unconfirmed (see
 * docs/ARCHITECTURE.md), so this screen deliberately doesn't build on
 * that signal -- that remains blocked until FillbookHQ's own tracking
 * is fixed, not solved here.
 */
@Composable
fun AnalyticsScreen(repo: GrowthOsRepository) {
    var analytics by remember { mutableStateOf<AnalyticsBreakdown?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            analytics = repo.getHomeSummary().analytics
        } catch (e: Exception) {
            errorMessage = "Couldn't load analytics. Check your connection and try again."
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Analytics",
            "Real counts from the Signal Graph, Opportunity Engine, and Campaign Factory.",
        )

        errorMessage?.let { message ->
            Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.padding(horizontal = 20.dp))
        }

        analytics?.let { data ->
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item { StatCard("Total signals ingested", data.totalSignals.toString()) }
                item { BreakdownCard("Signals by source", data.signalsBySource) }
                item { BreakdownCard("Opportunities by status", data.opportunitiesByStatus) }
                item { BreakdownCard("Campaign assets by stage", data.campaignAssetsByStage) }
                item { StatCard("Total LLM spend", "$%.4f".format(data.totalCostUsd)) }
                item {
                    Text(
                        "Attribution / conversion analytics: blocked on FillbookHQ's own UTM tracking " +
                            "(currently broken/unconfirmed for TikTok/X traffic) -- not shown here until that's fixed.",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextTertiary,
                        modifier = Modifier.padding(top = 8.dp, bottom = 20.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Surface).padding(14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.titleMedium)
        Text(value, style = MaterialTheme.typography.titleLarge, color = Accent)
    }
}

@Composable
private fun BreakdownCard(label: String, counts: Map<String, Int>) {
    Column(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Surface).padding(14.dp),
    ) {
        Text(label, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        counts.entries.sortedByDescending { it.value }.forEach { (key, count) ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(key.replace("_", " "), style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
                Text(count.toString(), style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            }
        }
    }
}
