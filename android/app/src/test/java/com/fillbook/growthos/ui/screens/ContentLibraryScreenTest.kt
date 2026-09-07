package com.fillbook.growthos.ui.screens

import org.junit.Test

/**
 * Regression guard for the same real, confirmed-with-a-real-finger bug fixed
 * on ProspectingScreen (2026-09-07), independently found here too by
 * inspection during a release-readiness audit: this screen's "No drafts
 * produced yet" empty state used to sit entirely outside PullToRefreshBox,
 * so pull-to-refresh was inert on it. Fix: wrap the branch in PullToRefreshBox
 * with a LazyColumn -- a genuine nested-scroll participant -- instead of a
 * bare, non-scrollable PolishedEmptyState.
 *
 * Same structural-check rationale as ProspectingScreenEmptyStateStructureTest:
 * this project has no instrumentation-test infrastructure, so a true gesture
 * test isn't added here (see that class's kdoc for the full explanation).
 */
class ContentLibraryScreenEmptyStateStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/ContentLibraryScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/ContentLibraryScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate ContentLibraryScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the empty-state branch is inside PullToRefreshBox and wraps PolishedEmptyState in a LazyColumn`() {
        val source = screenSource()
        val emptyBranchIndex = source.indexOf("errorMessage == null && allAssets.isEmpty()")
        check(emptyBranchIndex >= 0) { "Could not find the empty-state condition in ContentLibraryScreen.kt -- has this branch been restructured?" }

        val window = source.substring(emptyBranchIndex, minOf(emptyBranchIndex + 1200, source.length))
        val pullToRefreshIndex = window.indexOf("PullToRefreshBox(")
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the empty-state condition." }
        check(pullToRefreshIndex in 0 until polishedEmptyStateIndex) {
            "The empty-state branch must be inside a PullToRefreshBox -- otherwise pull-to-refresh " +
                "is unreachable while no drafts have been produced, confirmed by inspection (2026-09-07)."
        }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect."
        }
    }
}
