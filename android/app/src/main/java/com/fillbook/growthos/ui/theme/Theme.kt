package com.fillbook.growthos.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val Color0B = androidx.compose.ui.graphics.Color(0xFF0B0D10)

private val DarkColors = darkColorScheme(
    primary = Accent,
    onPrimary = Color0B,
    secondary = AccentLight,
    background = Background,
    onBackground = TextPrimary,
    surface = Surface,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceVariant,
    onSurfaceVariant = TextSecondary,
    error = Danger,
    outline = Border,
)

private val LightColors = lightColorScheme(
    primary = AccentDim,
    background = androidx.compose.ui.graphics.Color(0xFFF6F7F9),
    surface = androidx.compose.ui.graphics.Color(0xFFFFFFFF),
)

/**
 * Dark-first by design (this is an internal operator tool used mostly at
 * a desk/late at night reviewing drafts) — light theme exists but dark is
 * the primary, most-polished path.
 */
@Composable
fun FillbookGrowthOSTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colors,
        typography = AppTypography,
        content = content,
    )
}
