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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fillbook.growthos.data.AppNotification
import com.fillbook.growthos.data.GrowthOsRepository
import com.fillbook.growthos.ui.components.GrowthCard
import com.fillbook.growthos.ui.components.LoadingIndicator
import com.fillbook.growthos.ui.components.Pill
import com.fillbook.growthos.ui.components.PolishedEmptyState
import com.fillbook.growthos.ui.components.ScreenHeader
import com.fillbook.growthos.ui.components.relativeTime
import com.fillbook.growthos.ui.theme.Accent
import com.fillbook.growthos.ui.theme.Danger
import com.fillbook.growthos.ui.theme.TextSecondary
import com.fillbook.growthos.ui.theme.TextTertiary
import com.fillbook.growthos.ui.theme.Warning
import kotlinx.coroutines.launch

/** Sentinel busy key for the whole-list "Mark all read" action, distinct from any real notification id. */
private const val MARK_ALL_BUSY_KEY = "__mark_all_read__"

/**
 * Real, meaningful-events-only feed (see
 * backend/src/notifications/notificationEngine.ts's "avoid spam"
 * discipline) -- an empty list here means nothing worth interrupting the
 * owner about happened, not a broken feature. In-app only, not OS-level
 * push: that needs a Firebase project the owner would have to set up,
 * not attempted without that owner action.
 *
 * Mark-read and mark-all-read run through one error-aware helper: a
 * failure shows a dismissable message instead of leaving the row unread
 * with no explanation (or crashing the screen), and the tapped control
 * is disabled while the request is in flight.
 */
@Composable
fun NotificationsScreen(repo: GrowthOsRepository) {
    var notifications by remember { mutableStateOf<List<AppNotification>>(emptyList()) }
    var unreadCount by remember { mutableIntStateOf(0) }
    var loaded by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var busyKey by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        try {
            val (items, unread) = repo.getNotifications()
            notifications = items
            unreadCount = unread
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't load notifications. Check your connection and try again."
        }
        loaded = true
    }

    LaunchedEffect(Unit) { refresh() }

    fun runAction(key: String, failureMessage: String, action: suspend () -> Unit) {
        scope.launch {
            busyKey = key
            try {
                action()
                actionError = null
                refresh()
            } catch (e: Exception) {
                actionError = failureMessage
            } finally {
                busyKey = null
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenHeader(
            "Notifications",
            "Only meaningful events -- a high-value opportunity, a platform failure, a fresh strategy read.",
            kicker = if (unreadCount > 0) "$unreadCount unread" else null,
        )

        (errorMessage ?: actionError)?.let { message ->
            Row(modifier = Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(message, style = MaterialTheme.typography.bodyMedium, color = Danger, modifier = Modifier.weight(1f))
                if (errorMessage != null) {
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                } else {
                    TextButton(onClick = { actionError = null }) { Text("Dismiss") }
                }
            }
        }

        if (unreadCount > 0) {
            TextButton(
                onClick = { runAction(MARK_ALL_BUSY_KEY, "Couldn't mark everything read. Check your connection and try again.") { repo.markAllNotificationsRead() } },
                enabled = busyKey == null,
                modifier = Modifier.padding(horizontal = 12.dp),
            ) { Text(if (busyKey == MARK_ALL_BUSY_KEY) "Marking..." else "Mark all read") }
        }

        if (!loaded) {
            LoadingIndicator()
        } else if (notifications.isEmpty()) {
            PolishedEmptyState(
                icon = Icons.Filled.NotificationsNone,
                headline = "Nothing to report",
                subtitle = "You'll hear from Growth OS only when something's actually worth your attention.",
            )
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(notifications, key = { it.id }) { notification ->
                    NotificationCard(
                        notification = notification,
                        busy = busyKey == notification.id || busyKey == MARK_ALL_BUSY_KEY,
                        onMarkRead = { runAction(notification.id, "Couldn't mark that read. Check your connection and try again.") { repo.markNotificationRead(notification.id) } },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NotificationCard(notification: AppNotification, busy: Boolean, onMarkRead: () -> Unit) {
    val isUnread = notification.readAt == null
    GrowthCard(accentBar = if (isUnread) severityColor(notification.severity) else null) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Pill(notification.severity, severityColor(notification.severity))
            relativeTime(notification.createdAt)?.let { Pill(it, TextTertiary) }
        }
        Spacer(Modifier.height(8.dp))
        Text(notification.title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(notification.body, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        if (isUnread) {
            Spacer(Modifier.height(10.dp))
            TextButton(onClick = onMarkRead, enabled = !busy) { Text(if (busy) "Marking..." else "Mark read") }
        }
    }
}

private fun severityColor(severity: String) = when (severity) {
    "urgent" -> Danger
    "warning" -> Warning
    else -> Accent
}
