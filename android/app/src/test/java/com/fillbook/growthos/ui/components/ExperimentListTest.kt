package com.fillbook.growthos.ui.components

import com.fillbook.growthos.data.Experiment
import com.fillbook.growthos.data.ExperimentResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ExperimentListTest {
    private fun experiment(id: String, result: ExperimentResult? = null, status: String = "running") = Experiment(
        id = id,
        hypothesis = "Shorter hooks pass review more often",
        scopePlatform = null,
        scopeAssetType = null,
        guardrailNote = null,
        status = status,
        startDate = "2026-09-04",
        endDate = null,
        controlWindowStart = "2026-08-21",
        createdAt = "2026-09-04T08:00:00Z",
        result = result,
    )

    private val measured = ExperimentResult(
        controlRate = 0.5,
        treatmentRate = 0.9,
        absoluteDifference = 0.4,
        pValue = 0.01,
        isSignificant = true,
        insufficientSample = false,
        controlSampleSize = 20,
        treatmentSampleSize = 20,
        interpretation = "Review pass rate improved.",
        computedAt = "2026-09-04T15:30:00Z",
    )

    @Test
    fun `tapping Measure puts the returned result on the card, still running`() {
        val before = listOf(experiment("a"), experiment("b"))
        assertNull(before[1].result)

        val after = ExperimentList.merge(before, experiment("b", result = measured))

        val shown = after.first { it.id == "b" }
        assertNotNull(shown.result)
        assertEquals("Review pass rate improved.", shown.result!!.interpretation)
        assertEquals("running", shown.status)
        assertEquals(listOf("a", "b"), after.map { it.id }) // order and other entries untouched
        assertNull(after.first { it.id == "a" }.result)
    }

    @Test
    fun `an experiment the list has not seen yet is prepended rather than dropped`() {
        val after = ExperimentList.merge(listOf(experiment("a")), experiment("new", result = measured))
        assertEquals(listOf("new", "a"), after.map { it.id })
    }
}
