package com.fillbook.growthos.ui.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.fillbook.growthos.ui.components.ComingSoonScreen

@Composable
fun CampaignsScreen(modifier: Modifier = Modifier) {
    ComingSoonScreen(
        title = "Campaigns",
        subtitle = "Every campaign's stage, from idea to handed-off draft.",
        icon = Icons.Filled.Campaign,
        blockedOn = "The Campaign Factory stage machine is live server-side " +
            "(backend/src/content/campaignFactory.ts), but there's no " +
            "/api/campaigns endpoint yet to list them here. Once added, " +
            "this screen shows each campaign's real stage — never a fabricated one.",
        modifier = modifier,
    )
}
