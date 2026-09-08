package com.fillbook.growthos.ui.screens

import org.junit.Test

/**
 * Regression guard for the same real, confirmed-with-a-real-finger bug fixed
 * on ProspectingScreen (2026-09-07), independently found here too by
 * inspection during a release-readiness audit: this screen has two distinct
 * empty states -- a genuinely empty Radar, and a filter/search narrowed down
 * to zero items -- and BOTH used a bare, non-scrollable PolishedEmptyState
 * that never dispatches drag deltas to PullToRefreshBox's nested-scroll
 * connection. The genuinely-empty case additionally sat entirely outside
 * PullToRefreshBox.
 *
 * Same structural-check rationale as ProspectingScreenEmptyStateStructureTest:
 * this project has no instrumentation-test infrastructure, so a true gesture
 * test isn't added here (see that class's kdoc for the full explanation).
 */
class RadarScreenEmptyStateStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/RadarScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/RadarScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate RadarScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the genuinely-empty branch wraps PolishedEmptyState in PullToRefreshBox plus a LazyColumn`() {
        val source = screenSource()
        val emptyBranchIndex = source.indexOf("errorMessage == null && opportunities.isEmpty()")
        check(emptyBranchIndex >= 0) { "Could not find the genuinely-empty condition in RadarScreen.kt -- has this branch been restructured?" }

        val window = source.substring(emptyBranchIndex, minOf(emptyBranchIndex + 1200, source.length))
        val pullToRefreshIndex = window.indexOf("PullToRefreshBox(")
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the genuinely-empty condition." }
        check(pullToRefreshIndex in 0 until polishedEmptyStateIndex) {
            "The genuinely-empty branch must be inside a PullToRefreshBox -- otherwise pull-to-refresh " +
                "is unreachable while Radar is empty, confirmed by inspection (2026-09-07)."
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
        check(filteredEmptyBranchIndex >= 0) { "Could not find the filtered-empty condition in RadarScreen.kt -- has this branch been restructured?" }

        val window = source.substring(filteredEmptyBranchIndex, minOf(filteredEmptyBranchIndex + 1200, source.length))
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the filtered-empty condition." }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect, even when a " +
                "filter/search narrows the list down to zero items -- confirmed by inspection (2026-09-07)."
        }
    }
}

/**
 * Regression guard for the process-recreation audit finding (2026-09-07):
 * a typed search query or an active type filter used plain `remember`, so
 * it was silently lost on rotation/process death -- confirmed by
 * inspection against HomeScreen's own X-post textarea, which already used
 * rememberSaveable correctly. String/String? are natively supported by
 * rememberSaveable's default saver, so this is a one-word fix with no
 * custom Saver required.
 */
class RadarScreenStateRestorationStructureTest {
    private fun screenSource(): String {
        val file = java.io.File("src/main/java/com/fillbook/growthos/ui/screens/RadarScreen.kt")
            .let { if (it.exists()) it else java.io.File("app/src/main/java/com/fillbook/growthos/ui/screens/RadarScreen.kt") }
        check(file.exists()) { "Could not locate RadarScreen.kt from working directory ${java.io.File(".").absolutePath}." }
        return file.readText()
    }

    @Test
    fun `the search query survives process recreation via rememberSaveable, not plain remember`() {
        check(screenSource().contains("var query by rememberSaveable { mutableStateOf(\"\") }")) {
            "Expected RadarScreen's search query to use rememberSaveable, not remember -- otherwise a typed " +
                "search is silently lost on rotation/process death."
        }
    }

    @Test
    fun `the type filter survives process recreation via rememberSaveable, not plain remember`() {
        check(screenSource().contains("var typeFilter by rememberSaveable { mutableStateOf<String?>(null) }")) {
            "Expected RadarScreen's type filter to use rememberSaveable, not remember -- otherwise an active " +
                "filter chip is silently lost on rotation/process death."
        }
    }
}

/**
 * Regression guard for the UX-consistency audit finding (2026-09-07):
 * unlike Inbound/Prospecting/Partnerships, this screen's draft-reply
 * failure had no specific handler for DraftRejectedException, so a real,
 * actionable guardrail rejection always showed the same generic "check
 * your connection" message instead.
 */
class RadarScreenDraftReplyErrorStructureTest {
    @Test
    fun `startReply catches DraftRejectedException specifically, before the generic Exception catch`() {
        val file = java.io.File("src/main/java/com/fillbook/growthos/ui/screens/RadarScreen.kt")
            .let { if (it.exists()) it else java.io.File("app/src/main/java/com/fillbook/growthos/ui/screens/RadarScreen.kt") }
        check(file.exists()) { "Could not locate RadarScreen.kt from working directory ${java.io.File(".").absolutePath}." }
        val source = file.readText()

        val startReplyIndex = source.indexOf("fun startReply(opp: Opportunity)")
        check(startReplyIndex >= 0) { "Could not find startReply() -- has it been renamed or restructured?" }
        val specificCatchIndex = source.indexOf("catch (e: DraftRejectedException)", startReplyIndex)
        val genericCatchIndex = source.indexOf("catch (e: Exception)", startReplyIndex)
        check(specificCatchIndex >= 0) { "Expected startReply() to catch DraftRejectedException specifically." }
        check(genericCatchIndex >= 0) { "Expected startReply() to still have a generic catch (e: Exception) fallback." }
        check(specificCatchIndex < genericCatchIndex) {
            "DraftRejectedException must be caught BEFORE the generic Exception catch, or the specific " +
                "catch is unreachable (DraftRejectedException would already have matched the generic one)."
        }
    }
}
