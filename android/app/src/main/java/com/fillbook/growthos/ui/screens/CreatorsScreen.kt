package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.Creator
import com.fillbook.growthos.data.CreatorCategory
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning

@Composable
fun CreatorsScreen(repo: GrowthOsRepository) {
    var creators by remember { mutableStateOf<List<Creator>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            creators = repo.getCreators()
        } catch (e: Exception) {
            errorMessage = "Couldn't load creators. Check your connection and try again."
        }
        loaded = true
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Creators",
            "Relationship stage for every creator Fillbook has vetted, interacted with, or rejected.",
        )

        errorMessage?.let { message ->
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = Danger,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }

        if (loaded && errorMessage == null && creators.isEmpty()) {
            EmptyState()
        } else {
            val tierB = creators.filter { it.category == CreatorCategory.TIER_B }
                .sortedByDescending { it.readinessScore ?: -1 }
            val researchNext = creators.filter { it.category == CreatorCategory.RESEARCH_NEXT }
                .sortedByDescending { it.readinessScore ?: -1 }
            val rejected = creators.filter { it.category == CreatorCategory.REJECTED }

            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (tierB.isNotEmpty()) {
                    item { SectionLabel("Tier B -- active relationships (${tierB.size})") }
                    items(tierB) { creator -> CreatorCard(creator) }
                }
                if (researchNext.isNotEmpty()) {
                    item { SectionLabel("Research Next (${researchNext.size})") }
                    items(researchNext) { creator -> CreatorCard(creator) }
                }
                if (rejected.isNotEmpty()) {
                    item { SectionLabel("Rejected (${rejected.size})") }
                    items(rejected) { creator -> CreatorCard(creator) }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = TextTertiary,
        modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
    )
}

@Composable
private fun EmptyState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "No creators tracked yet.",
            style = MaterialTheme.typography.titleMedium,
            color = TextSecondary,
        )
    }
}

@Composable
private fun CreatorCard(creator: Creator) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Text(
                creator.displayName?.let { "${creator.handle} -- $it" } ?: creator.handle,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f).padding(end = 8.dp),
            )
            creator.readinessScore?.let { score ->
                Text(
                    "$score/10",
                    style = MaterialTheme.typography.headlineMedium,
                    color = Accent,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill(platformDisplayName(creator.platform), TextSecondary)
            creator.followerCount?.let { count -> Pill(formatFollowers(count), TextSecondary) }
            if (creator.category == CreatorCategory.REJECTED) {
                Pill("rejected", Danger)
            }
        }
        creator.creatorProductMoment?.let { moment ->
            Spacer(Modifier.height(10.dp))
            Text("Product moment: $moment", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        }
        creator.notes?.let { notes ->
            Spacer(Modifier.height(8.dp))
            Text(notes, style = MaterialTheme.typography.bodySmall, color = TextTertiary)
        }
        creator.rejectionReason?.let { reason ->
            Spacer(Modifier.height(8.dp))
            Text(reason, style = MaterialTheme.typography.bodyMedium, color = Warning)
        }
    }
}

private fun formatFollowers(count: Int): String = when {
    count >= 1000 -> "%.1fK".format(count / 1000.0)
    else -> count.toString()
}
