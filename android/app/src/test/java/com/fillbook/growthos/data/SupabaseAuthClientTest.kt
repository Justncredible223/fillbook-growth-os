package com.fillbook.growthos.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SupabaseAuthClientTest {
    @Test
    fun `pkce challenge matches the RFC 7636 S256 test vector`() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test
    fun `google authorize url asks Supabase for the PKCE flow back to the app's own callback`() {
        val url = googleAuthorizeUrl("https://abc.supabase.co", "com.fillbook.growthos://auth-callback", "CHALLENGE")
        assertEquals(
            "https://abc.supabase.co/auth/v1/authorize?provider=google&redirect_to=com.fillbook.growthos%3A%2F%2Fauth-callback" +
                "&code_challenge=CHALLENGE&code_challenge_method=s256",
            url,
        )
    }

    @Test
    fun `error reason reads the current msg field and the older error_description field`() {
        assertEquals("Invalid login credentials", supabaseErrorReason("""{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}"""))
        assertEquals("Email not confirmed", supabaseErrorReason("""{"error":"invalid_grant","error_description":"Email not confirmed"}"""))
        assertNull(supabaseErrorReason("not json"))
    }
}
