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
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.HealthItem
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.healthColor
import com.fillbook.growthos.ui.components.healthLabel
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary

/**
 * Reuses the same real /api/health data Home shows a summary of, at full
 * detail, plus the Pause System control. The pause toggle is disabled --
 * system_settings exists in the schema (migration 0006) but no
 * /api/system-settings endpoint exists yet to read or flip it, so this
 * stays visibly inert rather than pretending to work.
 */
@Composable
fun SystemScreen(repo: GrowthOsRepository) {
    var health by remember { mutableStateOf<List<HealthItem>>(emptyList()) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            health = repo.getHealth()
        } catch (e: Exception) {
            errorMessage = "Couldn't reach Growth OS. Check your connection and try again."
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        ScreenHeader("System", "Live diagnostics for every subsystem and integration.")

        errorMessage?.let { message ->
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = Danger,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }

        LazyColumn(
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { PauseSystemRow() }
            item {
                Text(
                    "SUBSYSTEMS".uppercase(),
                    style = MaterialTheme.typography.labelMedium,
                    color = TextSecondary,
                )
            }
            items(health) { item -> SystemHealthRow(item) }
        }
    }
}

@Composable
private fun PauseSystemRow() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Surface)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text("Pause System", style = MaterialTheme.typography.titleMedium)
            Text(
                "Not wired yet -- system_settings exists but has no API endpoint.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextTertiary,
            )
        }
        Switch(checked = false, onCheckedChange = null, enabled = false, colors = SwitchDefaults.colors())
    }
}

@Composable
private fun SystemHealthRow(item: HealthItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Surface)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(item.label, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(2.dp))
            Text(item.detail, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        }
        Pill(healthLabel(item.status), healthColor(item.status))
    }
}
