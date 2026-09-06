package com.fillbook.growthos.ui.components

import java.net.URLEncoder

/**
 * Builds the correct "reply in context" link for an Inbound X engagement.
 * Opening a tweet's own plain URL lands on X's generic composer, which
 * does NOT pre-fill "Replying to @..." -- risking the owner's reply
 * posting as a brand-new standalone post instead of a real reply. X's
 * reply-intent URL (https://x.com/intent/post?in_reply_to=<tweet_id>)
 * opens the real in-context reply composer instead.
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
     */
    fun buildInboundReplyUrl(platform: String, sourceReference: String?): String? {
        if (sourceReference == null) return null
        if (platform.lowercase() != "x") return sourceReference
        val tweetId = extractTweetId(sourceReference) ?: return sourceReference
        val encodedId = URLEncoder.encode(tweetId, "UTF-8")
        return "https://x.com/intent/post?in_reply_to=$encodedId"
    }
}
