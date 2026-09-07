package com.fillbook.growthos.ui.screens

import org.junit.Test

/**
 * Regression guard for the same real, confirmed-with-a-real-finger bug fixed
 * on ProspectingScreen (2026-09-07), independently found here too by
 * inspection: this screen has two distinct empty states -- a genuinely empty
 * queue, and a filter narrowed down to zero items -- and BOTH used a bare,
 * non-scrollable Column/PolishedEmptyState that never dispatches drag deltas
 * to PullToRefreshBox's nested-scroll connection. The genuinely-empty case
 * additionally sat entirely outside PullToRefreshBox.
 *
 * Fix: the genuinely-empty branch is now wrapped in its own PullToRefreshBox
 * with the empty state inside a LazyColumn; the filtered-to-empty branch
 * (already inside PullToRefreshBox) now also uses a LazyColumn instead of a
 * bare Column.
 *
 * Same structural-check rationale as ProspectingScreenEmptyStateStructureTest:
 * this project has no instrumentation-test infrastructure, so a true gesture
 * test isn't added here (see that class's kdoc for the full explanation).
 */
class InboundScreenEmptyStateStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/InboundScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/InboundScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate InboundScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the genuinely-empty branch wraps PolishedEmptyState in PullToRefreshBox plus a LazyColumn`() {
        val source = screenSource()
        val emptyBranchIndex = source.indexOf("errorMessage == null && items.isEmpty()")
        check(emptyBranchIndex >= 0) { "Could not find the genuinely-empty condition in InboundScreen.kt -- has this branch been restructured?" }

        // Bounded window right after the condition so this can't accidentally
        // match the populated/filtered branch's own PullToRefreshBox/LazyColumn further down.
        // (Wide enough to span the explanatory comment above the real code.)
        val window = source.substring(emptyBranchIndex, minOf(emptyBranchIndex + 1300, source.length))

        // Matched WITH the opening paren so a mention of these names inside
        // this file's own explanatory prose comments (which don't have the
        // call syntax) can never be mistaken for the real declaration.
        val pullToRefreshIndex = window.indexOf("PullToRefreshBox(")
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the genuinely-empty condition." }
        check(pullToRefreshIndex in 0 until polishedEmptyStateIndex) {
            "The genuinely-empty branch must be inside a PullToRefreshBox -- otherwise pull-to-refresh " +
                "is unreachable while the inbound queue is empty, confirmed by inspection (2026-09-07)."
        }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect -- a bare, " +
                "non-scrollable PolishedEmptyState makes the pull-to-refresh gesture silently inert."
        }
    }

    @Test
    fun `the filtered-to-empty branch wraps PolishedEmptyState in a LazyColumn, not a bare Column`() {
        val source = screenSource()
        val filteredEmptyBranchIndex = source.indexOf("filteredItems.isEmpty()")
        check(filteredEmptyBranchIndex >= 0) { "Could not find the filtered-empty condition in InboundScreen.kt -- has this branch been restructured?" }

        // Wide enough to span the explanatory comment above the real code.
        val window = source.substring(filteredEmptyBranchIndex, minOf(filteredEmptyBranchIndex + 1300, source.length))

        // Matched WITH the opening paren -- see the same note in the test above.
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the filtered-empty condition." }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect, even when a " +
                "status filter narrows the list down to zero items -- confirmed by inspection (2026-09-07)."
        }
    }
}
