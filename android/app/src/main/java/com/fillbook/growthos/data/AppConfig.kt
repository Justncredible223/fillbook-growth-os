package com.fillbook.growthos.data

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
     * service_role key -- safe to embed client-side by design.
     */
    const val PROTECTION_BYPASS_SECRET = "7TVBpvTPeeHbiGlZco9RDS8miXqtbfoi"

    /** The actual per-project access token requireAppAuth checks server-side. */
    const val APP_TOKEN = "_VSLHPVS8C0bBcF_cjuJG0RBj3Ps3_vRWhrefxHfHiI"

    const val DECIDER_NAME = "Owner"

    fun buildRepository(): NetworkGrowthOsRepository =
        NetworkGrowthOsRepository(BASE_URL, PROTECTION_BYPASS_SECRET, APP_TOKEN, DECIDER_NAME)
}
