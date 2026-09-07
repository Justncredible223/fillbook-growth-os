package com.fillbook.growthos.ui.components

import java.net.URLEncoder

/**
 * Builds the correct "reply in context" link for an Inbound X engagement.
 *
 * Opening a tweet's own plain URL lands on X's generic composer, which
 * does NOT pre-fill "Replying to @..." -- risking the owner's reply
 * posting as a brand-new standalone post instead of a real reply. X's
 * reply-intent URL (https://x.com/intent/post?in_reply_to=<tweet_id>)
 * opens the real in-context reply composer instead.
 *
 * Deliberately does NOT also pass a `text` param -- a real, confirmed
 * usability bug found live: X's Android app renders any `text` supplied
 * to a reply-intent starting on a SECOND line, with the cursor landing on
 * a reserved blank first line above it (as if for the owner's own added
 * comment on top of "quoted" content) -- unlike a genuine manual reply
 * (tapping Reply inside X's own UI), which starts the owner at row 1.
 * This happens purely because a `text` param is present at all,
 * regardless of which reply-intent host receives it (already confirmed
 * against x.com/intent/post; twitter.com/intent/tweet was separately
 * tried and ruled out for an unrelated, worse reason -- see the
 * regression test below). Dropping `text` entirely means the composer
 * opens exactly like a genuine manual reply: correctly threaded
 * (in_reply_to is untouched), cursor at row 1. This is a deliberate
 * choice, not a gap: no mention is auto-inserted anywhere (URL or
 * clipboard) -- the owner copies the drafted reply from InboundScreen
 * and pastes/types whatever they want at row 1 themselves, same as a
 * genuine manual reply would require anyway.
 *
 * Only ever used from InboundScreen's own copyAndOpen -- Prospecting
 * (ProspectingScreen.kt) and Today's X Post keep opening their own
 * postUrl/preview links completely unchanged; this never touches those.
 * Pure, no Android imports, same testability convention as
 * PlatformActions.kt.
 */
object InboundReplyLink {
    private val STATUS_ID_PATTERN = Regex("""/status/(\d+)""")

    /** Extracts the numeric tweet ID from a real x.com status URL -- null if it doesn't match that shape at all (unexpected format). */
    fun extractTweetId(sourceReference: String): String? =
        STATUS_ID_PATTERN.find(sourceReference)?.groupValues?.get(1)

    /**
     * The URL to actually open for one Inbound engagement. For a real X
     * item whose [sourceReference] is a recognizable tweet-status URL,
     * returns X's reply-intent URL built from that EXACT tweet ID
     * (URL-encoded, though a numeric ID never actually needs escaping --
     * done anyway so this stays correct if that ever changes). Falls back
     * to the original [sourceReference] unchanged for any other platform,
     * an unrecognized URL shape, or a null reference -- never silently
     * drops a real link the owner could still open.
     *
     * MUST stay on x.com/intent/post, and MUST NOT gain a `text` param
     * again without live, on-account re-verification -- see this
     * object's own kdoc above for why both matter, and
     * InboundReplyLinkTest's regression tests for the two separate real
     * incidents (broken threading, then the reserved-blank-line bug)
     * that make this history worth re-reading before changing either.
     */
    fun buildInboundReplyUrl(platform: String, sourceReference: String?): String? {
        if (sourceReference == null) return null
        if (platform.lowercase() != "x") return sourceReference
        val tweetId = extractTweetId(sourceReference) ?: return sourceReference
        val encodedId = URLEncoder.encode(tweetId, "UTF-8")
        return "https://x.com/intent/post?in_reply_to=$encodedId"
    }
}
