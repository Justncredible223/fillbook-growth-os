package com.fillbook.growthos.ui.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.fillbook.growthos.ui.components.ComingSoonScreen

@Composable
fun ContentLibraryScreen(modifier: Modifier = Modifier) {
    ComingSoonScreen(
        title = "Content Library",
        subtitle = "Every draft ever produced, with its quality scores.",
        icon = Icons.Filled.VideoLibrary,
        blockedOn = "content_versions and content_scores already exist in the " +
            "schema (Phase 6) and are populated by the Campaign Factory / " +
            "Content Quality Gate, but there's no listing endpoint yet. Once " +
            "added, this becomes a real searchable archive — never staged copy.",
        modifier = modifier,
    )
}
