package com.fillbook.growthos.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.HealthStatus
import com.fillbook.growthos.data.Urgency
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
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
