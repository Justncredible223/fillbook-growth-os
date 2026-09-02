package com.fillbook.growthos.data

import android.content.Context
import android.os.Build
import android.util.Log
import com.fillbook.growthos.BuildConfig
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.Executors
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Global crash visibility this app had none of before: every uncaught
 * exception gets written to a local file (survives even if the network
 * report below fails or there's no connection to send it over) and,
 * best-effort, POSTed to /api/client-error so it shows up in `vercel
 * logs` instead of only ever being visible if someone happens to be
 * looking at a connected debugger when it happens. Deliberately not a
 * third-party SDK (Crashlytics/Sentry) -- this needs no new account, no
 * new paid tier, and reuses the backend that already exists.
 */
object CrashReporter {
    private const val TAG = "CrashReporter"
    private val executor = Executors.newSingleThreadExecutor()

    fun install(context: Context, baseUrl: String, protectionBypassSecret: String, tokenStore: TokenStore) {
        val appContext = context.applicationContext
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val stackTrace = StringWriter().also { throwable.printStackTrace(PrintWriter(it)) }.toString()
                writeToLocalFile(appContext, throwable.message, stackTrace)
                reportBestEffort(baseUrl, protectionBypassSecret, tokenStore, throwable.message, stackTrace)
            } catch (loggingFailure: Exception) {
                Log.e(TAG, "Failed while reporting a crash", loggingFailure)
            }
            previousHandler?.uncaughtException(thread, throwable)
        }
    }

    private fun writeToLocalFile(context: Context, message: String?, stackTrace: String) {
        val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(java.util.Date())
        val file = File(context.filesDir, "last_crash.txt")
        file.writeText("Time: $timestamp\nMessage: ${message ?: "(none)"}\n\n$stackTrace")
    }

    /** Fire-and-forget: a crash report failing to upload must never itself crash the crash handler. */
    private fun reportBestEffort(baseUrl: String, protectionBypassSecret: String, tokenStore: TokenStore, message: String?, stackTrace: String) {
        val token = tokenStore.getToken() ?: return
        executor.execute {
            try {
                val body = JSONObject()
                    .put("message", message ?: "(no message)")
                    .put("stackTrace", stackTrace)
                    .put("appVersion", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                    .put("deviceInfo", "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}")
                    .put("occurredAt", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(java.util.Date()))

                val request = Request.Builder()
                    .url("$baseUrl/api/client-error")
                    .header("x-vercel-protection-bypass", protectionBypassSecret)
                    .header("x-vercel-set-bypass-cookie", "true")
                    .header("Authorization", "Bearer $token")
                    .post(body.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                OkHttpClient().newCall(request).execute().close()
            } catch (uploadFailure: Exception) {
                Log.e(TAG, "Failed to upload crash report", uploadFailure)
            }
        }
    }
}
