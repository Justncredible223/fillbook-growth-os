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
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.HealthItem
import com.fillbook.growthos.data.HealthStatus
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.healthColor
import com.fillbook.growthos.ui.components.healthLabel
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary

/**
 * The one genuinely useful thing to show here without a dedicated backend
 * endpoint: which integrations still need an owner action (real /api/health
 * data, reused), plus static app/build info. No fabricated settings toggles
 * for features that don't exist yet.
 */
@Composable
fun SettingsScreen(repo: GrowthOsRepository) {
    var health by remember { mutableStateOf<List<HealthItem>>(emptyList()) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            health = repo.getHealth()
        } catch (e: Exception) {
            errorMessage = "Couldn't reach Growth OS. Check your connection and try again."
        }
    }

    val needsOwnerAction = health.filter { it.status == HealthStatus.NOT_CONNECTED }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        ScreenHeader("Settings", "Owner actions and app info.")

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
            if (needsOwnerAction.isNotEmpty()) {
                item {
                    Text(
                        "NEEDS YOUR ACTION".uppercase(),
                        style = MaterialTheme.typography.labelMedium,
                        color = TextSecondary,
                    )
                }
                items(needsOwnerAction) { item -> OwnerActionRow(item) }
            }

            item {
                Text(
                    "ABOUT".uppercase(),
                    style = MaterialTheme.typography.labelMedium,
                    color = TextSecondary,
                )
            }
            item { AboutRow("Version", "0.1.0 (debug build)") }
            item { AboutRow("Backend", "fillbook-growth-os.vercel.app") }
            item { AboutRow("Database", "Supabase, fillbook-growth-os project") }
        }
    }
}

@Composable
private fun OwnerActionRow(item: HealthItem) {
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

@Composable
private fun AboutRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Surface)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.titleMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = TextTertiary)
    }
}
