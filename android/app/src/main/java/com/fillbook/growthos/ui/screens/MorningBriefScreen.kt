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
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material3.MaterialTheme
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
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.MorningBrief
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.InsetRow
import com.fillbook.growthos.ui.components.LoadingIndicator
import com.fillbook.growthos.ui.components.MetricTile
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SectionHeader
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextSecondary
import kotlinx.coroutines.launch

/**
 * "Useful within one minute" (master spec). Real trailing-24h data, no
 * fabricated trend lines or invented numbers -- a quiet night shows up as
 * zeros, not a fake highlight.
 */
@Composable
fun MorningBriefScreen(repo: GrowthOsRepository) {
    var brief by remember { mutableStateOf<MorningBrief?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            brief = repo.getMorningBrief()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load the morning brief. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader("Morning Brief", "What happened overnight, in under a minute.")

        errorMessage?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
            }
        }

        if (!loaded) {
            LoadingIndicator()
        } else {
            val current = brief
            if (current == null) {
                PolishedEmptyState(icon = Icons.Filled.WbSunny, headline = "No brief yet", subtitle = "Check back after the next daily run.")
            } else {
                LazyColumn(contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricTile("Signals overnight", current.signalsOvernight.toString(), Icons.Filled.WbSunny, modifier = Modifier.weight(1f))
                            MetricTile("Waiting on you", current.pendingApprovals.toString(), Icons.Filled.WbSunny, modifier = Modifier.weight(1f))
                        }
                    }
                    current.strategySummary?.let { summary ->
                        item { SectionHeader("Strategy read") }
                        item { GrowthCard { Text(summary, style = MaterialTheme.typography.bodyMedium, color = TextSecondary) } }
                    }
                    if (current.topNewOpportunities.isNotEmpty()) {
                        item { SectionHeader("New opportunities") }
                        current.topNewOpportunities.forEach { opp ->
                            item {
                                InsetRow {
                                    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                        Text(opp.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                                        Text(opp.score.toInt().toString(), style = MaterialTheme.typography.titleMedium)
                                    }
                                }
                            }
                        }
                    }
                    if (current.inboundNeedsResponse > 0) {
                        item { SectionHeader("Inbound") }
                        item { GrowthCard { Text("${current.inboundNeedsResponse} conversation(s) need a response.", style = MaterialTheme.typography.bodyMedium, color = TextSecondary) } }
                    }
                }
            }
        }
    }
}
