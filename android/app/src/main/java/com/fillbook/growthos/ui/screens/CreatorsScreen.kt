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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
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
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.Creator
import com.fillbook.growthos.data.CreatorCategory
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.ExpandableText
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScoreBadge
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.StatusChip
import com.fillbook.growthos.ui.components.StatusTone
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.theme.Danger
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

        if (!loaded) {
            SkeletonListLoading()
        } else if (errorMessage == null && creators.isEmpty()) {
            PolishedEmptyState(
                icon = Icons.Filled.Groups,
                headline = "No creators tracked yet",
                subtitle = "Vetted, interacted, and rejected creators will show up here.",
            )
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
private fun CreatorCard(creator: Creator) {
    GrowthCard {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            creator.readinessScore?.let { score ->
                ScoreBadge(score = score * 10, label = "$score/10")
                Spacer(Modifier.width(12.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    creator.displayName?.let { "${creator.handle} -- $it" } ?: creator.handle,
                    style = MaterialTheme.typography.titleLarge,
                )
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Pill(platformDisplayName(creator.platform), TextSecondary)
                    creator.followerCount?.let { count -> Pill(formatFollowers(count), TextSecondary) }
                    if (creator.category == CreatorCategory.REJECTED) {
                        StatusChip("rejected", StatusTone.BLOCKED)
                    }
                }
            }
        }
        creator.creatorProductMoment?.let { moment ->
            Spacer(Modifier.height(10.dp))
            Text("Product moment: $moment", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        }
        creator.notes?.let { notes ->
            Spacer(Modifier.height(8.dp))
            ExpandableText(notes, style = MaterialTheme.typography.bodySmall, color = TextTertiary, collapsedMaxLines = 2)
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
