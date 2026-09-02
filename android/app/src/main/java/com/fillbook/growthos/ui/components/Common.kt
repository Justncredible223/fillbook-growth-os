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

fun healthTone(status: HealthStatus): StatusTone = when (status) {
    HealthStatus.HEALTHY -> StatusTone.HEALTHY
    HealthStatus.DEGRADED -> StatusTone.WAITING
    HealthStatus.DOWN -> StatusTone.BLOCKED
    HealthStatus.NOT_CONNECTED -> StatusTone.NEUTRAL
}

/** Same real stage strings every screen already switches on, mapped to the shared status vocabulary. */
fun assetStageTone(stage: String): StatusTone = when (stage) {
    "ready_for_owner", "handed_off" -> StatusTone.READY
    "final_draft" -> StatusTone.WAITING
    else -> StatusTone.NEUTRAL
}

fun campaignStatusTone(status: String): StatusTone = when (status) {
    "approved" -> StatusTone.READY
    "in_review" -> StatusTone.WAITING
    "retired" -> StatusTone.BLOCKED
    else -> StatusTone.NEUTRAL
}

/**
 * "2h ago" instead of a raw ISO timestamp -- parses the subset of ISO
 * 8601 this backend actually emits (java.time on the server, always
 * UTC). Falls back to the raw string if parsing fails rather than
 * crashing the row it's shown in over a formatting edge case.
 */
fun relativeTime(isoTimestamp: String?): String? {
    if (isoTimestamp == null) return null
    val instant = runCatching { java.time.Instant.parse(isoTimestamp) }.getOrNull() ?: return isoTimestamp
    val seconds = java.time.Duration.between(instant, java.time.Instant.now()).seconds
    return when {
        seconds < 60 -> "just now"
        seconds < 3600 -> "${seconds / 60}m ago"
        seconds < 86400 -> "${seconds / 3600}h ago"
        seconds < 604800 -> "${seconds / 86400}d ago"
        else -> "${seconds / 604800}w ago"
    }
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
