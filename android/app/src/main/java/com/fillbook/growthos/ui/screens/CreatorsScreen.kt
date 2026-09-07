package com.fillbook.growthos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.Creator
import com.fillbook.growthos.data.CreatorCategory
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.ExpandableText
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.IconPill
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.SkeletonListLoading
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScoreBadge
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.SearchField
import com.fillbook.growthos.ui.components.SecondaryButton
import com.fillbook.growthos.ui.components.SectionHeader
import com.fillbook.growthos.ui.components.StatusChip
import com.fillbook.growthos.ui.components.StatusTone
import com.fillbook.growthos.ui.components.creatorProfileUrl
import com.fillbook.growthos.ui.components.openExternalUrl
import com.fillbook.growthos.ui.components.platformDisplayName
import com.fillbook.growthos.ui.components.platformIcon
import com.fillbook.growthos.ui.components.relativeTime
import com.fillbook.growthos.ui.components.relationshipStageLabel
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.Success
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreatorsScreen(repo: GrowthOsRepository) {
    var creators by remember { mutableStateOf<List<Creator>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            creators = repo.getCreators()
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load creators. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    val filteredCreators = remember(creators, query) {
        if (query.isBlank()) creators
        else creators.filter {
            it.handle.contains(query, ignoreCase = true) ||
                it.displayName?.contains(query, ignoreCase = true) == true ||
                it.notes?.contains(query, ignoreCase = true) == true
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Creators",
            "Relationship stage for every creator Fillbook has vetted, interacted with, or rejected.",
            kicker = if (loaded && creators.isNotEmpty()) "${creators.size} tracked" else null,
        )

        errorMessage?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
            }
        }

        if (!loaded) {
            SkeletonListLoading()
        } else if (errorMessage == null && creators.isEmpty()) {
            // Same nested-scroll fix as Prospecting/Inbound/VideoStatus/etc.
            // (2026-09-07): PullToRefreshBox only detects the pull gesture
            // through a scrollable descendant's nested-scroll connection --
            // a bare PolishedEmptyState never dispatched drag deltas to it.
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    item {
                        PolishedEmptyState(
                            icon = Icons.Filled.Groups,
                            headline = "No creators tracked yet",
                            subtitle = "Vetted, interacted, and rejected creators will show up here.",
                        )
                    }
                }
            }
        } else {
            SearchField(query, { query = it }, "Search creators", modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))

            val tierB = filteredCreators.filter { it.category == CreatorCategory.TIER_B }
                .sortedByDescending { it.readinessScore ?: -1 }
            val researchNext = filteredCreators.filter { it.category == CreatorCategory.RESEARCH_NEXT }
                .sortedByDescending { it.readinessScore ?: -1 }
            val rejected = filteredCreators.filter { it.category == CreatorCategory.REJECTED }

            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                if (filteredCreators.isEmpty()) {
                    // Same nested-scroll fix -- a bare PolishedEmptyState here
                    // would leave pull-to-refresh inert while a search narrows
                    // the list to zero, even though already inside PullToRefreshBox.
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        item {
                            PolishedEmptyState(
                                icon = Icons.Filled.Groups,
                                headline = "No matches",
                                subtitle = "No creators match \"$query\".",
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        if (tierB.isNotEmpty()) {
                            item { SectionHeader("Tier B -- active relationships (${tierB.size})") }
                            items(tierB) { creator -> CreatorCard(creator) }
                        }
                        if (researchNext.isNotEmpty()) {
                            item { SectionHeader("Research Next (${researchNext.size})") }
                            items(researchNext) { creator -> CreatorCard(creator) }
                        }
                        if (rejected.isNotEmpty()) {
                            item { SectionHeader("Rejected (${rejected.size})") }
                            items(rejected) { creator -> CreatorCard(creator) }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CreatorCard(creator: Creator) {
    val accentBar = when (creator.category) {
        CreatorCategory.TIER_B -> Success
        CreatorCategory.RESEARCH_NEXT -> Accent
        CreatorCategory.REJECTED -> Danger
    }
    GrowthCard(accentBar = accentBar) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            creator.readinessScore?.let { score ->
                ScoreBadge(score = score * 10, label = "$score/10", semanticLabel = "Creator readiness $score out of 10")
                Spacer(Modifier.width(12.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    creator.displayName?.let { "${creator.handle} -- $it" } ?: creator.handle,
                    style = MaterialTheme.typography.titleLarge,
                )
                if (creator.category != CreatorCategory.REJECTED) {
                    Spacer(Modifier.height(2.dp))
                    Text(relationshipStageLabel(creator.readinessScore), style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
                }
                Spacer(Modifier.height(6.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconPill(platformDisplayName(creator.platform), platformIcon(creator.platform), TextSecondary)
                    creator.followerCount?.let { count -> Pill(formatFollowers(count), TextSecondary) }
                    if (creator.category == CreatorCategory.REJECTED) {
                        StatusChip("rejected", StatusTone.BLOCKED)
                    }
                }
                relativeTime(creator.lastInteractionAt)?.let { time ->
                    Spacer(Modifier.height(4.dp))
                    Text("Last interaction: $time", style = MaterialTheme.typography.labelMedium, color = TextTertiary)
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
        creatorProfileUrl(creator.platform, creator.handle)?.let { url ->
            val context = LocalContext.current
            Spacer(Modifier.height(12.dp))
            SecondaryButton(
                text = "Open profile",
                // Was a bare startActivity(ACTION_VIEW) -- crashed with
                // ActivityNotFoundException on a device/profile with nothing
                // able to handle the intent (e.g. a work profile with no
                // browser). openExternalUrl (already used by every other
                // screen's own external links) fails safely instead.
                onClick = { openExternalUrl(context, url) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

private fun formatFollowers(count: Int): String = when {
    count >= 1000 -> "%.1fK".format(count / 1000.0)
    else -> count.toString()
}
