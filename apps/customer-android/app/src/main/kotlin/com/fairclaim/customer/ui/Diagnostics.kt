@file:OptIn(PublicPreviewAPI::class)

package com.fairclaim.customer.ui

import com.fairclaim.customer.AppGraph
import com.fairclaim.customer.ai.CLOUD_MODEL
import com.fairclaim.customer.ai.wire
import com.google.firebase.Firebase
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.appcheck.appCheck
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Day-1 go / no-go tests on the phone (PLAN §13): T0 = App Check + one cloud call works,
 * T1 = an on-device call reports inferenceSource ON_DEVICE. Text prompts only, nothing stored.
 */
object Diagnostics {
    suspend fun run(g: AppGraph): List<String> {
        val out = mutableListOf<String>()
        out += try {
            val t = Firebase.appCheck.getAppCheckToken(false).await()
            val mins = (t.expireTimeMillis - System.currentTimeMillis()) / 60_000
            "✓ App Check token (${g.appCheckProvider}), valid ~$mins min"
        } catch (e: Exception) {
            "✗ App Check: ${e.message}" + if (g.appCheckProvider == "debug") " (register the debug token printed in logcat)" else " (check the Play Integrity / outside-Play settings)"
        }
        out += try {
            val r = withTimeoutOrNull(45_000) { g.ai.cloud.generateContent("Reply with the single word OK.") }
            if (r == null) "✗ T0 cloud call timed out" else "✓ T0 cloud ($CLOUD_MODEL): \"${r.text?.trim()?.take(20)}\" · ${wire(r.inferenceSource)}"
        } catch (e: Exception) {
            "✗ T0 cloud call: ${e.message}"
        }
        val state = g.deviceModel.refresh()
        out += "On-device model: ${state::class.simpleName}" + (g.deviceModel.modelName()?.let { " ($it)" } ?: "")
        out += try {
            val r = withTimeoutOrNull(60_000) { g.ai.onDeviceOnly.generateContent("Reply with the single word OK.") }
            if (r == null) "✗ T1 on-device call timed out" else "✓ T1 on-device: \"${r.text?.trim()?.take(20)}\" · ${wire(r.inferenceSource)}"
        } catch (e: Exception) {
            "✗ T1 on-device unavailable on this phone: ${e.message?.take(160)} (the app uses the cloud)"
        }
        return out
    }
}
