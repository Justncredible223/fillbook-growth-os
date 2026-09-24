package com.fillbook.growthos.data

import com.fillbook.growthos.BuildConfig

/**
 * The three compiled-in values every backend call needs, pulled out of
 * MainActivity so a non-Activity component (FillbookMessagingService,
 * which has no Activity/Context lifecycle to build a repository from
 * otherwise) can construct its own NetworkGrowthOsRepository the exact
 * same way MainActivity does, instead of duplicating these literals in a
 * second place. Same trust tier as before (see NetworkGrowthOsRepository's
 * own kdoc) -- moving where they're declared changes nothing about how
 * they're protected.
 */
object AppConfig {
    const val BASE_URL = "https://fillbook-growth-os.vercel.app"

    /**
     * Vercel deployment-protection bypass token, not the Supabase
     * service_role key -- safe to embed client-side by design. No longer a
     * literal here (production-readiness audit, 2026-09-07): the actual
     * value is injected at build time into BuildConfig from
     * android/local.properties (gitignored) or the
     * GROWTH_OS_PROTECTION_BYPASS_SECRET env var -- see
     * app/build.gradle.kts's secretValue(). Never commit a real value to
     * this file or to any tracked doc again.
     */
    val PROTECTION_BYPASS_SECRET: String = BuildConfig.PROTECTION_BYPASS_SECRET

    /**
     * The actual per-project access token requireAppAuth checks
     * server-side. Same build-time injection as PROTECTION_BYPASS_SECRET
     * above (android/local.properties's growthOsAppToken or the
     * GROWTH_OS_APP_TOKEN env var) -- never a literal in source.
     */
    val APP_TOKEN: String = BuildConfig.APP_TOKEN

    const val DECIDER_NAME = "Owner"

    /**
     * The fillbookhq.com site's own base URL -- a different backend than
     * BASE_URL above (this project's own Vercel app). Fillbook Stats talks
     * to it directly for GET /api/admin?action=... (see AdminGrowth.tsx /
     * frontend/api/admin.ts in the fillbook repo), never through this
     * project's backend as a proxy.
     */
    // www, not the bare domain: the bare domain 308-redirects to www, and OkHttp drops the Authorization header on a cross-host redirect.
    const val FILLBOOK_BASE_URL = "https://www.fillbookhq.com"

    /**
     * Supabase project URL + anon key for the SAME Supabase project the
     * fillbookhq.com site itself uses -- required so this app can sign in
     * as the owner and get a session access token that /api/admin's
     * requireAdmin() will accept (it re-derives the caller's identity from
     * that token and checks it against OWNER_EMAIL server-side). The anon
     * key is not a secret -- it is meant to be public and is protected by
     * Supabase RLS, same as any web client embedding it -- so unlike
     * PROTECTION_BYPASS_SECRET/APP_TOKEN above it does not need the
     * local.properties/env-var build-time injection treatment.
     */
    const val SUPABASE_URL = "https://xfelnxhumxjakwjhgapf.supabase.co"
    const val SUPABASE_ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZWxueGh1bXhqYWt3amhnYXBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0OTcyMjUsImV4cCI6MjEwMDA3MzIyNX0.Dzyy1sbaY_5p7oD-DO2MYcuDpyEu0AA5Gmx-ldn8hZ0"

    fun buildRepository(): NetworkGrowthOsRepository =
        NetworkGrowthOsRepository(BASE_URL, PROTECTION_BYPASS_SECRET, APP_TOKEN, DECIDER_NAME)

    /** Must be listed under Supabase Auth -> URL Configuration -> Redirect URLs, or Google sign-in lands on the website instead. */
    const val OAUTH_REDIRECT_URI = "com.fillbook.growthos://auth-callback"

    fun buildSupabaseAuthClient(context: android.content.Context): SupabaseAuthClient =
        SupabaseAuthClient(SUPABASE_URL, SUPABASE_ANON_KEY, context)

    fun buildFillbookAdminRepository(context: android.content.Context): FillbookAdminRepository =
        NetworkFillbookAdminRepository(FILLBOOK_BASE_URL, buildSupabaseAuthClient(context))
}
