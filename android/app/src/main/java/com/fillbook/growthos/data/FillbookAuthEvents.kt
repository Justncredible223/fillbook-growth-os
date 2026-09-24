package com.fillbook.growthos.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** The outcome of the latest Google sign-in round trip, so the Fillbook Stats screen can react when the browser returns. */
data class OAuthOutcome(val succeeded: Boolean, val errorMessage: String?, val sequence: Long)

object FillbookAuthEvents {
    private val _latest = MutableStateFlow<OAuthOutcome?>(null)
    val latest: StateFlow<OAuthOutcome?> = _latest

    fun publish(succeeded: Boolean, errorMessage: String?) {
        _latest.value = OAuthOutcome(succeeded, errorMessage, (_latest.value?.sequence ?: 0) + 1)
    }
}
