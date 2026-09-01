package com.fillbook.growthos.ui.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.fillbook.growthos.ui.components.ComingSoonScreen

@Composable
fun StrategyScreen(modifier: Modifier = Modifier) {
    ComingSoonScreen(
        title = "Strategy",
        subtitle = "How the Growth Genome has evolved its own playbook over time.",
        icon = Icons.Filled.Timeline,
        blockedOn = "growth_genome and strategy_versions don't exist in the " +
            "schema yet — Strategy Evolution is a later phase, not started " +
            "(see docs/PROGRESS_LEDGER.md, Phase 8+). The Brand Constitution " +
            "that already exists (Phase 3) is the static seed this will " +
            "eventually learn from, not replace.",
        modifier = modifier,
    )
}
