package com.fillbook.growthos.ui.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.fillbook.growthos.ui.components.ComingSoonScreen

@Composable
fun CreatorsScreen(modifier: Modifier = Modifier) {
    ComingSoonScreen(
        title = "Creators",
        subtitle = "Relationship stage for every creator in the network.",
        icon = Icons.Filled.Groups,
        blockedOn = "FillbookHQ already tracks a real creator network manually " +
            "(docs/SEED_DATA_SOURCES.md — 0-10 relationship-readiness scale, " +
            "several Tier B creators with logged interactions), but the " +
            "creators/creator_interactions tables aren't in this app's schema " +
            "yet (Creator CRM phase not started). Not started, not blocked.",
        modifier = modifier,
    )
}
