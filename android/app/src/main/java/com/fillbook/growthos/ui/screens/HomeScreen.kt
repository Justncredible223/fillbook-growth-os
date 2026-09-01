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
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.data.HealthItem
import com.fillbook.growthos.data.HomeSummary
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.healthColor
import com.fillbook.growthos.ui.components.healthLabel
import com.fillbook.growthos.ui.theme.Surface
import com.fillbook.growthos.ui.theme.TextSecondary

@Composable
fun HomeScreen(repo: GrowthOsRepository) {
    var summary by remember { mutableStateOf<HomeSummary?>(null) }
    var health by remember { mutableStateOf<List<HealthItem>>(emptyList()) }

    LaunchedEffect(Unit) {
        summary = repo.getHomeSummary()
        health = repo.getHealth()
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Column {
                Text("Fillbook Growth OS", style = MaterialTheme.typography.headlineLarge)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Mission Control",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                )
            }
        }

        item {
            summary?.let { s ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    StatCard("Opportunities", s.opportunitiesFound.toString(), Modifier.weight(1f))
                    StatCard("Ready to review", s.pendingReview.toString(), Modifier.weight(1f))
                }
            }
        }

        item {
            SectionLabel("System health")
        }

        items(health) { item -> HealthRow(item) }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(16.dp),
    ) {
        Text(value, style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(2.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = TextSecondary,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun HealthRow(item: HealthItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Surface)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(item.label, style = MaterialTheme.typography.titleMedium)
            Text(item.detail, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        }
        Pill(healthLabel(item.status), healthColor(item.status))
    }
}
