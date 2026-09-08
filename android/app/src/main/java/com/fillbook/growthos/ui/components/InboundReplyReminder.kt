package com.fillbook.growthos.ui.components

/**
 * The reminder shown after Inbound's "Copy + Open X" successfully opens
 * X -- a real gap found live: the app has no way to know whether the
 * owner's Post tap on X actually succeeded (X's own Android app can
 * silently drop a post, especially for a newer/low-follower account,
 * with no error surfaced back to us), so an owner could tap "Mark
 * responded" on a reply that never actually reached X. This never
 * changes any status itself -- it's purely a reminder for the owner's
 * own next steps; "Mark responded" stays its own explicit, human action,
 * exactly as before.
 *
 * Only ever used from InboundScreen's own copyAndOpen -- Prospecting
 * (ProspectingScreen.kt) keeps using PlatformActions.copyAndOpenMessage
 * directly, completely unchanged. Pure, no Android imports, same
 * testability convention as InboundReplyLink.kt.
 */
object InboundReplyReminder {
    const val TEXT: String =
        "Fillbook copied the reply and opened X. Tap Reply, paste if needed, press Post, then verify the reply appears before marking responded."

    /**
     * The message to show after a Copy + Open tap -- the reminder when X
     * actually opened, or null when it didn't (so the caller falls back to
     * PlatformActions.copyAndOpenMessage's existing, still-accurate
     * failure wording, e.g. "No app could open X" -- that case must never
     * be replaced with a reminder implying X opened when it didn't).
     */
    fun message(opened: Boolean): String? = if (opened) TEXT else null
}
