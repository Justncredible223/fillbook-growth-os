package com.fillbook.growthos.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlatformActionsTest {
    @Test
    fun `reddit items open Reddit and confirm in Reddit terms`() {
        assertEquals("Copy + Open Reddit", PlatformActions.copyAndOpenLabel("reddit", hasLink = true))
        assertEquals("Open on Reddit", PlatformActions.openLabel("reddit"))
        assertEquals("Copied — paste in Reddit", PlatformActions.copyAndOpenMessage("reddit", copied = true, hadLink = true, opened = true))
        assertEquals("Opened in Reddit", PlatformActions.copyAndOpenMessage("reddit", copied = false, hadLink = true, opened = true))
    }

    @Test
    fun `x items keep their X wording`() {
        assertEquals("Copy + Open X", PlatformActions.copyAndOpenLabel("x", hasLink = true))
        assertEquals("Open on X", PlatformActions.openLabel("x"))
        assertEquals("Copied — paste in X", PlatformActions.copyAndOpenMessage("x", copied = true, hadLink = true, opened = true))
    }

    @Test
    fun `platform lookup is case-insensitive`() {
        assertEquals("Copy + Open Reddit", PlatformActions.copyAndOpenLabel("Reddit", hasLink = true))
        assertEquals("Copied — paste in X", PlatformActions.copyAndOpenMessage("X", copied = true, hadLink = true, opened = true))
    }

    @Test
    fun `a failed launch is reported instead of claiming the app opened`() {
        assertEquals("Copied, but no app could open Reddit", PlatformActions.copyAndOpenMessage("reddit", copied = true, hadLink = true, opened = false))
        assertEquals("No app could open X", PlatformActions.copyAndOpenMessage("x", copied = false, hadLink = true, opened = false))
    }

    @Test
    fun `an item with no link only copies`() {
        assertEquals("Copy reply", PlatformActions.copyAndOpenLabel("reddit", hasLink = false))
        assertEquals("Copied", PlatformActions.copyAndOpenMessage("reddit", copied = true, hadLink = false, opened = false))
        assertNull(PlatformActions.copyAndOpenMessage("x", copied = false, hadLink = false, opened = false))
    }
}
