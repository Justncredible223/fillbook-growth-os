package com.fillbook.growthos.ui.screens

import com.fillbook.growthos.data.PartnerCategory
import com.fillbook.growthos.data.PartnershipProspect
import com.fillbook.growthos.data.PartnershipStage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun prospect(
    id: String = "p1",
    organizationName: String = "Example",
    stage: PartnershipStage = PartnershipStage.QUALIFIED,
    suppressedReason: String? = null,
    discoveryScore: Int? = 70,
    approvedCampaignAssetId: String? = null,
    previewText: String? = null,
): PartnershipProspect = PartnershipProspect(
    id = id,
    organizationName = organizationName,
    contactName = null,
    partnerCategory = PartnerCategory.EDUCATOR_COACH,
    stage = stage,
    websiteUrl = null,
    socialLinks = emptyMap(),
    contactRoute = "X DM: @example",
    contactRouteSource = null,
    audienceFocus = null,
    futuresRelevanceEvidence = null,
    sourceUrls = emptyList(),
    researchDate = null,
    competingJournalRelationships = null,
    competingJournalEvidence = null,
    proposedCollaboration = "A pilot.",
    qualificationRationale = "Real evidence they run a coaching program.",
    ownerNotes = null,
    nextAction = null,
    nextActionDueDate = null,
    pilotTermsProposed = null,
    pilotTermsAgreed = null,
    pilotStartDate = null,
    pilotEndDate = null,
    followUpCount = 0,
    approvedCampaignAssetId = approvedCampaignAssetId,
    previewText = previewText,
    contactedAt = null,
    contactedChannel = null,
    discoveryScore = discoveryScore,
    discoveryConfidence = "medium",
    discoveredVia = "x_search",
    suppressedReason = suppressedReason,
)

class PartnershipsScreenTest {
    @Test
    fun `the pitch is editable while still a candidate -- qualified and draft_ready`() {
        assertTrue(isPitchStillEditable(PartnershipStage.QUALIFIED))
        assertTrue(isPitchStillEditable(PartnershipStage.DRAFT_READY))
    }

    @Test
    fun `the pitch is read-only from CONTACTED onward -- it's history, not a candidate anymore`() {
        assertFalse(isPitchStillEditable(PartnershipStage.CONTACTED))
        assertFalse(isPitchStillEditable(PartnershipStage.REPLIED))
        assertFalse(isPitchStillEditable(PartnershipStage.PILOT))
        assertFalse(isPitchStillEditable(PartnershipStage.ACTIVE_PARTNER))
        assertFalse(isPitchStillEditable(PartnershipStage.CLOSED))
        assertFalse(isPitchStillEditable(PartnershipStage.ARCHIVED))
        assertFalse(isPitchStillEditable(PartnershipStage.DO_NOT_CONTACT))
    }

    @Test
    fun `a brand-new prospect with no draft yet is also not editable`() {
        assertFalse(isPitchStillEditable(PartnershipStage.PROSPECT))
    }

    @Test
    fun `extracts the bare handle from a real contactRoute string`() {
        assertEquals("phinloco", extractXHandle("X DM: @phinloco"))
        assertEquals("wannabechamp", extractXHandle("X DM: @wannabechamp"))
    }

    @Test
    fun `returns null when no handle can be parsed, so the caller can fall back instead of opening a broken URL`() {
        assertNull(extractXHandle(null))
        assertNull(extractXHandle("email: dana@example.com")) // an email route, not an X route
        assertNull(extractXHandle("X DM: unknown"))
    }

    // -- Suppressed-recommendations UI gap --------------------------------

    @Test
    fun `a suppressed prospect is excluded from the primary recommended queue`() {
        val qualified = prospect(id = "q1", stage = PartnershipStage.QUALIFIED)
        val suppressedOne = prospect(id = "s1", stage = PartnershipStage.QUALIFIED, suppressedReason = "No evidence this recipient runs or offers...")
        val recommendations = recommendedPartnerships(listOf(qualified, suppressedOne))
        assertEquals(listOf("q1"), recommendations.map { it.id })
    }

    @Test
    fun `a suppressed prospect appears in its own separate suppressed list, never merged into recommendations`() {
        val qualified = prospect(id = "q1", stage = PartnershipStage.QUALIFIED)
        val suppressedOne = prospect(id = "s1", stage = PartnershipStage.QUALIFIED, suppressedReason = "No evidence this recipient runs or offers...")
        val suppressedTwo = prospect(id = "s2", stage = PartnershipStage.DRAFT_READY, suppressedReason = "No evidence this recipient runs or offers...")
        val suppressed = suppressedPartnerships(listOf(qualified, suppressedOne, suppressedTwo))
        assertEquals(setOf("s1", "s2"), suppressed.map { it.id }.toSet())
    }

    @Test
    fun `the suppression reason itself is preserved and retrievable, not just a boolean flag`() {
        val reason = "No evidence this recipient runs or offers an audience, community, business, educational offering, or complementary product."
        val suppressedOne = prospect(id = "s1", suppressedReason = reason)
        assertEquals(reason, suppressedPartnerships(listOf(suppressedOne)).single().suppressedReason)
    }

    @Test
    fun `do-not-contact remains excluded from both the recommended queue and the suppressed section`() {
        val doNotContact = prospect(id = "d1", stage = PartnershipStage.DO_NOT_CONTACT)
        assertTrue(recommendedPartnerships(listOf(doNotContact)).isEmpty())
        assertTrue(suppressedPartnerships(listOf(doNotContact)).isEmpty())
    }

    @Test
    fun `a qualified, evidence-sufficient, NOT suppressed prospect remains fully actionable`() {
        val qualified = prospect(id = "q1", stage = PartnershipStage.QUALIFIED, suppressedReason = null)
        assertEquals(listOf("q1"), recommendedPartnerships(listOf(qualified)).map { it.id })
        assertTrue(canShowPursuitActions(qualified))
    }

    @Test
    fun `canShowPursuitActions is false for a suppressed prospect regardless of its stage`() {
        assertFalse(canShowPursuitActions(prospect(stage = PartnershipStage.QUALIFIED, suppressedReason = "x")))
        assertFalse(canShowPursuitActions(prospect(stage = PartnershipStage.DRAFT_READY, suppressedReason = "x")))
    }

    @Test
    fun `canShowPursuitActions is true for a normal, non-suppressed prospect`() {
        assertTrue(canShowPursuitActions(prospect(stage = PartnershipStage.QUALIFIED, suppressedReason = null)))
        assertTrue(canShowPursuitActions(prospect(stage = PartnershipStage.DRAFT_READY, suppressedReason = null)))
    }

    @Test
    fun `filtering is stable across repeated calls with the same input -- refresh or restart must never flip a record's section`() {
        val items = listOf(
            prospect(id = "q1", stage = PartnershipStage.QUALIFIED),
            prospect(id = "s1", stage = PartnershipStage.QUALIFIED, suppressedReason = "x"),
        )
        repeat(3) {
            assertEquals(listOf("q1"), recommendedPartnerships(items).map { it.id })
            assertEquals(listOf("s1"), suppressedPartnerships(items).map { it.id })
        }
    }
}

/**
 * Regression guard for the same real, confirmed-with-a-real-finger bug fixed
 * on ProspectingScreen (2026-09-07), independently found here too by
 * inspection during a release-readiness audit: this screen's "No
 * recommendations yet" empty state (with its Refresh discovery / Add
 * prospect actions) used to sit entirely outside PullToRefreshBox, so
 * pull-to-refresh was inert on it. Fix: wrap the branch in PullToRefreshBox
 * with a LazyColumn -- a genuine nested-scroll participant -- instead of a
 * bare, non-scrollable PolishedEmptyState + Row pair.
 *
 * Same structural-check rationale as ProspectingScreenEmptyStateStructureTest:
 * this project has no instrumentation-test infrastructure, so a true gesture
 * test isn't added here (see that class's kdoc for the full explanation).
 */
class PartnershipsScreenEmptyStateStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/PartnershipsScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/PartnershipsScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate PartnershipsScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the empty-state branch is inside PullToRefreshBox and wraps PolishedEmptyState in a LazyColumn`() {
        val source = screenSource()
        val emptyBranchIndex = source.indexOf("errorMessage == null && items.isEmpty()")
        check(emptyBranchIndex >= 0) { "Could not find the empty-state condition in PartnershipsScreen.kt -- has this branch been restructured?" }

        val window = source.substring(emptyBranchIndex, minOf(emptyBranchIndex + 1200, source.length))
        val pullToRefreshIndex = window.indexOf("PullToRefreshBox(")
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the empty-state condition." }
        check(pullToRefreshIndex in 0 until polishedEmptyStateIndex) {
            "The empty-state branch must be inside a PullToRefreshBox -- otherwise pull-to-refresh " +
                "is unreachable while there are no recommendations, confirmed by inspection (2026-09-07)."
        }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect."
        }
    }
}
