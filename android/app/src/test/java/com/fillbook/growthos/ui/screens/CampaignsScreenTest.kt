package com.fillbook.growthos.ui.screens

import org.junit.Test

/**
 * Regression guard for the same real, confirmed-with-a-real-finger bug fixed
 * on ProspectingScreen (2026-09-07), independently found here too by
 * inspection during a release-readiness audit: this screen has two distinct
 * empty states -- genuinely no campaigns run, and a search narrowed down to
 * zero -- and BOTH used a bare, non-scrollable PolishedEmptyState that never
 * dispatches drag deltas to PullToRefreshBox's nested-scroll connection. The
 * genuinely-empty case additionally sat entirely outside PullToRefreshBox.
 *
 * Same structural-check rationale as ProspectingScreenEmptyStateStructureTest:
 * this project has no instrumentation-test infrastructure, so a true gesture
 * test isn't added here (see that class's kdoc for the full explanation).
 */
class CampaignsScreenEmptyStateStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/CampaignsScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/CampaignsScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate CampaignsScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the genuinely-empty branch wraps PolishedEmptyState in PullToRefreshBox plus a LazyColumn`() {
        val source = screenSource()
        val emptyBranchIndex = source.indexOf("errorMessage == null && campaigns.isEmpty()")
        check(emptyBranchIndex >= 0) { "Could not find the genuinely-empty condition in CampaignsScreen.kt -- has this branch been restructured?" }

        val window = source.substring(emptyBranchIndex, minOf(emptyBranchIndex + 1200, source.length))
        val pullToRefreshIndex = window.indexOf("PullToRefreshBox(")
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the genuinely-empty condition." }
        check(pullToRefreshIndex in 0 until polishedEmptyStateIndex) {
            "The genuinely-empty branch must be inside a PullToRefreshBox -- otherwise pull-to-refresh " +
                "is unreachable while no campaigns have run, confirmed by inspection (2026-09-07)."
        }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect."
        }
    }

    @Test
    fun `the filtered-to-empty branch wraps PolishedEmptyState in a LazyColumn, not bare`() {
        val source = screenSource()
        val filteredEmptyBranchIndex = source.indexOf("filtered.isEmpty()")
        check(filteredEmptyBranchIndex >= 0) { "Could not find the filtered-empty condition in CampaignsScreen.kt -- has this branch been restructured?" }

        val window = source.substring(filteredEmptyBranchIndex, minOf(filteredEmptyBranchIndex + 1200, source.length))
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the filtered-empty condition." }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect, even when a " +
                "search narrows the list down to zero items -- confirmed by inspection (2026-09-07)."
        }
    }
}

/**
 * Regression guard for the process-recreation audit finding (2026-09-07):
 * the search query used plain `remember`, so it was silently lost on
 * rotation/process death.
 */
class CampaignsScreenStateRestorationStructureTest {
    private fun screenSource(): String {
        val file = java.io.File("src/main/java/com/fillbook/growthos/ui/screens/CampaignsScreen.kt")
            .let { if (it.exists()) it else java.io.File("app/src/main/java/com/fillbook/growthos/ui/screens/CampaignsScreen.kt") }
        check(file.exists()) { "Could not locate CampaignsScreen.kt from working directory ${java.io.File(".").absolutePath}." }
        return file.readText()
    }

    @Test
    fun `the search query survives process recreation via rememberSaveable, not plain remember`() {
        check(screenSource().contains("var query by rememberSaveable { mutableStateOf(\"\") }")) {
            "Expected CampaignsScreen's search query to use rememberSaveable, not remember -- otherwise a " +
                "typed search is silently lost on rotation/process death."
        }
    }
}
