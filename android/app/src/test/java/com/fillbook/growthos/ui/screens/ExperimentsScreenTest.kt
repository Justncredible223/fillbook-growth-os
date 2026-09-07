package com.fillbook.growthos.ui.screens

import org.junit.Test

/**
 * Regression guard for the process-recreation audit finding (2026-09-07):
 * the "new experiment" dialog's own open/closed state and its typed
 * hypothesis/platform/assetType fields all used plain `remember`, so a
 * half-written experiment was silently lost on rotation/process death.
 */
class ExperimentsScreenStateRestorationStructureTest {
    private fun screenSource(): String {
        val file = java.io.File("src/main/java/com/fillbook/growthos/ui/screens/ExperimentsScreen.kt")
            .let { if (it.exists()) it else java.io.File("app/src/main/java/com/fillbook/growthos/ui/screens/ExperimentsScreen.kt") }
        check(file.exists()) { "Could not locate ExperimentsScreen.kt from working directory ${java.io.File(".").absolutePath}." }
        return file.readText()
    }

    @Test
    fun `the create-dialog visibility flag survives process recreation via rememberSaveable`() {
        check(screenSource().contains("var showCreateDialog by rememberSaveable { mutableStateOf(false) }")) {
            "Expected showCreateDialog to use rememberSaveable, not remember -- otherwise the open new-" +
                "experiment dialog silently closes on rotation/process death."
        }
    }

    @Test
    fun `the create-dialog's typed fields (hypothesis, platform, assetType) survive process recreation`() {
        val source = screenSource()
        for (field in listOf("hypothesis", "platform", "assetType")) {
            check(source.contains("var $field by rememberSaveable")) {
                "Expected the new-experiment dialog's '$field' field to use rememberSaveable, not remember -- " +
                    "otherwise typed input is silently lost on rotation/process death."
            }
        }
    }
}
