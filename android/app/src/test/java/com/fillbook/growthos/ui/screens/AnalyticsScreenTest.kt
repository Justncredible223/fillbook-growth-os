package com.fillbook.growthos.ui.screens

import org.junit.Test

/**
 * Regression guard for two UX-consistency audit findings (2026-09-07):
 * (1) this screen used a bare LoadingIndicator() instead of the list-shaped
 * SkeletonListLoading() every sibling screen uses; (2) when loaded with no
 * error but a null `analytics` payload (a malformed/empty server response),
 * this branch rendered nothing at all -- no empty state, no explanation.
 */
class AnalyticsScreenStructureTest {
    private fun screenSource(): String {
        val file = java.io.File("src/main/java/com/fillbook/growthos/ui/screens/AnalyticsScreen.kt")
            .let { if (it.exists()) it else java.io.File("app/src/main/java/com/fillbook/growthos/ui/screens/AnalyticsScreen.kt") }
        check(file.exists()) { "Could not locate AnalyticsScreen.kt from working directory ${java.io.File(".").absolutePath}." }
        return file.readText()
    }

    @Test
    fun `the loading branch uses SkeletonListLoading, not a bare LoadingIndicator`() {
        val source = screenSource()
        check(source.contains("SkeletonListLoading()")) { "Expected AnalyticsScreen to use SkeletonListLoading() for its loading state." }
        check(!source.contains("LoadingIndicator()")) { "Expected AnalyticsScreen to no longer use a bare LoadingIndicator()." }
    }

    @Test
    fun `a loaded-but-null analytics payload shows an honest empty state, not nothing`() {
        val source = screenSource()
        val nullCheckIndex = source.indexOf("if (data == null) {")
        check(nullCheckIndex >= 0) {
            "Expected an explicit `if (data == null)` branch after loading analytics -- otherwise a " +
                "malformed/empty server response silently renders nothing at all."
        }
        val window = source.substring(nullCheckIndex, minOf(nullCheckIndex + 300, source.length))
        check(window.contains("PolishedEmptyState(")) {
            "Expected the null-analytics branch to render PolishedEmptyState, giving the owner a real, " +
                "visible explanation instead of a blank screen."
        }
    }
}
