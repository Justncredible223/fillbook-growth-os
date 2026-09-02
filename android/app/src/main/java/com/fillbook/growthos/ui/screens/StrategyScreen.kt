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
        blockedOn = "A living record of what's working, so the growth strategy " +
            "keeps improving instead of repeating itself.",
        statusLabel = "Coming later",
        modifier = modifier,
    )
}
