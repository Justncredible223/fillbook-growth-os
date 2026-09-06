package com.fillbook.growthos.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression coverage for a real bug: opening an Inbound X item's plain
 * tweet URL landed on X's generic composer, which never pre-fills
 * "Replying to @..." -- risking the owner's reply posting as a brand-new
 * standalone tweet instead of an actual reply. See InboundReplyLink's own
 * kdoc for the fix (X's reply-intent URL, built from the exact tweet ID).
 */
class InboundReplyLinkTest {
    @Test
    fun `extracts the exact numeric tweet id from a real status URL`() {
        assertEquals("1948273645102938475", InboundReplyLink.extractTweetId("https://x.com/someTrader/status/1948273645102938475"))
    }

    @Test
    fun `extracts the tweet id even with trailing query params`() {
        assertEquals("501", InboundReplyLink.extractTweetId("https://x.com/i/web/status/501?s=20&t=abc"))
    }

    @Test
    fun `returns null when the URL has no status id at all`() {
        assertNull(InboundReplyLink.extractTweetId("https://x.com/someTrader"))
    }

    @Test
    fun `builds the exact reply-intent URL for a real X item, URL-encoding the id`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/1948273645102938475")
        assertEquals("https://x.com/intent/post?in_reply_to=1948273645102938475", url)
    }

    @Test
    fun `platform match is case-insensitive`() {
        val url = InboundReplyLink.buildInboundReplyUrl("X", "https://x.com/someTrader/status/501")
        assertEquals("https://x.com/intent/post?in_reply_to=501", url)
    }

    @Test
    fun `falls back to the original tweet URL when the shape is unrecognized`() {
        val original = "https://x.com/someTrader"
        assertEquals(original, InboundReplyLink.buildInboundReplyUrl("x", original))
    }

    @Test
    fun `falls back to the original reference unchanged for a non-X platform`() {
        val original = "https://youtube.com/watch?v=abc123"
        assertEquals(original, InboundReplyLink.buildInboundReplyUrl("youtube", original))
    }

    @Test
    fun `returns null when there is no source reference at all, never fabricating a link`() {
        assertNull(InboundReplyLink.buildInboundReplyUrl("x", null))
    }
}
