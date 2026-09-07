package com.fillbook.growthos.ui.screens

import com.fillbook.growthos.data.ProspectingDiagnostics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

private fun diagnostics(
    totalConsidered: Int,
    selected: Int = 0,
    deferred: Int = 0,
    belowQualityBar: Int = 0,
    tooOldForToday: Int = 0,
) = ProspectingDiagnostics(
    totalConsidered = totalConsidered,
    selected = selected,
    deferred = deferred,
    belowQualityBar = belowQualityBar,
    tooOldForToday = tooOldForToday,
)

/**
 * Regression/behavior coverage for the 2026-09-07 empty-state follow-up:
 * the Prospecting queue's empty state used to say the same generic thing
 * ("New opportunities are found once a day...") whether discovery had
 * genuinely found nothing, or a real backlog existed but was entirely
 * excluded as stale/low-quality -- indistinguishable to the owner. These
 * tests exercise every diagnostic combination the real API can return.
 */
class ProspectingScreenTest {
    @Test
    fun `falls back to the original generic copy when diagnostics is null -- an API response that predates the field`() {
        assertEquals(
            "New opportunities are found once a day. Check back soon, or pull to refresh.",
            prospectingEmptyStateMessage(null),
        )
    }

    @Test
    fun `reports a genuinely empty backlog distinctly from an excluded one`() {
        val message = prospectingEmptyStateMessage(diagnostics(totalConsidered = 0))
        assertEquals("No new candidates were found. Discovery will try again on its next scheduled run.", message)
    }

    @Test
    fun `explains a too-old-only exclusion using owner-friendly wording, plural`() {
        val message = prospectingEmptyStateMessage(diagnostics(totalConsidered = 23, tooOldForToday = 23))
        assertEquals("23 posts were too old for today's active reply window. Check back soon, or pull to refresh.", message)
    }

    @Test
    fun `explains a single too-old exclusion with correct singular grammar`() {
        val message = prospectingEmptyStateMessage(diagnostics(totalConsidered = 1, tooOldForToday = 1))
        assertEquals("1 post was too old for today's active reply window. Check back soon, or pull to refresh.", message)
    }

    @Test
    fun `explains a below-quality-bar-only exclusion using owner-friendly wording, plural`() {
        val message = prospectingEmptyStateMessage(diagnostics(totalConsidered = 6, belowQualityBar = 6))
        assertEquals("6 candidates didn't meet today's quality bar. Check back soon, or pull to refresh.", message)
    }

    @Test
    fun `explains a single below-quality-bar exclusion with correct singular grammar`() {
        val message = prospectingEmptyStateMessage(diagnostics(totalConsidered = 1, belowQualityBar = 1))
        assertEquals("1 candidate didn't meet today's quality bar. Check back soon, or pull to refresh.", message)
    }

    @Test
    fun `combines both reasons honestly when both apply -- a real production case had 23 too-old and 6 below the bar at once`() {
        val message = prospectingEmptyStateMessage(diagnostics(totalConsidered = 29, tooOldForToday = 23, belowQualityBar = 6))
        assertEquals(
            "23 posts were too old for today's active reply window, and 6 candidates didn't meet today's quality bar. Check back soon, or pull to refresh.",
            message,
        )
    }

    @Test
    fun `never mentions internal field names like tooOldForToday or belowQualityBar`() {
        val message = prospectingEmptyStateMessage(diagnostics(totalConsidered = 29, tooOldForToday = 23, belowQualityBar = 6))
        assertFalse(message.contains("tooOldForToday"))
        assertFalse(message.contains("belowQualityBar"))
        assertFalse(message.contains("Considered"))
    }

    @Test
    fun `falls back to the generic message if diagnostics are present but neither known exclusion reason explains the empty queue`() {
        // A hypothetical future/edge shape (e.g. all deferred, none too-old or below-bar) --
        // should never leave the owner with a blank or nonsensical explanation.
        val message = prospectingEmptyStateMessage(diagnostics(totalConsidered = 5, deferred = 5))
        assertEquals("New opportunities are found once a day. Check back soon, or pull to refresh.", message)
    }
}
