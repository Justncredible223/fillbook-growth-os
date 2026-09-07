package com.fillbook.growthos.ui.screens

import com.fillbook.growthos.ui.components.StatusTone
import org.junit.Assert.assertEquals
import org.junit.Test

class VideoStatusScreenTest {
    @Test
    fun `maps every real render status to the right visual tone`() {
        assertEquals(StatusTone.WAITING, statusTone("queued"))
        assertEquals(StatusTone.WAITING, statusTone("rendering"))
        assertEquals(StatusTone.READY, statusTone("ready"))
        assertEquals(StatusTone.FAILED, statusTone("failed"))
        assertEquals(StatusTone.SKIPPED, statusTone("canceled"))
    }

    @Test
    fun `falls back to a neutral tone for an unrecognized future status rather than crashing`() {
        assertEquals(StatusTone.NEUTRAL, statusTone("some_future_status"))
    }

    @Test
    fun `every real status gets a real, human-readable label`() {
        assertEquals("Queued", statusLabel("queued"))
        assertEquals("Rendering", statusLabel("rendering"))
        assertEquals("Ready", statusLabel("ready"))
        assertEquals("Failed", statusLabel("failed"))
        assertEquals("Canceled", statusLabel("canceled"))
    }

    @Test
    fun `capitalizes an unrecognized future status rather than showing a raw db value`() {
        assertEquals("Some_future_status", statusLabel("some_future_status"))
    }
}

/**
 * Regression guard for the same real, confirmed-with-a-real-finger bug fixed
 * on ProspectingScreen (2026-09-07), independently found here too by
 * inspection: this screen's "No videos yet" empty state used to sit entirely
 * outside PullToRefreshBox, so pull-to-refresh was inert on it. Fix: wrap the
 * whole branch (empty and populated) in a single PullToRefreshBox, with the
 * empty state rendered inside a LazyColumn -- a genuine nested-scroll
 * participant -- instead of a bare, non-scrollable PolishedEmptyState.
 *
 * Same structural-check rationale as ProspectingScreenEmptyStateStructureTest:
 * this project has no instrumentation-test infrastructure, so a true gesture
 * test isn't added here (see that class's kdoc for the full explanation).
 */
class VideoStatusScreenEmptyStateStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/VideoStatusScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/VideoStatusScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate VideoStatusScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the empty-state branch is inside PullToRefreshBox and wraps PolishedEmptyState in a LazyColumn`() {
        val source = screenSource()

        val pullToRefreshIndex = source.indexOf("PullToRefreshBox(")
        val emptyBranchIndex = source.indexOf("errorMessage == null && renders.isEmpty()")
        check(pullToRefreshIndex >= 0) { "Could not find PullToRefreshBox in VideoStatusScreen.kt -- has this screen been restructured?" }
        check(emptyBranchIndex >= 0) { "Could not find the empty-state condition in VideoStatusScreen.kt -- has this branch been restructured?" }
        check(pullToRefreshIndex < emptyBranchIndex) {
            "The empty-state condition must be evaluated INSIDE PullToRefreshBox, not before/outside it -- " +
                "otherwise pull-to-refresh is unreachable while the render list is empty, confirmed by inspection (2026-09-07)."
        }

        val window = source.substring(emptyBranchIndex, minOf(emptyBranchIndex + 400, source.length))
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the empty-state condition." }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect."
        }
    }
}
