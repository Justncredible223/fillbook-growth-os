package com.fillbook.growthos.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression coverage for a chain of real, confirmed bugs found live, in
 * order:
 * 1. Opening an Inbound X item's plain tweet URL was first thought to land
 *    on X's generic composer, so the link was switched to X's reply-intent
 *    URL (x.com/intent/post?in_reply_to=<id>).
 * 2. twitter.com/intent/tweet was tried as a host swap and confirmed live
 *    to drop in_reply_to entirely (a standalone tweet, not a reply).
 * 3. Any `text` param made X's Android app reserve a blank first line, so
 *    `text` was dropped.
 * 4. Finally (7ffc834) x.com/intent/post itself was confirmed to be ignored
 *    by the X native Android app: it intercepts x.com links, opens a
 *    generic compose view and posts to the main feed as a standalone
 *    tweet. The link now opens the original tweet URL unchanged; the
 *    owner taps Reply inside X's own thread view (one extra tap), which is
 *    always correctly threaded, and pastes the drafted reply from the
 *    clipboard.
 *
 * So the contract is: return the source tweet URL as-is, never an intent
 * URL and never a `text` param. Do not reintroduce a compose-intent URL
 * without live, on-account re-verification via the Replies tab.
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
    fun `opens the original tweet URL so X shows the thread and Reply is threaded`() {
        val tweet = "https://x.com/someTrader/status/1948273645102938475"
        assertEquals(tweet, InboundReplyLink.buildInboundReplyUrl("x", tweet))
    }

    @Test
    fun `never appends a text param -- the reserved-blank-line bug this fixes`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501")
        assertEquals("https://x.com/someTrader/status/501", url)
        assertEquals(false, url!!.contains("text="))
    }

    @Test
    fun `an uppercase platform value returns the same tweet URL`() {
        val url = InboundReplyLink.buildInboundReplyUrl("X", "https://x.com/someTrader/status/501")
        assertEquals("https://x.com/someTrader/status/501", url)
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
     * Regression coverage for the real incidents above: every compose-intent
     * URL tried (twitter.com/intent/tweet, then x.com/intent/post) failed to
     * thread the reply on the X Android app. The link must never be an
     * intent URL again -- only the original tweet.
     */
    @Test
    fun `never builds a compose-intent URL -- both intent endpoints were confirmed to post standalone tweets`() {
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501")
        assertEquals("https://x.com/someTrader/status/501", url)
        assertEquals(false, url!!.contains("/intent/"))
        assertEquals(false, url.contains("in_reply_to"))
    }

    @Test
    fun `never varies by platform -- no authorHandle or draftReply parameter exists to accidentally reintroduce a text param`() {
        // buildInboundReplyUrl takes exactly (platform, sourceReference) --
        // if this signature ever grows a third parameter again, it's worth
        // re-reading this class's own kdoc first.
        val url = InboundReplyLink.buildInboundReplyUrl("x", "https://x.com/someTrader/status/501")
        assertEquals("https://x.com/someTrader/status/501", url)
    }
}
