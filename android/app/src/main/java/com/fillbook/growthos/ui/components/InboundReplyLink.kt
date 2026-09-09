package com.fillbook.growthos.ui.components


/**
 * Builds the correct "reply in context" link for an Inbound X engagement.
 *
 * The flow: copy draft to clipboard → open the original tweet URL → user
 * taps Reply inside X → paste → post. Opening the tweet's own URL in the
 * X native Android app shows the tweet in its thread; tapping Reply from
 * there is always correctly threaded. This is one extra tap vs a compose
 * intent, but it is reliable.
 *
 * x.com/intent/post?in_reply_to=<id> was tried previously and failed:
 * the X native Android app intercepts x.com links but does NOT honour the
 * in_reply_to query param -- it opens a generic compose view, and any
 * post from there goes to the main feed as a standalone tweet (the
 * exact bug this object exists to prevent).
 *
 * Only ever used from InboundScreen's own copyAndOpen.
 * Pure, no Android imports, same testability convention as PlatformActions.kt.
 */
object InboundReplyLink {
    private val STATUS_ID_PATTERN = Regex("""/status/(\d+)""")

    /** Extracts the numeric tweet ID from a real x.com status URL -- null if it doesn't match that shape. */
    fun extractTweetId(sourceReference: String): String? =
        STATUS_ID_PATTERN.find(sourceReference)?.groupValues?.get(1)

    /**
     * Returns the URL to open for one Inbound engagement. For X items,
     * returns the original tweet URL so X opens the thread and the user
     * taps Reply in context. Falls back to [sourceReference] unchanged
     * for any other platform or a null reference.
     */
    fun buildInboundReplyUrl(platform: String, sourceReference: String?): String? {
        if (sourceReference == null) return null
        return sourceReference
    }
}
