package com.fillbook.growthos.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression coverage for a real bug found while verifying this round's new
 * generate-draft error messages on-device: approvals.ts converts a thrown
 * PartnershipActionError (evidence-insufficiency, the duplicate-request
 * generation_claimed_at mutex) into an HTTP 404 with a real, actionable
 * {error: message} body -- but before extractPartnershipActionErrorMessage
 * existed, that message never reached the owner. It fell through as a bare
 * NetworkException, which PartnershipsScreen's runAction has no specific
 * catch clause for, so it silently became the generic "Couldn't complete
 * that action. Check your connection and try again." instead of the real,
 * useful reason.
 */
class NetworkGrowthOsRepositoryTest {
    private fun networkExceptionMessage(httpCode: Int, body: String) = "POST /api/approvals?resource=partnerships failed: HTTP $httpCode -- $body"

    @Test
    fun `extracts the real error message from a 404 PartnershipActionError response`() {
        val message = networkExceptionMessage(404, """{"error":"A draft is already being generated for this prospect -- please wait for it to finish before trying again."}""")
        val result = extractPartnershipActionErrorMessage(404, message)
        assertEquals("A draft is already being generated for this prospect -- please wait for it to finish before trying again.", result)
    }

    @Test
    fun `extracts the evidence-insufficiency message the same way`() {
        val message = networkExceptionMessage(404, """{"error":"Not enough of this recipient's own words are on file to personalize a pitch confidently yet."}""")
        val result = extractPartnershipActionErrorMessage(404, message)
        assertEquals("Not enough of this recipient's own words are on file to personalize a pitch confidently yet.", result)
    }

    @Test
    fun `returns null for a non-404 status -- a genuine server or auth failure must still surface as NetworkException`() {
        val message = networkExceptionMessage(500, """{"error":"internal error"}""")
        assertNull(extractPartnershipActionErrorMessage(500, message))
    }

    @Test
    fun `returns null for a 404 whose body isn't the expected JSON shape, rather than throwing`() {
        assertNull(extractPartnershipActionErrorMessage(404, "POST /api/x failed: HTTP 404 -- not json at all"))
    }

    @Test
    fun `returns null for a 404 with a blank error field`() {
        val message = networkExceptionMessage(404, """{"error":""}""")
        assertNull(extractPartnershipActionErrorMessage(404, message))
    }

    @Test
    fun `returns null when the message is null entirely`() {
        assertNull(extractPartnershipActionErrorMessage(404, null))
    }
}
