package com.fillbook.growthos.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlatformActionsTest {
    @Test
    fun `youtube items open YouTube and confirm in YouTube terms`() {
        assertEquals("Copy + Open YouTube", PlatformActions.copyAndOpenLabel("youtube", hasLink = true))
        assertEquals("Open on YouTube", PlatformActions.openLabel("youtube"))
        assertEquals("Copied — paste in YouTube", PlatformActions.copyAndOpenMessage("youtube", copied = true, hadLink = true, opened = true))
        assertEquals("Opened in YouTube", PlatformActions.copyAndOpenMessage("youtube", copied = false, hadLink = true, opened = true))
    }

    @Test
    fun `x items keep their X wording`() {
        assertEquals("Copy + Open X", PlatformActions.copyAndOpenLabel("x", hasLink = true))
        assertEquals("Open on X", PlatformActions.openLabel("x"))
        assertEquals("Copied — paste in X", PlatformActions.copyAndOpenMessage("x", copied = true, hadLink = true, opened = true))
    }

    @Test
    fun `platform lookup is case-insensitive`() {
        assertEquals("Copy + Open YouTube", PlatformActions.copyAndOpenLabel("YouTube", hasLink = true))
        assertEquals("Copied — paste in X", PlatformActions.copyAndOpenMessage("X", copied = true, hadLink = true, opened = true))
    }

    @Test
    fun `a failed launch is reported instead of claiming the app opened`() {
        assertEquals("Copied, but no app could open YouTube", PlatformActions.copyAndOpenMessage("youtube", copied = true, hadLink = true, opened = false))
        assertEquals("No app could open X", PlatformActions.copyAndOpenMessage("x", copied = false, hadLink = true, opened = false))
    }

    @Test
    fun `an item with no link only copies`() {
        assertEquals("Copy reply", PlatformActions.copyAndOpenLabel("youtube", hasLink = false))
        assertEquals("Copied", PlatformActions.copyAndOpenMessage("youtube", copied = true, hadLink = false, opened = false))
        assertNull(PlatformActions.copyAndOpenMessage("x", copied = false, hadLink = false, opened = false))
    }
}
