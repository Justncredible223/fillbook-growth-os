package com.fillbook.growthos.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.HealthStatus
import com.fillbook.growthos.data.Urgency
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning

@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(color.copy(alpha = 0.16f), RoundedCornerShape(999.dp))
            .padding(PaddingValues(horizontal = 10.dp, vertical = 4.dp)),
    ) {
        Text(text = text, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

/**
 * Platform values come from the backend lowercase (matches the DB
 * check constraint: 'x', 'youtube', 'tiktok', 'blog', ...) -- fine for
 * logic, but "Open in x" reads as a typo in UI text. This gives every
 * screen the same real display name instead of each one guessing.
 */
fun platformDisplayName(platform: String): String = when (platform.lowercase()) {
    "x" -> "X"
    "youtube" -> "YouTube"
    "tiktok" -> "TikTok"
    else -> platform.replaceFirstChar { it.uppercase() }
}

fun urgencyColor(urgency: Urgency): Color = when (urgency) {
    Urgency.HIGH -> Danger
    Urgency.NORMAL -> Warning
    Urgency.LOW -> TextTertiary
}

fun healthColor(status: HealthStatus): Color = when (status) {
    HealthStatus.HEALTHY -> Accent
    HealthStatus.DEGRADED -> Warning
    HealthStatus.DOWN -> Danger
    HealthStatus.NOT_CONNECTED -> TextTertiary
}

fun healthLabel(status: HealthStatus): String = when (status) {
    HealthStatus.HEALTHY -> "Healthy"
    HealthStatus.DEGRADED -> "Degraded"
    HealthStatus.DOWN -> "Down"
    HealthStatus.NOT_CONNECTED -> "Not connected"
}

/** Shared title/subtitle header used at the top of every screen. */
@Composable
fun ScreenHeader(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.padding(20.dp)) {
        Text(title, style = MaterialTheme.typography.headlineLarge)
        Spacer(Modifier.height(2.dp))
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
    }
}

/**
 * Honest placeholder for a screen whose backend endpoint/table doesn't
 * exist yet (see docs/PROGRESS_LEDGER.md). Explains what real data will
 * show up here and why it doesn't yet, instead of fabricating numbers or
 * lorem-ipsum content.
 */
@Composable
fun ComingSoonScreen(
    title: String,
    subtitle: String,
    icon: ImageVector,
    blockedOn: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        ScreenHeader(title, subtitle)
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Surface, RoundedCornerShape(16.dp))
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(icon, contentDescription = null, tint = TextTertiary, modifier = Modifier.height(32.dp))
                Spacer(Modifier.height(10.dp))
                Text(
                    "Not wired to real data yet",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextSecondary,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    blockedOn,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextTertiary,
                )
            }
        }
    }
}
