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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.QueryStats
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import com.fillbook.growthos.data.Experiment
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.GhostButton
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.LoadingIndicator
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch
import java.time.LocalDate

/**
 * Before/after content-performance tests -- NOT a randomized traffic
 * split (see backend/src/experiments/types.ts's kdoc for why: one X/
 * YouTube/TikTok account, no infrastructure to show different content to
 * different visitors). "Control" is the period before an experiment's
 * start date, "treatment" is start date onward, both measured on the
 * same real review-pass-rate metric.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExperimentsScreen(repo: GrowthOsRepository) {
    var experiments by remember { mutableStateOf<List<Experiment>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showCreateDialog by remember { mutableStateOf(false) }
    var busyId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            experiments = repo.getExperiments()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load experiments. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    fun act(id: String, action: suspend (String) -> Unit) {
        scope.launch {
            busyId = id
            try {
                action(id)
                refresh()
            } catch (e: Exception) {
                errorMessage = "That action didn't go through. Check your connection and try again."
            }
            busyId = null
        }
    }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = { showCreateDialog = true }, containerColor = Accent) {
                Icon(Icons.Filled.Add, contentDescription = "New experiment")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background)) {
            ScreenHeader(
                "Experiments",
                "Before/after content tests -- one account, so periods are compared, not a live A/B split.",
            )

            errorMessage?.let { message ->
                Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                }
            }

            if (!loaded) {
                LoadingIndicator()
            } else if (experiments.isEmpty()) {
                PolishedEmptyState(
                    icon = Icons.Filled.QueryStats,
                    headline = "No experiments yet",
                    subtitle = "Tap + to test a hypothesis against real review-pass-rate data.",
                )
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(experiments) { experiment ->
                        ExperimentCard(
                            experiment = experiment,
                            busy = busyId == experiment.id,
                            onMeasure = { act(experiment.id) { id -> repo.measureExperiment(id) } },
                            onComplete = { act(experiment.id) { id -> repo.completeExperiment(id) } },
                            onAbort = { act(experiment.id) { id -> repo.abortExperiment(id) } },
                        )
                    }
                }
            }
        }
    }

    if (showCreateDialog) {
        CreateExperimentDialog(
            onDismiss = { showCreateDialog = false },
            onCreate = { hypothesis, platform, assetType, controlWindowDays ->
                scope.launch {
                    try {
                        repo.createExperiment(
                            hypothesis = hypothesis,
                            scopePlatform = platform.ifBlank { null },
                            scopeAssetType = assetType.ifBlank { null },
                            guardrailNote = null,
                            startDate = LocalDate.now().toString(),
                            controlWindowDays = controlWindowDays,
                        )
                        showCreateDialog = false
                        refresh()
                    } catch (e: Exception) {
                        errorMessage = "Couldn't create that experiment. Check your connection and try again."
                        showCreateDialog = false
                    }
                }
            },
        )
    }
}

@Composable
private fun ExperimentCard(
    experiment: Experiment,
    busy: Boolean,
    onMeasure: () -> Unit,
    onComplete: () -> Unit,
    onAbort: () -> Unit,
) {
    GrowthCard {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(experiment.status, statusColor(experiment.status))
            if (experiment.scopePlatform != null) Pill(experiment.scopePlatform, TextTertiary)
            if (experiment.scopeAssetType != null) Pill(experiment.scopeAssetType, TextTertiary)
        }
        Spacer(Modifier.height(8.dp))
        Text(experiment.hypothesis, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text("Started ${experiment.startDate}", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)

        experiment.result?.let { result ->
            Spacer(Modifier.height(10.dp))
            Text(result.interpretation, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        }

        if (experiment.status == "running") {
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton(text = if (busy) "Working..." else "Check now", onClick = onMeasure, enabled = !busy)
                GhostButton(text = "Complete", onClick = onComplete, enabled = !busy, color = Accent)
                GhostButton(text = "Abort", onClick = onAbort, enabled = !busy, color = Danger)
            }
        }
    }
}

private fun statusColor(status: String) = when (status) {
    "running" -> Accent
    "completed" -> Accent
    "aborted" -> Danger
    else -> Warning
}

@Composable
private fun CreateExperimentDialog(
    onDismiss: () -> Unit,
    onCreate: (hypothesis: String, platform: String, assetType: String, controlWindowDays: Int) -> Unit,
) {
    var hypothesis by remember { mutableStateOf("") }
    var platform by remember { mutableStateOf("") }
    var assetType by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New experiment") },
        text = {
            Column {
                Text(
                    "Compares real review-pass-rate before vs. after today across the assets you scope this to.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = hypothesis,
                    onValueChange = { hypothesis = it },
                    label = { Text("Hypothesis") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = platform,
                    onValueChange = { platform = it },
                    label = { Text("Platform (optional, e.g. tiktok)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = assetType,
                    onValueChange = { assetType = it },
                    label = { Text("Asset type (optional, e.g. video_script)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(hypothesis, platform, assetType, 14) }, enabled = hypothesis.isNotBlank()) {
                Text("Start")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
