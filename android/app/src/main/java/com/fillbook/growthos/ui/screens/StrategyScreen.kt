package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.TrendingDown
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.CreatorOpportunity
import com.fillbook.growthos.data.ExperimentSuggestion
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.SeoOpportunity
import com.fillbook.growthos.data.StrategyItem
import com.fillbook.growthos.data.StrategyVersion
import com.fillbook.growthos.ui.components.GhostButton
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.InsetRow
import com.fillbook.growthos.ui.components.LoadingIndicator
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SectionHeader
import com.fillbook.growthos.ui.components.relativeTime
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

/**
 * A weekly-refreshed read of what's actually working, built entirely from
 * this project's own data (see backend/src/strategy/types.ts's kdoc for
 * exactly why -- FillbookHQ's real conversion/attribution data isn't
 * available here). [StrategyVersion.lowConfidence] is shown as an
 * explicit banner rather than silently omitted -- a thin first report
 * should read as directional, not settled, per the master spec's own
 * "avoid fake statistical certainty" requirement.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun StrategyScreen(repo: GrowthOsRepository) {
    var strategy by remember { mutableStateOf<StrategyVersion?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var regenerating by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            strategy = repo.getLatestStrategy()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load the strategy report. Check your connection and try again."
        }
        loaded = true
    }

    fun regenerate() {
        scope.launch {
            regenerating = true
            try {
                strategy = repo.regenerateStrategy()
                errorMessage = null
            } catch (e: Exception) {
                errorMessage = "Couldn't generate a new report. Check your connection and try again."
            }
            regenerating = false
        }
    }

    LaunchedEffect(Unit) { refresh() }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Strategy",
            "What's working, pulled from real campaign and signal data -- refreshes weekly.",
            kicker = strategy?.let { "Version ${it.version}" },
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
            val current = strategy
            if (current == null) {
                PolishedEmptyState(
                    icon = Icons.Filled.Timeline,
                    headline = "No strategy report yet",
                    subtitle = "Generates automatically once a week, or trigger the first one now.",
                    actionLabel = if (regenerating) "Generating..." else "Generate now",
                    onAction = if (regenerating) null else ::regenerate,
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
                        item {
                            GrowthCard {
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    if (current.lowConfidence) {
                                        Pill("Directional -- not enough data yet", Warning)
                                    } else {
                                        Pill("Confident read", Accent)
                                    }
                                    relativeTime(current.generatedAt)?.let { Pill(it, TextTertiary) }
                                }
                                Spacer(Modifier.height(10.dp))
                                Text(current.summary, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
                                Spacer(Modifier.height(12.dp))
                                GhostButton(
                                    text = if (regenerating) "Generating..." else "Regenerate now",
                                    onClick = ::regenerate,
                                    enabled = !regenerating,
                                )
                            }
                        }

                        if (current.topicsToIncrease.isNotEmpty()) {
                            item { SectionHeader("Double down on") }
                            items(current.topicsToIncrease) { StrategyItemRow(it, Icons.Filled.TrendingUp, Accent) }
                        }

                        if (current.topicsToDecrease.isNotEmpty()) {
                            item { SectionHeader("Pull back on") }
                            items(current.topicsToDecrease) { StrategyItemRow(it, Icons.Filled.TrendingDown, Warning) }
                        }

                        if (current.contentToRetire.isNotEmpty()) {
                            item { SectionHeader("Retire entirely") }
                            items(current.contentToRetire) { StrategyItemRow(it, Icons.Filled.TrendingDown, Danger) }
                        }

                        if (current.formatsToTest.isNotEmpty()) {
                            item { SectionHeader("Formats worth more volume") }
                            items(current.formatsToTest) { StrategyItemRow(it, Icons.Filled.TrendingUp, Accent) }
                        }

                        if (current.seoOpportunities.isNotEmpty()) {
                            item { SectionHeader("Rising search topics, no opportunity yet") }
                            items(current.seoOpportunities) { SeoOpportunityRow(it) }
                        }

                        if (current.creatorOpportunities.isNotEmpty()) {
                            item { SectionHeader("Creator relationships gone quiet") }
                            items(current.creatorOpportunities) { CreatorOpportunityRow(it) }
                        }

                        if (current.experimentsToRun.isNotEmpty()) {
                            item { SectionHeader("Experiments worth running") }
                            items(current.experimentsToRun) { ExperimentRow(it) }
                        }

                        if (
                            current.topicsToIncrease.isEmpty() && current.topicsToDecrease.isEmpty() &&
                            current.contentToRetire.isEmpty() && current.formatsToTest.isEmpty() &&
                            current.seoOpportunities.isEmpty() && current.creatorOpportunities.isEmpty()
                        ) {
                            item {
                                PolishedEmptyState(
                                    icon = Icons.Filled.Science,
                                    headline = "Nothing actionable yet",
                                    subtitle = "Not enough completed campaigns to spot a real pattern -- check back after more run.",
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StrategyItemRow(item: StrategyItem, icon: ImageVector, color: Color) {
    GrowthCard {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.height(20.dp))
            Column {
                Text(item.label, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(2.dp))
                Text(item.reason, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            }
        }
    }
}

@Composable
private fun SeoOpportunityRow(item: SeoOpportunity) {
    InsetRow {
        Column {
            Text(item.topic, style = MaterialTheme.typography.titleMedium)
            Text("velocity ${item.velocity}", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        }
    }
}

@Composable
private fun CreatorOpportunityRow(item: CreatorOpportunity) {
    InsetRow {
        Column {
            Text(item.handle, style = MaterialTheme.typography.titleMedium)
            Text(
                if (item.daysSinceLastInteraction == null) "Never actually contacted"
                else "${item.daysSinceLastInteraction} days since last interaction",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
            )
        }
    }
}

@Composable
private fun ExperimentRow(item: ExperimentSuggestion) {
    GrowthCard {
        Text(item.hypothesis, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(item.rationale, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
    }
}
