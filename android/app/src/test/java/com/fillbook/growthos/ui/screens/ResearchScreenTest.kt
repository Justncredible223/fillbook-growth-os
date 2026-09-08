package com.fillbook.growthos.ui.screens

import com.fillbook.growthos.ui.components.StatusTone
import org.junit.Assert.assertEquals
import org.junit.Test

class ResearchScreenTest {
    @Test
    fun `maps every real research status to the right visual tone`() {
        assertEquals(StatusTone.WAITING, researchStatusTone("ready_for_review"))
        assertEquals(StatusTone.READY, researchStatusTone("approved"))
        assertEquals(StatusTone.FAILED, researchStatusTone("rejected"))
        assertEquals(StatusTone.FAILED, researchStatusTone("failed"))
    }

    @Test
    fun `falls back to a neutral tone for an unrecognized future status rather than crashing`() {
        assertEquals(StatusTone.NEUTRAL, researchStatusTone("some_future_status"))
    }

    @Test
    fun `every real status gets a real, human-readable label`() {
        assertEquals("Ready for review", researchStatusLabel("ready_for_review"))
        assertEquals("Approved", researchStatusLabel("approved"))
        assertEquals("Rejected", researchStatusLabel("rejected"))
        assertEquals("Failed", researchStatusLabel("failed"))
    }

    @Test
    fun `capitalizes an unrecognized future status rather than showing a raw db value`() {
        assertEquals("Some_future_status", researchStatusLabel("some_future_status"))
    }
}

/**
 * This project has no instrumentation-test infrastructure (see
 * ProspectingScreenEmptyStateStructureTest's kdoc, referenced throughout
 * this codebase, for the full explanation), so these are structural
 * checks on the actual ResearchScreen.kt source -- the same pattern
 * VideoStatusScreenCreateVideoStructureTest already uses for its own
 * confirmation dialog, busy-guard, and error-surfacing requirements.
 */
class ResearchScreenStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/ResearchScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/ResearchScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate ResearchScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the empty-state branch is inside PullToRefreshBox and wraps PolishedEmptyState in a LazyColumn`() {
        val source = screenSource()

        val pullToRefreshIndex = source.indexOf("PullToRefreshBox(")
        val emptyBranchIndex = source.indexOf("errorMessage == null && records.isEmpty()")
        check(pullToRefreshIndex >= 0) { "Could not find PullToRefreshBox in ResearchScreen.kt -- has this screen been restructured?" }
        check(emptyBranchIndex >= 0) { "Could not find the empty-state condition in ResearchScreen.kt -- has this branch been restructured?" }
        check(pullToRefreshIndex < emptyBranchIndex) {
            "The empty-state condition must be evaluated INSIDE PullToRefreshBox, not before/outside it -- " +
                "otherwise pull-to-refresh is unreachable while the record list is empty."
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

    @Test
    fun `the confirmation dialog explains paid LLM budget, no auto-post, and that this lands in Approvals for review`() {
        val source = screenSource()
        val confirmDialogIndex = source.indexOf("Create a real research report?")
        check(confirmDialogIndex >= 0) { "Expected a confirmation dialog titled 'Create a real research report?'." }

        val window = source.substring(confirmDialogIndex, minOf(confirmDialogIndex + 1000, source.length))
        check(window.contains("paid LLM budget")) { "Expected the confirmation dialog to disclose real paid LLM budget usage." }
        check(window.contains("REAL research draft")) { "Expected the confirmation dialog to state this creates a real draft, not a preview." }
        check(window.contains("NOT post or publish anywhere automatically")) { "Expected the confirmation dialog to disclose no auto-publishing." }
        check(window.contains("requiring your review")) {
            "Expected the confirmation dialog to disclose this lands in Approvals requiring the owner's review."
        }
    }

    @Test
    fun `requestResearch() checks the busy-duplicate-tap guard before doing anything else`() {
        val source = screenSource()
        val fnIndex = source.indexOf("fun requestResearch() {")
        check(fnIndex >= 0) { "Could not find requestResearch() -- has it been renamed or restructured?" }
        val window = source.substring(fnIndex, minOf(fnIndex + 300, source.length))
        check(window.contains("if (creatingResearch) return")) {
            "Expected requestResearch() to bail out early when a request is already in flight -- otherwise a " +
                "rapid double-tap on Confirm can fire two real, paid requests for the same topic."
        }
    }

    @Test
    fun `the Confirm button is disabled while a request is in flight`() {
        val source = screenSource()
        val confirmDialogIndex = source.indexOf("Create a real research report?")
        check(confirmDialogIndex >= 0)
        val window = source.substring(confirmDialogIndex, minOf(confirmDialogIndex + 1500, source.length))
        check(window.contains("enabled = !creatingResearch")) {
            "Expected the Confirm button to be disabled while creatingResearch is true, showing a busy state."
        }
    }

    @Test
    fun `a real backend rejection (off-topic, duplicate, invalid) is surfaced via extractResearchRequestErrorMessage, not a generic message`() {
        val source = screenSource()
        val fnIndex = source.indexOf("fun requestResearch() {")
        check(fnIndex >= 0)
        val window = source.substring(fnIndex, minOf(fnIndex + 1600, source.length))
        check(window.contains("extractResearchRequestErrorMessage(e.httpCode, e.message)")) {
            "Expected requestResearch() to try extracting the real backend error message before falling back " +
                "to a generic 'check your connection' message -- otherwise an off-topic-topic or duplicate " +
                "rejection is indistinguishable from a network failure."
        }
    }

    @Test
    fun `Continue is disabled until a topic is typed or an opportunity is selected`() {
        val source = screenSource()
        val dialogIndex = source.indexOf("Create research")
        check(dialogIndex >= 0) { "Expected a 'Create research' entry dialog title." }
        val canContinueIndex = source.indexOf("val canContinue =")
        check(canContinueIndex >= 0) { "Expected a canContinue gate controlling the Continue button." }
        val window = source.substring(canContinueIndex, minOf(canContinueIndex + 200, source.length))
        check(window.contains("selectedOpportunityId != null") && window.contains("topicInput.trim().length >= 3")) {
            "Expected canContinue to require either a selected opportunity or a real (non-trivial) typed topic."
        }
    }

    @Test
    fun `selection state is tracked only by id, never by holding the ResearchRecord object directly`() {
        val source = screenSource()
        check(source.contains("var selectedRecordId by rememberSaveable { mutableStateOf<String?>(null) }")) {
            "Expected selectedRecordId to be a rememberSaveable String? -- storing a non-parcelable domain " +
                "object directly in rememberSaveable was an established, previously-fixed bug in the video " +
                "feature (see VideoStatusScreen's selectedOpportunityId)."
        }
    }

    @Test
    fun `a ready_for_review record's detail view offers a link to Approvals`() {
        val source = screenSource()
        check(source.contains("record.status == \"ready_for_review\" && onGoToApprovals != null")) {
            "Expected the detail view to offer a Go to Approvals action specifically for ready_for_review records."
        }
        check(source.contains("\"Go to Approvals\"")) { "Expected an actual 'Go to Approvals' button label." }
    }

    @Test
    fun `the detail view renders every ResearchReport section`() {
        val source = screenSource()
        for (section in listOf("QUESTION", "SUMMARY", "KEY FINDINGS", "EVIDENCE/SOURCES", "CAVEATS/LIMITATIONS", "SUGGESTED CONTENT ANGLES")) {
            check(source.contains("\"$section\"")) { "Expected the detail view to render a '$section' section." }
        }
    }
}
