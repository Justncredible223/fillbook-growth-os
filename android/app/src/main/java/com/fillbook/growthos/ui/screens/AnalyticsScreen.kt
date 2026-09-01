package com.fillbook.growthos.ui.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Insights
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.fillbook.growthos.ui.components.ComingSoonScreen

@Composable
fun AnalyticsScreen(modifier: Modifier = Modifier) {
    ComingSoonScreen(
        title = "Analytics",
        subtitle = "Attribution and conversion data across every channel.",
        icon = Icons.Filled.Insights,
        blockedOn = "The website_events/attribution/conversions tables are " +
            "deliberately deferred until the Attribution Engine phase starts " +
            "(see docs/PROGRESS_LEDGER.md, Phase 8+). Note: FillbookHQ's own " +
            "UTM attribution for TikTok/X is currently broken/unconfirmed — " +
            "this screen won't build on that signal until it's fixed.",
        modifier = modifier,
    )
}
