package com.fillbook.growthos.ui.components

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Background
import com.fillbook.growthos.ui.theme.Border
import com.fillbook.growthos.ui.theme.BorderStrong
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.KpiNumberStyleSmall
import com.fillbook.growthos.ui.theme.Success
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.SurfaceElevated
import com.fillbook.growthos.ui.theme.TextPrimary
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning

/**
 * The one card surface the whole app builds on. `accentBar` paints a thin
 * colored rail down the left edge -- Growth OS's own "signal" motif,
 * currently used for Radar's score-band identity, available to any screen
 * that has a real per-item priority/status to communicate without adding
 * another badge. Left null for a plain info card.
 */
@Composable
fun GrowthCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    accentBar: Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    var base: Modifier = modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(20.dp))
        .background(Surface)
        .border(1.dp, Border, RoundedCornerShape(20.dp))
    if (onClick != null) base = base.clickable(onClick = onClick)

    if (accentBar != null) {
        Row(modifier = base) {
            Box(modifier = Modifier.width(3.dp).fillMaxWidth().background(accentBar))
            Column(modifier = Modifier.weight(1f).padding(16.dp), content = content)
        }
    } else {
        Column(modifier = base.padding(16.dp), content = content)
    }
}

/**
 * The one "Level 1" surface in the app: the single most important thing
 * on a screen (Home's next-best-action). Everything else uses [GrowthCard]
 * (Level 2) or [InsetRow] (Level 3) -- three consistent weights instead of
 * every panel looking the same. An elevated surface + a soft cyan-tinted
 * glow (not a loud filled banner) does the "this one matters" signaling.
 */
@Composable
fun HeroActionCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    actionLabel: String,
    modifier: Modifier = Modifier,
    kicker: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val brush = Brush.linearGradient(colors = listOf(Accent.copy(alpha = 0.16f), SurfaceElevated))
    var base: Modifier = modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(24.dp))
        .background(brush)
        .border(1.dp, Accent.copy(alpha = 0.4f), RoundedCornerShape(24.dp))
    if (onClick != null) base = base.clickable(onClick = onClick)

    Column(modifier = base.padding(20.dp)) {
        if (kicker != null) {
            Text(kicker.uppercase(), style = com.fillbook.growthos.ui.theme.OverlineStyle, color = Accent)
            Spacer(Modifier.height(8.dp))
        }
        Row(verticalAlignment = Alignment.Top) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .background(Accent.copy(alpha = 0.18f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = Accent, modifier = Modifier.size(21.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleLarge, color = TextPrimary)
                Spacer(Modifier.height(4.dp))
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .background(Accent, RoundedCornerShape(999.dp))
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            Text(actionLabel, style = MaterialTheme.typography.labelLarge, color = Background)
            Spacer(Modifier.width(6.dp))
            Text("→", style = MaterialTheme.typography.labelLarge, color = Background)
        }
    }
}

/**
 * "Level 3" surface -- quieter than [GrowthCard], for metadata/nested
 * content inside a card (an activity row, a sub-item) rather than a
 * page-level panel. Lower contrast than Surface, no border -- reads as
 * inset rather than another card competing for attention.
 */
@Composable
fun InsetRow(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(com.fillbook.growthos.ui.theme.SurfaceVariant)
            .padding(12.dp),
        content = content,
    )
}

/**
 * Icon-labeled quick-jump action -- replaces a text-only OutlinedButton
 * so common destinations (Approvals, Radar, Analytics) are recognizable
 * by shape/icon, not just a word, per the one-click-accessibility goal.
 */
@Composable
fun QuickActionChip(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .border(1.dp, Border, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = Accent, modifier = Modifier.size(20.dp))
        Spacer(Modifier.height(6.dp))
        Text(label, style = MaterialTheme.typography.labelLarge, color = TextPrimary)
    }
}

/**
 * Enum-driven status coloring so every screen's chips mean the same thing.
 * READY/HEALTHY/ACTIVE map to Success (an outcome), never Accent (an
 * action) -- see Color.kt's kdoc for why that distinction is the point of
 * this whole redesign.
 */
enum class StatusTone { READY, ACTIVE, WAITING, BLOCKED, SKIPPED, FAILED, HEALTHY, NEW, NEUTRAL }

/**
 * SKIPPED/NEUTRAL use TextSecondary, not TextTertiary -- these are real
 * status words ("Not connected", "Closed"), and TextTertiary's ~3.3:1
 * contrast against Background fails WCAG AA for text at this size.
 * TextTertiary itself is untouched for genuinely decorative metadata
 * (timestamps, helper captions) elsewhere in the app.
 */
fun statusToneColor(tone: StatusTone): Color = when (tone) {
    StatusTone.READY, StatusTone.HEALTHY, StatusTone.ACTIVE -> Success
    StatusTone.NEW -> Accent
    StatusTone.WAITING -> Warning
    StatusTone.BLOCKED, StatusTone.FAILED -> Danger
    StatusTone.SKIPPED, StatusTone.NEUTRAL -> TextSecondary
}

/** The bold filled-pill treatment -- reserved for the few callouts that should shout (TOP PICK, AUTO-DRAFT, NEEDS RESPONSE). */
@Composable
fun StatusChip(text: String, tone: StatusTone, modifier: Modifier = Modifier) {
    Pill(text.uppercase(), statusToneColor(tone), modifier)
}

/**
 * The quiet default for everyday status (asset stage, campaign status,
 * a subsystem's health row) -- a small dot + colored label on a
 * transparent background instead of a loud filled pill. Reserving the
 * filled [StatusChip] for genuinely urgent callouts is what keeps this
 * one meaningful rather than every card shouting equally.
 */
@Composable
fun QuietStatusLabel(text: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val color = statusToneColor(tone)
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(6.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

/** Small filled dot -- the "● Connected" operational-health visual language, paired with a status label for the full meaning. */
@Composable
fun HealthDot(color: Color, modifier: Modifier = Modifier) {
    Box(modifier = modifier.size(8.dp).background(color, CircleShape))
}

/**
 * Compact number+label tile for a top status row -- Home's "what
 * happened" summary. `highlighted` swaps the icon into a color-tinted
 * badge and drops a matching border, for the one tile in a row that
 * actually needs attention -- without that, every tile in a 2x2 grid
 * reads as equally important even when one clearly isn't. Non-highlighted
 * tiles are deliberately flatter (no border) so the highlighted one has
 * something to stand out against.
 */
@Composable
fun MetricTile(
    label: String,
    value: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    valueColor: Color = TextPrimary,
    highlighted: Boolean = false,
    highlightColor: Color = Accent,
) {
    Column(
        modifier = modifier
            .background(if (highlighted) SurfaceElevated else Surface, RoundedCornerShape(18.dp))
            .then(
                if (highlighted) Modifier.border(1.dp, highlightColor.copy(alpha = 0.5f), RoundedCornerShape(18.dp))
                else Modifier,
            )
            .padding(14.dp),
    ) {
        if (highlighted) {
            Box(
                modifier = Modifier.size(26.dp).background(highlightColor.copy(alpha = 0.18f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = highlightColor, modifier = Modifier.size(14.dp))
            }
        } else {
            Icon(icon, contentDescription = null, tint = TextTertiary, modifier = Modifier.height(15.dp))
        }
        Spacer(Modifier.height(10.dp))
        Text(value, style = KpiNumberStyleSmall, color = valueColor)
        Spacer(Modifier.height(1.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = TextSecondary)
    }
}

/**
 * Ring-gauge score readout -- a real gauge (track + progress arc), not a
 * flat bordered circle. `score` (0-100) drives the arc fill and the color
 * band; `label` overrides the printed text for scales that aren't 0-100
 * (creator readiness is 0-10 -- pass score=readiness*10 for the correct
 * band color, label="$readiness/10" for the correct text).
 */
@Composable
fun ScoreBadge(
    score: Int,
    modifier: Modifier = Modifier,
    label: String = score.toString(),
    colorOverride: Color? = null,
    semanticLabel: String = "Score $label",
) {
    val color = colorOverride ?: when {
        score >= 70 -> Success
        score >= 45 -> Warning
        else -> TextTertiary
    }
    val fraction = (score / 100f).coerceIn(0f, 1f)
    Box(
        modifier = modifier.size(50.dp).clearAndSetSemantics { contentDescription = semanticLabel },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.size(50.dp)) {
            val stroke = 4.dp.toPx()
            drawArc(
                color = Border,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
                size = Size(size.width - stroke, size.height - stroke),
                topLeft = androidx.compose.ui.geometry.Offset(stroke / 2, stroke / 2),
            )
            drawArc(
                color = color,
                startAngle = -90f,
                sweepAngle = 360f * fraction,
                useCenter = false,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
                size = Size(size.width - stroke, size.height - stroke),
                topLeft = androidx.compose.ui.geometry.Offset(stroke / 2, stroke / 2),
            )
        }
        Text(label, style = MaterialTheme.typography.titleMedium, color = color)
    }
}

/** Primary filled action -- cyan, reserved for the single most important action on a card/screen (approve, build campaign, save). */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Background, disabledContainerColor = Accent.copy(alpha = 0.4f)),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.heightIn(min = 48.dp),
    ) {
        if (busy) CircularProgressIndicator(modifier = Modifier.height(18.dp), color = Background, strokeWidth = 2.dp)
        else Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

/** Secondary outlined action -- used for a card's non-primary but still real action (reject, follow up). */
@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, contentColor: Color = TextPrimary) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = contentColor),
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderStrong),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.heightIn(min = 48.dp),
    ) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

/** Lowest-emphasis action -- plain text, for a card's tertiary/optional action (copy & share, dismiss). */
@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Accent, enabled: Boolean = true) {
    TextButton(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 48.dp)) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (enabled) color else TextTertiary)
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
            modifier = Modifier.size(60.dp).background(SurfaceElevated, CircleShape).border(1.dp, Border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = TextTertiary, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text(headline, style = MaterialTheme.typography.titleMedium, color = TextPrimary, textAlign = TextAlign.Center)
        Spacer(Modifier.height(4.dp))
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = TextSecondary, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(18.dp))
            SecondaryButton(actionLabel, onAction)
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
 * Client-side search box for a list screen -- filters what's already
 * loaded rather than round-tripping to the backend, since every list
 * here is small enough to hold in memory and there's no search endpoint
 * to call anyway. Shows a clear (x) button once there's text so clearing
 * a search never requires selecting-and-deleting.
 */
@Composable
fun SearchField(query: String, onQueryChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text(placeholder) },
        singleLine = true,
        shape = RoundedCornerShape(14.dp),
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = TextTertiary) },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Filled.Clear, contentDescription = "Clear search", tint = TextTertiary)
                }
            }
        },
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent, unfocusedBorderColor = Border),
        modifier = modifier.fillMaxWidth(),
    )
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
    Column(modifier = modifier.fillMaxWidth().padding(vertical = 5.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            Text(count.toString(), style = KpiNumberStyleSmall.copy(fontSize = 14.sp), color = TextPrimary)
        }
        Spacer(Modifier.height(5.dp))
        Box(modifier = Modifier.fillMaxWidth().height(5.dp).background(SurfaceVariantColor, RoundedCornerShape(999.dp))) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(5.dp)
                    .background(Accent, RoundedCornerShape(999.dp)),
            )
        }
    }
}

private val SurfaceVariantColor get() = com.fillbook.growthos.ui.theme.SurfaceVariant

/**
 * Compose has no first-party "prefers reduced motion" signal the way
 * some other platforms do -- this reads the same system setting Android's
 * own Developer Options "Remove animations" toggle writes
 * (Settings.Global.ANIMATOR_DURATION_SCALE = 0), which Compose's own
 * animation APIs don't automatically respect on their own clock. Read
 * once per composition, not observed live, since this setting doesn't
 * change while the app is running.
 */
@Composable
private fun rememberReducedMotionEnabled(): Boolean {
    val context = LocalContext.current
    return remember {
        android.provider.Settings.Global.getFloat(
            context.contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
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
    val alpha: Float = if (rememberReducedMotionEnabled()) {
        0.5f
    } else {
        val transition = rememberInfiniteTransition(label = "skeleton")
        val animatedAlpha by transition.animateFloat(
            initialValue = 0.3f,
            targetValue = 0.7f,
            animationSpec = infiniteRepeatable(animation = tween(700), repeatMode = RepeatMode.Reverse),
            label = "skeletonAlpha",
        )
        animatedAlpha
    }
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = horizontalPadding, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        repeat(count) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(Surface)
                    .border(1.dp, Border, RoundedCornerShape(20.dp))
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
        modifier = modifier
            .animateContentSize()
            .clickable { expanded = !expanded }
            .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
    )
}
