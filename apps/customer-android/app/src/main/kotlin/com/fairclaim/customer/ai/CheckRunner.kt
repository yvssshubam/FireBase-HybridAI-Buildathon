package com.fairclaim.customer.ai

import com.fairclaim.engine.InferenceSource
import com.fairclaim.engine.ModelKind
import com.fairclaim.engine.ModelParse
import com.fairclaim.engine.parseModelOutput
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject

// One model check: attempt → parseModelOutput validation → one retry → clear failure.
// Never invents data: a failed check is reported as failed and the UI asks for a retake.
//
// Attempt order (PREFER_ON_DEVICE does not fall back to the cloud once it picked the on-device
// model and that errors, so the retry goes to a separate ONLY_IN_CLOUD model, as on the web):
//   1. hybrid (PREFER_ON_DEVICE). AICore BUSY → exponential backoff, at most [busyRetries] more
//      on-device tries; per-app battery quota → straight to the cloud.
//   2. cloud (ONLY_IN_CLOUD), once, for an invalid answer or any other error. A cloud overload
//      ("high demand", HTTP 503) is temporary, so it waits and tries the cloud again, at most
//      [CheckPolicy.cloudOverloadRetries] more times; calling straight back usually hits the same spike.

/** Raw answer of one model call: the JSON text and where it ran. */
data class Generation(val text: String, val source: InferenceSource)

fun interface Generate {
    suspend fun run(): Generation
}

enum class ErrorClass { BUSY, QUOTA, OVERLOADED, OTHER }

data class AttemptLog(val source: InferenceSource?, val error: String)

sealed interface CheckResult {
    data class Ok(val json: JsonObject, val source: InferenceSource, val attempts: Int, val failures: List<AttemptLog>) : CheckResult
    data class Failed(val failures: List<AttemptLog>) : CheckResult
}

class CheckPolicy(
    val hybridTimeoutMs: Long = 60_000,
    val cloudTimeoutMs: Long = 45_000,
    val busyRetries: Int = 2,
    val busyBackoffMs: Long = 800,
    val cloudOverloadRetries: Int = 1,
    val cloudOverloadBackoffMs: Long = 2_000,
)

suspend fun runCheck(
    kind: ModelKind,
    hybrid: Generate?,
    cloud: Generate,
    classify: (Throwable) -> ErrorClass,
    policy: CheckPolicy = CheckPolicy(),
    sleep: suspend (Long) -> Unit = { delay(it) },
): CheckResult {
    val failures = mutableListOf<AttemptLog>()
    var attempts = 0

    suspend fun attempt(g: Generate, timeoutMs: Long): Pair<Generation?, Throwable?> {
        attempts++
        return try {
            val out = withTimeoutOrNull(timeoutMs) { g.run() }
            if (out == null) null to ModelTimeout(timeoutMs) else out to null
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            null to e
        }
    }

    fun validate(out: Generation): CheckResult.Ok? = when (val p = parseModelOutput(kind, out.text)) {
        is ModelParse.Ok -> CheckResult.Ok(p.json, out.source, attempts, failures.toList())
        is ModelParse.Err -> {
            failures += AttemptLog(out.source, "invalid model output (${p.error}${if (p.detail.isEmpty()) "" else ": ${p.detail}"})")
            null
        }
    }

    fun overloaded(e: Throwable) = e !is ModelTimeout && classify(e) == ErrorClass.OVERLOADED
    // On a phone without the on-device model the hybrid call also ran in the cloud, so an overload there
    // means the cloud attempt below should wait first.
    var waitBeforeCloud = false

    if (hybrid != null) {
        var busyLeft = policy.busyRetries
        var backoff = policy.busyBackoffMs
        while (true) {
            val (out, err) = attempt(hybrid, policy.hybridTimeoutMs)
            if (out != null) {
                validate(out)?.let { return it }
                break
            }
            val e = requireNotNull(err)
            failures += AttemptLog(null, e.message ?: e::class.simpleName ?: "error")
            waitBeforeCloud = overloaded(e)
            if (e !is ModelTimeout && classify(e) == ErrorClass.BUSY && busyLeft > 0) {
                busyLeft--
                sleep(backoff)
                backoff *= 2
                continue
            }
            break
        }
    }

    var overloadLeft = policy.cloudOverloadRetries
    var wait = policy.cloudOverloadBackoffMs
    while (true) {
        if (waitBeforeCloud) {
            sleep(wait)
            wait *= 2
        }
        val (out, err) = attempt(cloud, policy.cloudTimeoutMs)
        if (out != null) {
            validate(out)?.let { return it }
            break
        }
        val e = requireNotNull(err)
        failures += AttemptLog(InferenceSource.IN_CLOUD, e.message ?: e::class.simpleName ?: "error")
        if (overloaded(e) && overloadLeft > 0) {
            overloadLeft--
            waitBeforeCloud = true
            continue
        }
        break
    }
    return CheckResult.Failed(failures.toList())
}

class ModelTimeout(ms: Long) : Exception("model did not answer within ${ms / 1000} s")

/** Short, user-facing reason for a failed check (the full log stays in the debug panel). */
fun CheckResult.Failed.summary(): String {
    val last = failures.lastOrNull()?.error ?: "no answer"
    return when {
        last.contains("App Check", ignoreCase = true) || last.contains("403") -> "The app couldn't prove it is genuine (App Check). Try again in a moment."
        last.startsWith("invalid model output") -> "The answer didn't make sense. Please retake the photo."
        last.contains("did not answer") -> "The check took too long. Please try again."
        last.contains("high demand", ignoreCase = true) || last.contains("overloaded", ignoreCase = true) ->
            "Gemini is busy right now. Wait a minute and try again."
        else -> "The check failed: ${last.take(140)}"
    }
}
