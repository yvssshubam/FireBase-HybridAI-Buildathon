@file:OptIn(PublicPreviewAPI::class)

package com.fairclaim.customer.ai

import android.graphics.Bitmap
import com.fairclaim.engine.ModelKind
import com.google.firebase.Firebase
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerateObjectResponse
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.JsonSchema
// TODO(verify): PublicPreviewAPI lives in com.google.firebase.ai.type in firebase-ai 18.2.0 (docs show only @OptIn(PublicPreviewAPI::class)).
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import com.fairclaim.engine.InferenceSource as WireSource
import com.google.firebase.ai.InferenceSource as SdkSource

// Every model call of the app goes through Firebase AI Logic (firebase-ai + firebase-ai-ondevice);
// no API keys, no REST, no other provider. API shapes per firebase.google.com/docs/ai-logic/hybrid/
// android/{get-started, generate-structured-output} and the GenerativeModel reference (Nov 2026):
//   Firebase.ai(backend, useLimitedUseAppCheckTokens).generativeModel(modelName, onDeviceConfig = OnDeviceConfig(mode))
//   generateObject(schema, content { image(bitmap); text(prompt) }) → GenerateObjectResponse<T>
//   response.response.text (raw JSON) / response.response.inferenceSource (ON_DEVICE | IN_CLOUD)

/** Cloud model, the same as the restaurant web app (Gemini 2.5 models were shut down in Oct 2026). */
const val CLOUD_MODEL = "gemini-3.5-flash-lite"

class FairClaimAi {
    // Limited-use App Check tokens: ready for AI Logic replay protection (PLAN §22.1 L3).
    private val ai = Firebase.ai(backend = GenerativeBackend.googleAI(), useLimitedUseAppCheckTokens = true)

    /** Photo checks: Gemini Nano when this phone has it, else the cloud model. */
    val hybrid: GenerativeModel = ai.generativeModel(
        modelName = CLOUD_MODEL,
        onDeviceConfig = OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE),
    )

    /** The retry path, and the Review (JSON only, never images). */
    val cloud: GenerativeModel = ai.generativeModel(
        modelName = CLOUD_MODEL,
        onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
    )

    /** For the diagnostics panel's on-device test only. */
    val onDeviceOnly: GenerativeModel = ai.generativeModel(
        modelName = CLOUD_MODEL,
        onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_ON_DEVICE),
    )

    private val json = Json { encodeDefaults = true }

    private fun <T : Any> photoCall(model: GenerativeModel, schema: JsonSchema<T>, serializer: KSerializer<T>, prompt: String, image: Bitmap) = Generate {
        val r = model.generateObject(schema, content { image(image); text(prompt) })
        Generation(rawJson(r, serializer), wire(r.response.inferenceSource))
    }

    private fun <T : Any> rawJson(r: GenerateObjectResponse<T>, serializer: KSerializer<T>): String =
        // The raw text is what gets validated; the typed object is only a fallback if the SDK returned no text.
        r.response.text ?: r.getObject()?.let { json.encodeToString(serializer, it) } ?: ""

    // TODO(verify): KSP (firebase-ai-ksp-processor 17.0.0) generates `X.firebaseAISchema()` in the same package as X;
    // if it lands elsewhere, add that import. Docs: generate-structured-output (2026-11-18).
    private suspend fun photoCheck(kind: ModelKind, prompt: String, image: Bitmap): CheckResult = when (kind) {
        ModelKind.HANDOFF -> runCheck(kind, photoCall(hybrid, HandoffOut.firebaseAISchema(), HandoffOut.serializer(), prompt, image),
            photoCall(cloud, HandoffOut.firebaseAISchema(), HandoffOut.serializer(), prompt, image), ::classifyAiError)
        ModelKind.CHALLENGE -> runCheck(kind, photoCall(hybrid, ChallengeOut.firebaseAISchema(), ChallengeOut.serializer(), prompt, image),
            photoCall(cloud, ChallengeOut.firebaseAISchema(), ChallengeOut.serializer(), prompt, image), ::classifyAiError)
        ModelKind.DAMAGE -> runCheck(kind, photoCall(hybrid, DamageOut.firebaseAISchema(), DamageOut.serializer(), prompt, image),
            photoCall(cloud, DamageOut.firebaseAISchema(), DamageOut.serializer(), prompt, image), ::classifyAiError)
        else -> error("$kind is not a photo check")
    }

    /** Flow B: sealed bag at the door. */
    suspend fun handoffCheck(photo: Bitmap) = photoCheck(ModelKind.HANDOFF, HANDOFF_PROMPT, photo)

    /** Flow C: full claim frame (code, fingers, seal, screen suspicion). */
    suspend fun challengeCheck(frame: Bitmap) = photoCheck(ModelKind.CHALLENGE, CHALLENGE_PROMPT, frame)

    /** Flow C: the tap crop (item, damage, severity). */
    suspend fun damageCheck(crop: Bitmap) = photoCheck(ModelKind.DAMAGE, DAMAGE_PROMPT, crop)

    /** Flow D: cloud only, JSON in, two attempts. */
    suspend fun review(prompt: String): CheckResult {
        val call = Generate {
            val r = cloud.generateObject(ReviewOut.firebaseAISchema(), prompt)
            Generation(rawJson(r, ReviewOut.serializer()), wire(r.response.inferenceSource))
        }
        return runCheck(ModelKind.REVIEW, hybrid = call, cloud = call, classify = ::classifyAiError)
    }
}

fun wire(source: SdkSource?): WireSource = if (source == SdkSource.ON_DEVICE) WireSource.ON_DEVICE else WireSource.IN_CLOUD

/**
 * AICore's per-app limits surface as ML Kit GenAiException codes BUSY (9) and
 * PER_APP_BATTERY_USE_QUOTA_EXCEEDED (27), wrapped by the SDK.
 * TODO(verify): the exact exception class/field firebase-ai-ondevice 16.0.0-beta08 uses for the code;
 * until then this matches the code names or numbers anywhere in the cause chain's messages.
 */
fun classifyAiError(t: Throwable): ErrorClass {
    val text = generateSequence(t) { it.cause }.take(6).joinToString(" | ") { "${it::class.java.name}: ${it.message}" }
    return when {
        Regex("PER_APP_BATTERY_USE_QUOTA_EXCEEDED|error ?code[ =:]*27\\b", RegexOption.IGNORE_CASE).containsMatchIn(text) -> ErrorClass.QUOTA
        Regex("\\bBUSY\\b|error ?code[ =:]*9\\b", RegexOption.IGNORE_CASE).containsMatchIn(text) -> ErrorClass.BUSY
        // Gemini cloud overload: "This model is currently experiencing high demand" (HTTP 503 / UNAVAILABLE).
        Regex("high demand|overloaded|\\bUNAVAILABLE\\b|\\b503\\b|ServiceUnavailable", RegexOption.IGNORE_CASE).containsMatchIn(text) -> ErrorClass.OVERLOADED
        else -> ErrorClass.OTHER
    }
}
