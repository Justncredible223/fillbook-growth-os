package com.fillbook.growthos.ui.screens

import com.fillbook.growthos.ui.components.StatusTone
import org.junit.Assert.assertEquals
import org.junit.Test

class VideoStatusScreenTest {
    @Test
    fun `maps every real render status to the right visual tone`() {
        assertEquals(StatusTone.WAITING, statusTone("queued"))
        assertEquals(StatusTone.WAITING, statusTone("rendering"))
        assertEquals(StatusTone.READY, statusTone("ready"))
        assertEquals(StatusTone.FAILED, statusTone("failed"))
        assertEquals(StatusTone.SKIPPED, statusTone("canceled"))
    }

    @Test
    fun `falls back to a neutral tone for an unrecognized future status rather than crashing`() {
        assertEquals(StatusTone.NEUTRAL, statusTone("some_future_status"))
    }

    @Test
    fun `every real status gets a real, human-readable label`() {
        assertEquals("Queued", statusLabel("queued"))
        assertEquals("Rendering", statusLabel("rendering"))
        assertEquals("Ready", statusLabel("ready"))
        assertEquals("Failed", statusLabel("failed"))
        assertEquals("Canceled", statusLabel("canceled"))
    }

    @Test
    fun `capitalizes an unrecognized future status rather than showing a raw db value`() {
        assertEquals("Some_future_status", statusLabel("some_future_status"))
    }
}
