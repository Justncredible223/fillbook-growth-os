package com.fillbook.growthos.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InboundFilterTest {
    @Test
    fun `a filter whose status still has items is kept`() {
        assertEquals("follow_up", InboundFilter.reconcile("follow_up", listOf("needs_response", "follow_up")))
    }

    @Test
    fun `a filter whose status vanished after the item resolved falls back to All`() {
        // The owner filtered to "Follow up", marked the only follow-up
        // responded, and the refresh dropped that status from the queue.
        assertNull(InboundFilter.reconcile("follow_up", listOf("needs_response", "draft_ready")))
    }

    @Test
    fun `an empty queue clears any filter`() {
        assertNull(InboundFilter.reconcile("needs_response", emptyList()))
    }

    @Test
    fun `All stays All`() {
        assertNull(InboundFilter.reconcile(null, listOf("needs_response")))
    }
}
