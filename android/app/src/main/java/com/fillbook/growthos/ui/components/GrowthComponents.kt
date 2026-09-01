package com.fillbook.growthos.ui.components

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Border
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning

/**
 * The one card shape the whole app uses -- same radius/border/padding
 * everywhere, so screens read as one product instead of one-off layouts.
 * Pass onClick to make the whole card tappable (e.g. drill into detail);
 * omit it for a pure info card.
 */
@Composable
fun GrowthCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    var base: Modifier = modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(18.dp))
        .background(Surface)
        .border(1.dp, Border, RoundedCornerShape(18.dp))
    if (onClick != null) base = base.clickable(onClick = onClick)
    Column(modifier = base.padding(16.dp), content = content)
}

/** Enum-driven status coloring so every screen's chips mean the same thing. */
enum class StatusTone { READY, ACTIVE, WAITING, BLOCKED, SKIPPED, FAILED, HEALTHY, NEW, NEUTRAL }

fun statusToneColor(tone: StatusTone): Color = when (tone) {
    StatusTone.READY, StatusTone.HEALTHY, StatusTone.ACTIVE -> Accent
    StatusTone.NEW -> Accent
    StatusTone.WAITING -> Warning
    StatusTone.BLOCKED, StatusTone.FAILED -> Danger
    StatusTone.SKIPPED, StatusTone.NEUTRAL -> TextTertiary
}

@Composable
fun StatusChip(text: String, tone: StatusTone, modifier: Modifier = Modifier) {
    Pill(text.uppercase(), statusToneColor(tone), modifier)
}

/** Compact number+label tile for a top status row -- Home's "what happened" summary. */
@Composable
fun MetricTile(
    label: String,
    value: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    valueColor: Color = TextPrimary,
) {
    Column(
        modifier = modifier
            .background(Surface, RoundedCornerShape(16.dp))
            .border(1.dp, Border, RoundedCornerShape(16.dp))
            .padding(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = TextTertiary, modifier = Modifier.height(16.dp))
        Spacer(Modifier.height(10.dp))
        Text(value, style = MaterialTheme.typography.headlineMedium, color = valueColor)
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextSecondary)
    }
}

/**
 * Small circular score readout -- used wherever a number needs to scan
 * fast. `score` (0-100) always drives the color band; `label` overrides
 * what's printed for scales that aren't 0-100 (e.g. creator readiness is
 * 0-10 -- pass score=readiness*10 for correct color, label="$readiness/10"
 * for correct text).
 */
@Composable
fun ScoreBadge(score: Int, modifier: Modifier = Modifier, label: String = score.toString()) {
    val color = when {
        score >= 70 -> Accent
        score >= 45 -> Warning
        else -> TextTertiary
    }
    Box(
        modifier = modifier
            .size(46.dp)
            .background(color.copy(alpha = 0.14f), CircleShape)
            .border(2.dp, color, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = MaterialTheme.typography.titleMedium, color = color)
    }
}

/**
 * Icon-led empty state used everywhere instead of a wall of explanatory
 * text. Stays honest (the caller supplies the real reason something is
 * empty) but reads in one glance instead of a paragraph.
 */
@Composable
fun PolishedEmptyState(
    icon: ImageVector,
    headline: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier.size(56.dp).background(Surface, CircleShape).border(1.dp, Border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = TextTertiary, modifier = Modifier.size(26.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(headline, style = MaterialTheme.typography.titleMedium, color = TextPrimary, textAlign = TextAlign.Center)
        Spacer(Modifier.height(4.dp))
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = TextSecondary, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}

/** Tap-to-expand text -- shows the important first lines, rest is one tap away. */
@Composable
fun ExpandableText(
    text: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    collapsedMaxLines: Int = 2,
) {
    var expanded by remember { mutableStateOf(false) }
    Text(
        text,
        style = style,
        color = color,
        maxLines = if (expanded) Int.MAX_VALUE else collapsedMaxLines,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier.animateContentSize().clickable { expanded = !expanded },
    )
}
