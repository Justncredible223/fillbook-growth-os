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
    fun `builds the reply-intent URL with no text param when no handle is known, URL-encoding the id`() {
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

    /**
     * Regression coverage for a second real bug, found on-device after the
     * first fix above shipped: the native X app's in_reply_to autofill does
     * NOT insert "@handle " as actual composer text (confirmed live), so
     * the owner saw a blank reply box with no @-mention at all. Fixed by
     * building that text ourselves via the intent's own `text` param.
     */
    @Test
    fun `appends just the @handle as a text param when only the author handle is known`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501", "DefiDelilah")
        assertEquals("https://x.com/intent/post?in_reply_to=501&text=%40DefiDelilah", url)
    }

    @Test
    fun `omits the text param when the author handle is blank and no draft reply is given`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501", "  ")
        assertEquals("https://x.com/intent/post?in_reply_to=501", url)
    }

    @Test
    fun `does not append a handle to the fallback URL for a non-X platform`() {
        val original = "https://youtube.com/watch?v=abc123"
        assertEquals(original, InboundReplyLink.buildInboundReplyUrl("youtube", original, "DefiDelilah"))
    }

    /**
     * Regression coverage for a third real bug, found live immediately
     * after the second fix above shipped: once the composer pre-filled
     * "@handle ", pasting the clipboard draft on top of it landed BEFORE
     * the mention, not after -- the composer's cursor sits at the start of
     * pre-filled text, not the end. Fixed by building the complete
     * "@handle <reply>" text ourselves, in the correct order, so there is
     * nothing left to paste into the wrong position for a plain reply.
     */
    @Test
    fun `puts the @handle mention BEFORE the drafted reply, in one pre-filled text param`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501", "DefiDelilah", "Happy to help!")
        assertEquals("https://x.com/intent/post?in_reply_to=501&text=%40DefiDelilah+Happy+to+help%21", url)
    }

    @Test
    fun `uses just the drafted reply when no author handle is known`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501", null, "Happy to help!")
        assertEquals("https://x.com/intent/post?in_reply_to=501&text=Happy+to+help%21", url)
    }

    @Test
    fun `trims the drafted reply and ignores a blank one`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501", "DefiDelilah", "   ")
        assertEquals("https://x.com/intent/post?in_reply_to=501&text=%40DefiDelilah", url)
    }
}
