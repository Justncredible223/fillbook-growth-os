package com.fillbook.growthos.ui.screens

import org.junit.Test

/**
 * Regression guard for the UX-consistency audit finding (2026-09-07): this
 * screen used a bare LoadingIndicator() instead of the list-shaped
 * SkeletonListLoading() every sibling screen uses -- inconsistent loading
 * UX, not a functional bug, but flagged for release.
 */
class SystemScreenLoadingStateStructureTest {
    @Test
    fun `the loading branch uses SkeletonListLoading, not a bare LoadingIndicator`() {
        val file = java.io.File("src/main/java/com/fillbook/growthos/ui/screens/SystemScreen.kt")
            .let { if (it.exists()) it else java.io.File("app/src/main/java/com/fillbook/growthos/ui/screens/SystemScreen.kt") }
        check(file.exists()) { "Could not locate SystemScreen.kt from working directory ${java.io.File(".").absolutePath}." }
        val source = file.readText()
        check(source.contains("SkeletonListLoading()")) { "Expected SystemScreen to use SkeletonListLoading() for its loading state." }
        check(!source.contains("LoadingIndicator()")) { "Expected SystemScreen to no longer use a bare LoadingIndicator()." }
    }
}
