package com.fillbook.growthos.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Fillbook-native palette, deliberately matching FillbookHQ's actual web
 * design tokens (frontend/src/index.css) rather than an invented Android
 * palette -- this is what "the app should feel like it belongs to the same
 * company" means concretely: the same near-black surface ramp, the same
 * cyan brand color, the same gain/loss/warn semantics.
 *
 * A real correction from the prior Android palette: the old "Accent"
 * (#39E29D, mint green) was being used as the primary interactive color
 * everywhere -- but on the real product, that exact mint green is the
 * *gain/success* semantic color, not the brand color. FillbookHQ's actual
 * brand color is cyan. Using the success color as if it were the action
 * color is why the app read as "green everywhere" -- fixed here by giving
 * each color back its real, restrained job:
 *   - Accent (cyan)  -> interactive/actionable: buttons, links, selection,
 *                        nav, focus. Never used to mean "good" or "healthy".
 *   - Success (mint)  -> outcomes: healthy, ready, passed review, high
 *                        score. Never used for a button or a nav state.
 *   - Warning (amber) -> needs attention, in review, medium score.
 *   - Danger (coral)  -> blocked, failed, rejected, low/urgent score.
 */

// Surface ramp -- PAGE < CARD < ELEVATED, matching frontend/src/index.css's
// --color-bg-0 through --color-bg-4 exactly.
val Background = Color(0xFF07090D)
val Surface = Color(0xFF0D1117)
val SurfaceVariant = Color(0xFF111720)
val SurfaceElevated = Color(0xFF171F2A)
val SurfaceElevated2 = Color(0xFF1E2735)

val Border = Color(0xFF27313F)
val BorderStrong = Color(0xFF3A4658)

// Brand -- cyan, matching frontend's --color-brand / --color-brand-2.
val Accent = Color(0xFF0891B2)
val AccentLight = Color(0xFF22B8DC)
val AccentDim = Color(0xFF0E4F60)

val TextPrimary = Color(0xFFF5F7FA)
val TextSecondary = Color(0xFF8B95A5)
// Decorative only (sub-4.5:1 contrast by design, matching the web app's own
// documented policy) -- axis labels, timestamps, tertiary metadata. Must
// never carry primary body copy or a value the user needs to read reliably.
val TextTertiary = Color(0xFF596474)

// Outcome semantics -- matching frontend's --color-gain/--color-loss/--color-warn.
val Success = Color(0xFF2FE6A0)
val SuccessDim = Color(0xFF1C5F45)
val Danger = Color(0xFFFF4D6A)
val DangerDim = Color(0xFF6E2530)
val Warning = Color(0xFFF5A623)
val WarningDim = Color(0xFF6B4C12)

// Minimal neutral-informational tag (e.g. Inbound's "worth a reply"
// priority) -- kept separate from Accent so brand-cyan stays reserved for
// actionable/selection meaning only.
val Info = Color(0xFF5AA9E6)
