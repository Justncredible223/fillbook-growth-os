package com.fillbook.growthos.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression coverage for a real gap found live: the app has no way to
 * confirm X's own Post action actually succeeded (X can silently drop a
 * post, especially for a newer/low-follower account, with nothing
 * surfaced back to us), so an owner could tap "Mark responded" on a
 * reply that never actually reached X. This reminder is the mitigation
 * -- copy-only, never changes any status itself.
 */
class InboundReplyReminderTest {
    @Test
    fun `shows the exact reminder text when X actually opened`() {
        assertEquals(
            "Fillbook copied the reply and opened X. Tap Reply, paste if needed, press Post, then verify the reply appears before marking responded.",
            InboundReplyReminder.message(opened = true),
        )
    }

    @Test
    fun `returns null when nothing opened -- PlatformActions' own failure message stays authoritative`() {
        assertNull(InboundReplyReminder.message(opened = false))
    }
}
