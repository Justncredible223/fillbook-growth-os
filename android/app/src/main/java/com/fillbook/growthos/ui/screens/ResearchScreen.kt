package com.fillbook.growthos.ui.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Science
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.fillbook.growthos.ui.components.ComingSoonScreen

@Composable
fun ResearchScreen(modifier: Modifier = Modifier) {
    ComingSoonScreen(
        title = "Research Lab",
        subtitle = "Deep-dive investigations behind bigger content bets.",
        icon = Icons.Filled.Science,
        blockedOn = "Deep investigations that turn recurring market signals " +
            "into evidence-backed content opportunities.",
        statusLabel = "Coming later",
        modifier = modifier,
    )
}
