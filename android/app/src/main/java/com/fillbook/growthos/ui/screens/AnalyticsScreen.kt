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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.AnalyticsBreakdown
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.BreakdownBar
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.InsetRow
import com.fillbook.growthos.ui.components.LoadingIndicator
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.assetStageDisplayName
import com.fillbook.growthos.ui.components.opportunityStatusDisplayName
import com.fillbook.growthos.ui.components.signalSourceDisplayName
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

/**
 * Real internal-system analytics -- signal/opportunity/campaign counts
 * and real LLM spend, all derived from the same tables every other
 * screen reads, shown as proportional bars instead of a wall of numbers.
 * NOT attribution/conversion analytics: FillbookHQ's own UTM tracking
 * for TikTok/X is broken/unconfirmed (see docs/ARCHITECTURE.md), so this
 * screen deliberately doesn't build on that signal, and there's no
 * historical table behind these counts to draw a real trend line from --
 * a snapshot bar is honest, a fabricated sparkline would not be.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsScreen(repo: GrowthOsRepository) {
    var analytics by remember { mutableStateOf<AnalyticsBreakdown?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            analytics = repo.getHomeSummary().analytics
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load analytics. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Analytics",
            "Real counts from the Signal Graph, Opportunity Engine, and Campaign Factory.",
            kicker = "Internal system metrics",
        )

        errorMessage?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
            }
        }

        if (!loaded) {
            LoadingIndicator()
        } else {
            analytics?.let { data ->
                PullToRefreshBox(
                    isRefreshing = refreshing,
                    onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                    modifier = Modifier.fillMaxSize(),
                ) {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        Column {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                MetricTile("Signals ingested", data.totalSignals.toString(), Icons.Filled.Radar, modifier = Modifier.weight(1f))
                                MetricTile("LLM spend", "$%.2f".format(data.totalCostUsd), Icons.Filled.AttachMoney, modifier = Modifier.weight(1f))
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                MetricTile(
                                    "Draft backlog",
                                    "${data.autoDraft.backlogCount}/${data.autoDraft.backlogCap}",
                                    Icons.Filled.Inbox,
                                    modifier = Modifier.weight(1f),
                                    valueColor = if (data.autoDraft.backlogCount >= data.autoDraft.backlogCap) Warning else MaterialTheme.colorScheme.onSurface,
                                    highlighted = data.autoDraft.backlogCount >= data.autoDraft.backlogCap,
                                    highlightColor = Warning,
                                )
                                MetricTile(
                                    "Month spend",
                                    "$%.2f / $%.0f".format(data.autoDraft.monthSpendUsd, data.autoDraft.monthBudgetUsd),
                                    Icons.Filled.Payments,
                                    modifier = Modifier.weight(1f),
                                    valueColor = if (data.autoDraft.monthSpendUsd >= data.autoDraft.monthBudgetUsd) Warning else MaterialTheme.colorScheme.onSurface,
                                    highlighted = data.autoDraft.monthSpendUsd >= data.autoDraft.monthBudgetUsd,
                                    highlightColor = Warning,
                                )
                            }
                        }
                    }
                    item { BreakdownChart("Signals by source", data.signalsBySource, ::signalSourceDisplayName) }
                    item { BreakdownChart("Opportunities by status", data.opportunitiesByStatus, ::opportunityStatusDisplayName) }
                    item { BreakdownChart("Campaign assets by stage", data.campaignAssetsByStage, ::assetStageDisplayName) }
                    item {
                        Column(modifier = Modifier.padding(top = 4.dp, bottom = 20.dp)) {
                            InsetRow {
                                Text("NOT SHOWN YET", style = MaterialTheme.typography.labelMedium, color = TextTertiary)
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    "Attribution / conversion analytics is blocked on FillbookHQ's own UTM tracking " +
                                        "(currently broken/unconfirmed for TikTok/X traffic).",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextTertiary,
                                )
                            }
                        }
                    }
                }
                }
            }
        }
    }
}

@Composable
private fun BreakdownChart(label: String, counts: Map<String, Int>, displayName: (String) -> String) {
    GrowthCard {
        Text(label, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        if (counts.isEmpty()) {
            Text("No data yet", style = MaterialTheme.typography.bodyMedium, color = TextTertiary)
        } else {
            val sorted = counts.entries.sortedByDescending { it.value }
            val max = sorted.first().value
            sorted.forEach { (key, count) -> BreakdownBar(displayName(key), count, max) }
        }
    }
}
