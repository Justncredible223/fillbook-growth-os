package com.fillbook.growthos.data

import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
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

/**
 * Regression coverage for a real, confirmed production bug (2026-09-07):
 * Evening Report failed to load on every real device attempt with a generic
 * "check your connection" message, even though the backend endpoint
 * (verified directly, same credentials) reliably returned HTTP 200 with
 * valid data. Root cause, captured via a live JDWP exception breakpoint
 * (not guessed): backend/api/summary.ts's handleEveningReport selects only
 * `title, score` for topOpportunity, never `id` -- unlike handleBrief's
 * topNewOpportunities, which does include `id`. The shared
 * parseOpportunitySummary parser unconditionally required `id` via
 * getString("id"), which throws JSONException the moment `id` is absent --
 * i.e. every time evening-report's trailing-24h window had a genuine new
 * opportunity to report (not an edge case). Neither EveningReportScreen nor
 * MorningBriefScreen ever reads OpportunitySummary.id, so relaxing this
 * requirement changes no observable behavior other than fixing the crash.
 */
class ParseOpportunitySummaryTest {
    @Test
    fun `parses correctly when id is present -- the morning-brief shape, unchanged behavior`() {
        val json = JSONObject().put("id", "opp-1").put("title", "Trailing drawdown confusion").put("score", 80.0)

        val result = parseOpportunitySummary(json)

        assertEquals("opp-1", result.id)
        assertEquals("Trailing drawdown confusion", result.title)
        assertEquals(80.0, result.score, 0.0)
    }

    @Test
    fun `parses correctly when id is absent -- the real evening-report shape that used to crash`() {
        val json = JSONObject().put("title", "Position sizing in the hour after a loss").put("score", 20.5)

        val result = parseOpportunitySummary(json)

        assertEquals("", result.id)
        assertEquals("Position sizing in the hour after a loss", result.title)
        assertEquals(20.5, result.score, 0.0)
    }

    @Test
    fun `still throws when title is missing -- title and score remain genuinely required, not silently relaxed`() {
        val json = JSONObject().put("score", 20.5)

        assertThrows(JSONException::class.java) { parseOpportunitySummary(json) }
    }

    @Test
    fun `still throws when score is missing -- title and score remain genuinely required, not silently relaxed`() {
        val json = JSONObject().put("title", "Something")

        assertThrows(JSONException::class.java) { parseOpportunitySummary(json) }
    }
}

/**
 * Regression coverage for a real gap found in the 2026-09-07 release audit:
 * NetworkException already captured httpCode specifically so callers could
 * "tell an auth/config problem (401/500) apart from an unrelated server/
 * network failure" (see its own doc comment), but nothing actually
 * consulted it -- every screen's generic catch (e: Exception) showed the
 * same "check your connection" message for a stale/rotated APP_API_TOKEN
 * (401/403) as for a genuine offline failure, leaving the owner no way to
 * tell "reinstall the APK" apart from "check your wifi."
 */
/**
 * Regression coverage for a real gap found in the 2026-09-07 release
 * audit: unlike draftInboundResponse/draftProspectingReply/
 * generatePartnershipDraft (all routed through postExpectingDraftRejection
 * for the Partnerships/Inbound/Prospecting 404 pattern), draftOpportunityReply
 * used the plain post() helper, so opportunities.ts's OpportunityReplyError
 * (a distinct HTTP 400 response, not 404) fell through as a bare
 * NetworkException, silently replacing the real guardrail reason with
 * RadarScreen's generic "Couldn't draft a reply. Check your connection and
 * try again." message.
 */
class ExtractOpportunityReplyErrorMessageTest {
    private fun networkExceptionMessage(httpCode: Int, body: String) = "POST /api/opportunities failed: HTTP $httpCode -- $body"

    @Test
    fun `extracts the real error message from a 400 OpportunityReplyError response`() {
        val message = networkExceptionMessage(400, """{"error":"This opportunity no longer has enough verified context to draft a reply confidently."}""")
        val result = extractOpportunityReplyErrorMessage(400, message)
        assertEquals("This opportunity no longer has enough verified context to draft a reply confidently.", result)
    }

    @Test
    fun `returns null for a non-400 status -- a genuine server or auth failure must still surface as NetworkException`() {
        val message = networkExceptionMessage(500, """{"error":"internal error"}""")
        assertNull(extractOpportunityReplyErrorMessage(500, message))
    }

    @Test
    fun `returns null for a 404 -- that status belongs to the separate Partnerships-Inbound-Prospecting pattern, not this one`() {
        val message = networkExceptionMessage(404, """{"error":"something"}""")
        assertNull(extractOpportunityReplyErrorMessage(404, message))
    }

    @Test
    fun `returns null for a 400 whose body isn't the expected JSON shape, rather than throwing`() {
        assertNull(extractOpportunityReplyErrorMessage(400, "POST /api/opportunities failed: HTTP 400 -- not json at all"))
    }

    @Test
    fun `returns null for a 400 with a blank error field`() {
        val message = networkExceptionMessage(400, """{"error":""}""")
        assertNull(extractOpportunityReplyErrorMessage(400, message))
    }
}

class AuthErrorMessageTest {
    @Test
    fun `returns the auth-expired message for a 401`() {
        val e = NetworkException("GET /api/summary failed: HTTP 401 -- {}", 401)
        assertEquals("Authentication expired. Reopen the app or reinstall the current APK.", authErrorMessage(e))
    }

    @Test
    fun `returns the auth-expired message for a 403`() {
        val e = NetworkException("GET /api/summary failed: HTTP 403 -- {}", 403)
        assertEquals("Authentication expired. Reopen the app or reinstall the current APK.", authErrorMessage(e))
    }

    @Test
    fun `returns null for a 500 -- a genuine server failure, not an auth problem`() {
        val e = NetworkException("GET /api/summary failed: HTTP 500 -- {}", 500)
        assertNull(authErrorMessage(e))
    }

    @Test
    fun `returns null for a 404 -- handled separately by extractPartnershipActionErrorMessage, not this gate`() {
        val e = NetworkException("GET /api/summary failed: HTTP 404 -- {}", 404)
        assertNull(authErrorMessage(e))
    }

    @Test
    fun `returns null when httpCode is absent -- a real network failure never had one to check in the first place`() {
        val e = NetworkException("GET /api/summary failed", null)
        assertNull(authErrorMessage(e))
    }

    @Test
    fun `returns null for a plain timeout -- OkHttp throws SocketTimeoutException, never a NetworkException with an httpCode`() {
        assertNull(authErrorMessage(java.net.SocketTimeoutException("timeout")))
    }

    @Test
    fun `returns null for a plain offline failure -- OkHttp throws UnknownHostException, never a NetworkException with an httpCode`() {
        assertNull(authErrorMessage(java.net.UnknownHostException("Unable to resolve host")))
    }
}
