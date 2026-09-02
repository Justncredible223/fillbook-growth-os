package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.Opportunity
import com.fillbook.growthos.ui.components.ExpandableText
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.IconPill
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScoreBadge
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SearchField
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.components.platformIcon
import com.fillbook.growthos.ui.components.urgencyColor
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RadarScreen(repo: GrowthOsRepository) {
    var opportunities by remember { mutableStateOf<List<Opportunity>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            opportunities = repo.getOpportunities()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load opportunities. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    val filtered = remember(opportunities, query) {
        if (query.isBlank()) opportunities
        else opportunities.filter { it.title.contains(query, ignoreCase = true) || it.rationale.contains(query, ignoreCase = true) }
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader("Radar", "Opportunities found from real signals — nothing here publishes itself.")

        errorMessage?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
            }
        }

        if (!loaded) {
            SkeletonListLoading()
        } else if (errorMessage == null && opportunities.isEmpty()) {
            PolishedEmptyState(
                icon = Icons.Filled.Radar,
                headline = "Nothing on Radar yet",
                subtitle = "Once the daily signal sweep runs, real opportunities show up here.",
            )
        } else {
            SearchField(query, { query = it }, "Search opportunities", modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                if (filtered.isEmpty()) {
                    PolishedEmptyState(
                        icon = Icons.Filled.Radar,
                        headline = "No matches",
                        subtitle = "Nothing on Radar matches \"$query\".",
                    )
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(filtered) { opp -> OpportunityCard(opp) }
                    }
                }
            }
        }
    }
}

/** Titles come from the backend as "source: text" (real provenance, not fluff) -- split it into a clean headline plus a source chip instead of showing the raw prefix. */
private fun splitTitle(title: String): Pair<String, String?> {
    val idx = title.indexOf(": ")
    if (idx <= 0) return title to null
    return title.substring(idx + 2) to title.substring(0, idx)
}

@Composable
private fun OpportunityCard(opp: Opportunity) {
    val (headline, source) = splitTitle(opp.title)

    GrowthCard {
        Row(verticalAlignment = Alignment.Top) {
            ScoreBadge(score = opp.score.toInt())
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(headline, style = MaterialTheme.typography.titleLarge, maxLines = 2)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Pill(opp.urgency.name.lowercase(), urgencyColor(opp.urgency))
                    opp.channels.forEach { channel -> IconPill(platformDisplayName(channel), platformIcon(channel), TextSecondary) }
                    source?.let { Pill(it.replace("_", " "), TextSecondary) }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        ExpandableText(opp.rationale, style = MaterialTheme.typography.bodyMedium, color = TextSecondary, collapsedMaxLines = 2)
    }
}
