package com.fillbook.growthos.ui.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Science
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.fillbook.growthos.ui.components.ComingSoonScreen

@Composable
fun ResearchScreen(modifier: Modifier = Modifier) {
    ComingSoonScreen(
        title = "Research",
        subtitle = "Deep-dive investigations behind bigger content bets.",
        icon = Icons.Filled.Science,
        blockedOn = "The Research Lab phase hasn't started — research_projects " +
            "and research_results don't exist in the schema yet (see " +
            "docs/PROGRESS_LEDGER.md, Phase 8+). Not blocked on anything " +
            "external, just not reached yet.",
        modifier = modifier,
    )
}
