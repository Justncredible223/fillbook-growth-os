package com.fillbook.growthos.ui.screens

import org.junit.Test

/**
 * Regression guard for the same real, confirmed-with-a-real-finger bug fixed
 * on ProspectingScreen (2026-09-07), independently found here too by
 * inspection during a release-readiness audit: this screen's "Nothing
 * waiting on you" empty state used to sit entirely outside PullToRefreshBox,
 * so pull-to-refresh was inert on it. Fix: wrap the branch in PullToRefreshBox
 * with a LazyColumn -- a genuine nested-scroll participant -- instead of a
 * bare, non-scrollable PolishedEmptyState.
 *
 * Same structural-check rationale as ProspectingScreenEmptyStateStructureTest:
 * this project has no instrumentation-test infrastructure, so a true gesture
 * test isn't added here (see that class's kdoc for the full explanation).
 */
class ApprovalsScreenEmptyStateStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/ApprovalsScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/ApprovalsScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate ApprovalsScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the empty-state branch is inside PullToRefreshBox and wraps PolishedEmptyState in a LazyColumn`() {
        val source = screenSource()
        val emptyBranchIndex = source.indexOf("errorMessage == null && assets.isEmpty()")
        check(emptyBranchIndex >= 0) { "Could not find the empty-state condition in ApprovalsScreen.kt -- has this branch been restructured?" }

        val window = source.substring(emptyBranchIndex, minOf(emptyBranchIndex + 1200, source.length))
        // Matched WITH the opening paren so a mention of these names inside
        // this file's own explanatory prose comments can never be mistaken
        // for the real declaration.
        val pullToRefreshIndex = window.indexOf("PullToRefreshBox(")
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the empty-state condition." }
        check(pullToRefreshIndex in 0 until polishedEmptyStateIndex) {
            "The empty-state branch must be inside a PullToRefreshBox -- otherwise pull-to-refresh " +
                "is unreachable while the approvals queue is empty, confirmed by inspection (2026-09-07)."
        }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect."
        }
    }
}
