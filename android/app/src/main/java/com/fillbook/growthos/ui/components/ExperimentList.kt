package com.fillbook.growthos.ui.components

import com.fillbook.growthos.data.Experiment

/**
 * Pure list bookkeeping for the Experiments screen, kept out of the
 * composable so it is unit-testable on the JVM.
 */
object ExperimentList {
    /**
     * Replaces the entry with `updated.id` in place (or prepends it when
     * the list doesn't have it yet). Used the moment an action returns
     * an Experiment -- "Check now" in particular -- so the measured
     * result is on screen immediately from the server's own response
     * and not dependent on, or discarded by, the follow-up refresh.
     */
    fun merge(current: List<Experiment>, updated: Experiment): List<Experiment> =
        if (current.any { it.id == updated.id }) current.map { if (it.id == updated.id) updated else it }
        else listOf(updated) + current
}
