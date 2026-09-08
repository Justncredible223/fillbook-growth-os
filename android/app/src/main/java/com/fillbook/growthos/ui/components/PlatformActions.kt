package com.fillbook.growthos.ui.components

/**
 * The exact wording of the "Copy + Open" affordance, computed from the
 * item's real platform so it never names the wrong app. Pure functions
 * (no Compose, no Android) so they are unit-testable on the JVM; the
 * screens only render what these return.
 *
 * None of this changes the human-only posting boundary: the most any of
 * these actions does is put text on the clipboard and open the platform
 * app. Nothing here, or anywhere in this app, posts on the owner's behalf.
 */
object PlatformActions {
    /** Primary-button label for an item that has a draft and an open-able link. */
    fun copyAndOpenLabel(platform: String, hasLink: Boolean): String =
        if (hasLink) "Copy + Open ${platformDisplayName(platform)}" else "Copy reply"

    /** Secondary-button label for a resolved item the owner may still want to revisit. */
    fun openLabel(platform: String): String = "Open on ${platformDisplayName(platform)}"

    /**
     * Snackbar confirmation after a Copy + Open tap. `opened` is whether
     * the platform actually launched -- a failed launch is reported as
     * such, never as "Opened."
     */
    fun copyAndOpenMessage(platform: String, copied: Boolean, hadLink: Boolean, opened: Boolean): String? {
        val name = platformDisplayName(platform)
        return when {
            hadLink && !opened && copied -> "Copied, but no app could open $name"
            hadLink && !opened -> "No app could open $name"
            copied && opened -> "Copied — paste in $name"
            copied -> "Copied"
            opened -> "Opened in $name"
            else -> null
        }
    }
}
