package com.fillbook.growthos.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression coverage for three real, confirmed bugs found live, in
 * order:
 * 1. Opening an Inbound X item's plain tweet URL landed on X's generic
 *    composer, which never pre-fills "Replying to @..." -- risking the
 *    owner's reply posting as a brand-new standalone tweet instead of an
 *    actual reply. Fixed by X's reply-intent URL (in_reply_to), built
 *    from the exact tweet ID.
 * 2. Switching the reply-intent host to twitter.com/intent/tweet (tried
 *    to fix bug 3 below) was confirmed live, via the account's own
 *    Chrome session, to silently drop in_reply_to entirely -- the post
 *    had no "Replying to @handle" context and never appeared on the
 *    account's Replies tab. MUST stay on x.com/intent/post permanently.
 * 3. Supplying a `text` param at all (regardless of host) made X's
 *    Android app reserve a blank first editable line above it, pushing
 *    any pre-filled text to row 2 -- unlike a genuine manual reply
 *    (tapping Reply inside X's own UI), which starts at row 1. Fixed by
 *    dropping `text` entirely: the URL now only ever carries
 *    in_reply_to. No mention is auto-inserted anywhere (URL or
 *    clipboard) -- a deliberate choice, not a gap: the owner pastes/
 *    types at row 1 themselves from the drafted reply Inbound already
 *    shows, same as a genuine manual reply would require anyway.
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
    fun `builds the reply-intent URL from the exact tweet ID, URL-encoding it`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/1948273645102938475")
        assertEquals("https://x.com/intent/post?in_reply_to=1948273645102938475", url)
    }

    @Test
    fun `never appends a text param -- the reserved-blank-line bug this fixes`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501")
        assertEquals("https://x.com/intent/post?in_reply_to=501", url)
        assertEquals(false, url!!.contains("text="))
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
     * Regression coverage for a real incident: x.com/intent/post reserves
     * an extra blank editable line above pre-filled text, purely cosmetic.
     * Switching to twitter.com/intent/tweet (same in_reply_to/text params)
     * was tried live to remove that line, but verified via the account's
     * own Chrome session that it silently drops in_reply_to entirely: the
     * resulting post had no "Replying to @handle" context, never appeared
     * on the account's Replies tab, and was a brand-new standalone tweet
     * merely mentioning the person -- a real, incorrectly-posted tweet on
     * the live account, not a cosmetic issue. MUST stay on
     * x.com/intent/post permanently -- do not swap this again without
     * live, on-account re-verification via the Replies tab specifically
     * (the composer's own visual state looked identical either way).
     */
    @Test
    fun `stays on x-com's intent-post endpoint -- twitter-com's intent-tweet was confirmed to drop in_reply_to entirely`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501")
        assertEquals("https://x.com/intent/post?in_reply_to=501", url)
    }

    @Test
    fun `never varies by platform beyond the x-vs-not-x check -- no authorHandle or draftReply parameter exists to accidentally reintroduce a text param`() {
        // buildInboundReplyUrl takes exactly (platform, sourceReference) --
        // if this signature ever grows a third parameter again, it's worth
        // re-reading this class's own kdoc first.
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501")
        assertEquals("https://x.com/intent/post?in_reply_to=501", url)
    }
}
