package com.fillbook.growthos.ui.components

/**
 * Keeps the Inbound status filter honest against the list it filters.
 * Pure Kotlin so it can be unit-tested without Compose.
 */
object InboundFilter {
    /**
     * The filter to actually apply after the queue changes (a refresh, or
     * the selected item resolving out of the list). A selection that no
     * longer matches any item is dropped back to "All" rather than left
     * pointing at an empty subset that makes the queue look blank while
     * other rows still need attention.
     */
    fun reconcile(selected: String?, availableStatuses: Collection<String>): String? =
        selected?.takeIf { it in availableStatuses }
}
