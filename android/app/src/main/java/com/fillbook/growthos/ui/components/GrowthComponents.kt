package com.fillbook.growthos.ui.components

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.CircularProgressIndicator
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

/** Centered spinner for the gap between "screen opened" and "data or error arrived" -- a blank screen reads as broken, this reads as working. */
@Composable
fun LoadingIndicator(modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Accent)
    }
}

/**
 * One row of a real bar chart: label, count, and a bar whose width is
 * proportional to `count / maxCount`. No trend/history is implied -- this
 * is a snapshot of the same counts the old plain-text rows showed, just
 * scannable at a glance instead of read number by number.
 */
@Composable
fun BreakdownBar(label: String, count: Int, maxCount: Int, modifier: Modifier = Modifier) {
    val fraction = if (maxCount <= 0) 0f else (count.toFloat() / maxCount.toFloat()).coerceIn(0f, 1f)
    Column(modifier = modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            Text(count.toString(), style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
        }
        Spacer(Modifier.height(4.dp))
        Box(modifier = Modifier.fillMaxWidth().height(6.dp).background(Border, RoundedCornerShape(999.dp))) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(6.dp)
                    .background(Accent, RoundedCornerShape(999.dp)),
            )
        }
    }
}

/**
 * Shimmering card-shaped placeholders for the load window on a list
 * screen -- reads as "content is coming" instead of a generic spinner,
 * and roughly previews the shape (title line + two body lines) of what's
 * about to load in.
 */
@Composable
fun SkeletonListLoading(modifier: Modifier = Modifier, count: Int = 3, horizontalPadding: androidx.compose.ui.unit.Dp = 20.dp) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by transition.animateFloat(
        initialValue = 0.3f,
        targetValue = 0.7f,
        animationSpec = infiniteRepeatable(animation = tween(700), repeatMode = RepeatMode.Reverse),
        label = "skeletonAlpha",
    )
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = horizontalPadding, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        repeat(count) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Surface)
                    .border(1.dp, Border, RoundedCornerShape(18.dp))
                    .padding(16.dp),
            ) {
                SkeletonLine(fraction = 0.55f, alpha = alpha, height = 16.dp)
                Spacer(Modifier.height(12.dp))
                SkeletonLine(fraction = 1f, alpha = alpha, height = 12.dp)
                Spacer(Modifier.height(6.dp))
                SkeletonLine(fraction = 0.75f, alpha = alpha, height = 12.dp)
            }
        }
    }
}

@Composable
private fun SkeletonLine(fraction: Float, alpha: Float, height: androidx.compose.ui.unit.Dp) {
    Box(
        modifier = Modifier
            .fillMaxWidth(fraction)
            .height(height)
            .background(TextTertiary.copy(alpha = alpha), RoundedCornerShape(4.dp)),
    )
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
