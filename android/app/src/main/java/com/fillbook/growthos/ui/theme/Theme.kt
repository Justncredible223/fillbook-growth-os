package com.fillbook.growthos.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DarkColors = darkColorScheme(
    primary = Accent,
    onPrimary = Background,
    secondary = Success,
    onSecondary = Background,
    tertiary = AccentLight,
    background = Background,
    onBackground = TextPrimary,
    surface = Surface,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceVariant,
    onSurfaceVariant = TextSecondary,
    surfaceContainerHighest = SurfaceElevated,
    error = Danger,
    outline = Border,
    outlineVariant = BorderStrong,
)

private val LightColors = lightColorScheme(
    primary = AccentDim,
    background = androidx.compose.ui.graphics.Color(0xFFF6F7F9),
    surface = androidx.compose.ui.graphics.Color(0xFFFFFFFF),
)

/**
 * Dark-only for now. Screen components reference the dark palette's
 * Surface/TextPrimary/etc. constants directly rather than
 * MaterialTheme.colorScheme, so a light system theme previously rendered
 * near-black cards on a white background with unreadable text -- a real
 * bug caught during Phase 7 visual QA on an emulator. Forcing dark here
 * until the components are made theme-aware is the honest fix: light mode
 * was never actually finished, not a toggle worth exposing broken.
 */
@Composable
fun FillbookGrowthOSTheme(
    darkTheme: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colors,
        typography = AppTypography,
        content = content,
    )
}
