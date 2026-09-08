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

    fun buildRepository(): NetworkGrowthOsRepository =
        NetworkGrowthOsRepository(BASE_URL, PROTECTION_BYPASS_SECRET, APP_TOKEN, DECIDER_NAME)
}
