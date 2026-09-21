package com.fillbook.growthos.ui.screens

import com.fillbook.growthos.data.VideoRenderOutcome
import com.fillbook.growthos.data.parseVideoRenderOutcome
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression guard for the silent daily render limit (2026-09-20): approving a video could succeed while the
 * server refused to queue the render, and the app said only "Approved" -- so the video looked like it "never
 * went to render". The message now says what actually happened.
 */
class ApprovalSnackbarMessageTest {
    @Test
    fun `a rejection just says rejected, whatever the outcome`() {
        assertEquals("Rejected", approvalSnackbarMessage(approve = false, outcome = null))
        assertEquals("Rejected", approvalSnackbarMessage(approve = false, outcome = VideoRenderOutcome(false, false, "x")))
    }

    @Test
    fun `approving a non-video says just approved`() {
        assertEquals("Approved", approvalSnackbarMessage(approve = true, outcome = null))
    }

    @Test
    fun `a queued video says it is queued and where to look`() {
        val message = approvalSnackbarMessage(true, VideoRenderOutcome(queued = true, alreadyExisted = false, reason = null))
        assertTrue(message, message.contains("queued for rendering"))
        assertTrue(message, message.contains("Video Status"))
    }

    @Test
    fun `a video that is already rendering says so instead of claiming a new queue`() {
        val message = approvalSnackbarMessage(true, VideoRenderOutcome(queued = true, alreadyExisted = true, reason = null))
        assertTrue(message, message.contains("already rendering"))
    }

    @Test
    fun `the daily limit is explained and promises an automatic render after the reset`() {
        val message = approvalSnackbarMessage(
            true,
            VideoRenderOutcome(queued = false, alreadyExisted = false, reason = "daily_render_cap_reached (1 renders today, cap is 1)"),
        )
        assertTrue(message, message.contains("not rendering yet"))
        assertTrue(message, message.contains("automatically"))
        assertTrue(message, message.contains("reset"))
    }

    @Test
    fun `the monthly limit is explained`() {
        val message = approvalSnackbarMessage(
            true,
            VideoRenderOutcome(queued = false, alreadyExisted = false, reason = "monthly_render_cap_reached (30 renders this month, cap is 30)"),
        )
        assertTrue(message, message.contains("this month"))
    }

    @Test
    fun `an unknown refusal shows the server's reason instead of hiding it`() {
        val message = approvalSnackbarMessage(true, VideoRenderOutcome(false, false, "storage_cap_reached"))
        assertTrue(message, message.contains("storage_cap_reached"))
        assertTrue(message, message.startsWith("Approved, but"))
    }

    @Test
    fun `a refusal with no reason still says the video was not queued`() {
        assertEquals("Approved, but the video was not queued.", approvalSnackbarMessage(true, VideoRenderOutcome(false, false, null)))
    }

    @Test
    fun `parses the server's videoRender block`() {
        val queued = parseVideoRenderOutcome(JSONObject("""{"status":"approved","videoRender":{"queued":true,"alreadyExisted":false,"reason":null}}"""))
        assertEquals(VideoRenderOutcome(queued = true, alreadyExisted = false, reason = null), queued)

        val capped = parseVideoRenderOutcome(
            JSONObject("""{"videoRender":{"queued":false,"alreadyExisted":false,"reason":"daily_render_cap_reached (1 renders today, cap is 1)"}}"""),
        )
        assertEquals(false, capped!!.queued)
        assertEquals("daily_render_cap_reached (1 renders today, cap is 1)", capped.reason)
    }

    @Test
    fun `no videoRender block means nothing to report`() {
        assertNull(parseVideoRenderOutcome(JSONObject("""{"campaignId":"c1","status":"approved"}""")))
    }
}
