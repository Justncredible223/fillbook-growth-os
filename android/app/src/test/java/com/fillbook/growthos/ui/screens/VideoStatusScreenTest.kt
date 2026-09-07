package com.fillbook.growthos.ui.screens

import com.fillbook.growthos.ui.components.StatusTone
import org.junit.Assert.assertEquals
import org.junit.Test

class VideoStatusScreenTest {
    @Test
    fun `maps every real render status to the right visual tone`() {
        assertEquals(StatusTone.WAITING, statusTone("queued"))
        assertEquals(StatusTone.WAITING, statusTone("rendering"))
        assertEquals(StatusTone.READY, statusTone("ready"))
        assertEquals(StatusTone.FAILED, statusTone("failed"))
        assertEquals(StatusTone.SKIPPED, statusTone("canceled"))
    }

    @Test
    fun `falls back to a neutral tone for an unrecognized future status rather than crashing`() {
        assertEquals(StatusTone.NEUTRAL, statusTone("some_future_status"))
    }

    @Test
    fun `every real status gets a real, human-readable label`() {
        assertEquals("Queued", statusLabel("queued"))
        assertEquals("Rendering", statusLabel("rendering"))
        assertEquals("Ready", statusLabel("ready"))
        assertEquals("Failed", statusLabel("failed"))
        assertEquals("Canceled", statusLabel("canceled"))
    }

    @Test
    fun `capitalizes an unrecognized future status rather than showing a raw db value`() {
        assertEquals("Some_future_status", statusLabel("some_future_status"))
    }
}

/**
 * Regression guard for the same real, confirmed-with-a-real-finger bug fixed
 * on ProspectingScreen (2026-09-07), independently found here too by
 * inspection: this screen's "No videos yet" empty state used to sit entirely
 * outside PullToRefreshBox, so pull-to-refresh was inert on it. Fix: wrap the
 * whole branch (empty and populated) in a single PullToRefreshBox, with the
 * empty state rendered inside a LazyColumn -- a genuine nested-scroll
 * participant -- instead of a bare, non-scrollable PolishedEmptyState.
 *
 * Same structural-check rationale as ProspectingScreenEmptyStateStructureTest:
 * this project has no instrumentation-test infrastructure, so a true gesture
 * test isn't added here (see that class's kdoc for the full explanation).
 */
class VideoStatusScreenEmptyStateStructureTest {
    private fun screenSource(): String {
        val candidates = listOf(
            "src/main/java/com/fillbook/growthos/ui/screens/VideoStatusScreen.kt",
            "app/src/main/java/com/fillbook/growthos/ui/screens/VideoStatusScreen.kt",
        )
        val file = candidates.map { java.io.File(it) }.firstOrNull { it.exists() }
            ?: error(
                "Could not locate VideoStatusScreen.kt from working directory " +
                    "${java.io.File(".").absolutePath} -- tried: $candidates.",
            )
        return file.readText()
    }

    @Test
    fun `the empty-state branch is inside PullToRefreshBox and wraps PolishedEmptyState in a LazyColumn`() {
        val source = screenSource()

        val pullToRefreshIndex = source.indexOf("PullToRefreshBox(")
        val emptyBranchIndex = source.indexOf("errorMessage == null && renders.isEmpty()")
        check(pullToRefreshIndex >= 0) { "Could not find PullToRefreshBox in VideoStatusScreen.kt -- has this screen been restructured?" }
        check(emptyBranchIndex >= 0) { "Could not find the empty-state condition in VideoStatusScreen.kt -- has this branch been restructured?" }
        check(pullToRefreshIndex < emptyBranchIndex) {
            "The empty-state condition must be evaluated INSIDE PullToRefreshBox, not before/outside it -- " +
                "otherwise pull-to-refresh is unreachable while the render list is empty, confirmed by inspection (2026-09-07)."
        }

        val window = source.substring(emptyBranchIndex, minOf(emptyBranchIndex + 400, source.length))
        val lazyColumnIndex = window.indexOf("LazyColumn(")
        val polishedEmptyStateIndex = window.indexOf("PolishedEmptyState(")
        check(polishedEmptyStateIndex >= 0) { "Expected to find PolishedEmptyState right after the empty-state condition." }
        check(lazyColumnIndex in 0 until polishedEmptyStateIndex) {
            "PolishedEmptyState must be wrapped inside a LazyColumn (or another genuine nested-scroll " +
                "participant) so PullToRefreshBox's pull gesture has something to detect."
        }
    }
}

/**
 * Regression guard for the release-audit finding (2026-09-07): the
 * Download button had no busy/in-flight guard, so a rapid double-tap
 * could enqueue two DownloadManager requests for the same render. Fixed
 * with a `downloadingIds: Set<String>` checked before starting a new
 * download and released on every path: enqueue failure (synchronously),
 * and both the success and failure/cancellation branches of the
 * DownloadManager completion broadcast receiver.
 */
class VideoStatusScreenDownloadGuardStructureTest {
    private fun screenSource(): String {
        val file = java.io.File("src/main/java/com/fillbook/growthos/ui/screens/VideoStatusScreen.kt")
            .let { if (it.exists()) it else java.io.File("app/src/main/java/com/fillbook/growthos/ui/screens/VideoStatusScreen.kt") }
        check(file.exists()) { "Could not locate VideoStatusScreen.kt from working directory ${java.io.File(".").absolutePath}." }
        return file.readText()
    }

    @Test
    fun `download() checks the guard and adds this render's id before enqueuing`() {
        val source = screenSource()
        val downloadFnIndex = source.indexOf("fun download(render: VideoRenderStatus) {")
        check(downloadFnIndex >= 0) { "Could not find the download() function -- has it been renamed or restructured?" }

        val enqueueIndex = source.indexOf("downloadManager.enqueue(request)", downloadFnIndex)
        check(enqueueIndex >= 0) { "Could not find the enqueue() call inside download()." }

        val window = source.substring(downloadFnIndex, enqueueIndex)
        check(window.contains("if (render.id in downloadingIds) return")) {
            "Expected download() to bail out early when this render's id is already in downloadingIds -- " +
                "otherwise a rapid double-tap can start two downloads for the same render."
        }
        check(window.contains("downloadingIds = downloadingIds + render.id")) {
            "Expected download() to add render.id to downloadingIds before calling enqueue() -- otherwise " +
                "the button never shows a busy/disabled state while the download is starting."
        }
    }

    @Test
    fun `the guard is released when enqueue fails, so a failed start never leaves the button stuck disabled`() {
        val source = screenSource()
        val enqueueIndex = source.indexOf("downloadManager.enqueue(request)")
        check(enqueueIndex >= 0)
        val afterEnqueue = source.substring(enqueueIndex, minOf(enqueueIndex + 400, source.length))
        check(afterEnqueue.contains("downloadingIds = downloadingIds - render.id")) {
            "Expected the id == null (enqueue failed) branch to release the guard (downloadingIds - " +
                "render.id) -- otherwise a failed enqueue leaves the Download button permanently disabled."
        }
    }

    @Test
    fun `the guard is released in the completion receiver, covering both the success and failure-or-cancellation branches`() {
        val source = screenSource()
        val onReceiveIndex = source.indexOf("override fun onReceive(")
        check(onReceiveIndex >= 0) { "Could not find the download-completion BroadcastReceiver's onReceive()." }

        // Bounded window covering the whole onReceive body (success branch,
        // failure/cancellation branch, and the shared cleanup after both).
        val window = source.substring(onReceiveIndex, minOf(onReceiveIndex + 2200, source.length))
        check(window.contains("downloadingIds = downloadingIds - videoRenderId")) {
            "Expected the completion receiver to release this render's id from downloadingIds after handling " +
                "the result -- otherwise the Download button stays disabled forever once a real download " +
                "actually completes (or is cancelled/fails)."
        }
    }
}
