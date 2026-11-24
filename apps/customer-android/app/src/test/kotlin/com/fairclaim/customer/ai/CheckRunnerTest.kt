package com.fairclaim.customer.ai

import com.fairclaim.engine.InferenceSource
import com.fairclaim.engine.ModelKind
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CheckRunnerTest {
    private val good = """{"seal_state":"intact","seal_code_read":"4721","confidence":"high"}"""
    private val busy = RuntimeException("AICore error BUSY (9)")

    private class Script(private val steps: List<() -> Generation>) : Generate {
        var calls = 0
        override suspend fun run(): Generation = steps[calls++].invoke()
    }

    private fun gen(text: String, src: InferenceSource) = { Generation(text, src) }
    private fun fail(e: Exception): () -> Generation = { throw e }
    private val classify: (Throwable) -> ErrorClass = {
        when {
            it.message?.contains("BUSY") == true -> ErrorClass.BUSY
            it.message?.contains("QUOTA") == true -> ErrorClass.QUOTA
            it.message?.contains("high demand") == true -> ErrorClass.OVERLOADED
            else -> ErrorClass.OTHER
        }
    }
    private val sleeps = mutableListOf<Long>()
    private val fastSleep: suspend (Long) -> Unit = { sleeps += it }

    @Test
    fun firstValidAnswerWins() = runBlocking {
        val hybrid = Script(listOf(gen("```json\n$good\n```", InferenceSource.ON_DEVICE)))
        val cloud = Script(emptyList())
        val r = runCheck(ModelKind.HANDOFF, hybrid, cloud, classify, sleep = fastSleep) as CheckResult.Ok
        assertEquals(InferenceSource.ON_DEVICE, r.source)
        assertEquals(1, r.attempts)
        assertEquals(0, cloud.calls)
        assertEquals("""{"seal_state":"intact","seal_code_read":"4721","confidence":"high"}""", r.json.toString())
    }

    @Test
    fun invalidAnswerGetsOneCloudRetry() = runBlocking {
        val hybrid = Script(listOf(gen("""{"seal_state":"sealed"}""", InferenceSource.ON_DEVICE)))
        val cloud = Script(listOf(gen(good, InferenceSource.IN_CLOUD)))
        val r = runCheck(ModelKind.HANDOFF, hybrid, cloud, classify, sleep = fastSleep) as CheckResult.Ok
        assertEquals(InferenceSource.IN_CLOUD, r.source)
        assertEquals(2, r.attempts)
        assertTrue(r.failures.single().error.startsWith("invalid model output"))
    }

    @Test
    fun busyBacksOffExponentiallyThenFallsBackToCloud() = runBlocking {
        val hybrid = Script(listOf(fail(busy), fail(busy), fail(busy)))
        val cloud = Script(listOf(gen(good, InferenceSource.IN_CLOUD)))
        val r = runCheck(ModelKind.HANDOFF, hybrid, cloud, classify, CheckPolicy(busyRetries = 2, busyBackoffMs = 800), fastSleep) as CheckResult.Ok
        assertEquals(3, hybrid.calls)
        assertEquals(listOf(800L, 1600L), sleeps)
        assertEquals(InferenceSource.IN_CLOUD, r.source)
    }

    @Test
    fun busyThenSuccessStaysOnDevice() = runBlocking {
        val hybrid = Script(listOf(fail(busy), gen(good, InferenceSource.ON_DEVICE)))
        val r = runCheck(ModelKind.HANDOFF, hybrid, Script(emptyList()), classify, sleep = fastSleep) as CheckResult.Ok
        assertEquals(InferenceSource.ON_DEVICE, r.source)
        assertEquals(listOf(800L), sleeps)
    }

    @Test
    fun batteryQuotaGoesStraightToTheCloud() = runBlocking {
        val hybrid = Script(listOf(fail(RuntimeException("PER_APP_BATTERY_USE_QUOTA_EXCEEDED"))))
        val cloud = Script(listOf(gen(good, InferenceSource.IN_CLOUD)))
        runCheck(ModelKind.HANDOFF, hybrid, cloud, { ErrorClass.QUOTA }, sleep = fastSleep) as CheckResult.Ok
        assertEquals(1, hybrid.calls)
        assertTrue(sleeps.isEmpty())
    }

    @Test
    fun everythingFailingIsAFailureNotData() = runBlocking {
        val hybrid = Script(listOf(gen("I can't see a bag", InferenceSource.ON_DEVICE)))
        val cloud = Script(listOf(fail(RuntimeException("App Check token is invalid"))))
        val r = runCheck(ModelKind.HANDOFF, hybrid, cloud, classify, sleep = fastSleep) as CheckResult.Failed
        assertEquals(2, r.failures.size)
        assertTrue(r.summary().contains("App Check"))
    }

    @Test
    fun aHangingModelTimesOut() = runBlocking {
        val hanging = Generate { delay(10_000); Generation(good, InferenceSource.ON_DEVICE) }
        val cloud = Script(listOf(gen(good, InferenceSource.IN_CLOUD)))
        val r = runCheck(ModelKind.HANDOFF, hanging, cloud, classify, CheckPolicy(hybridTimeoutMs = 50), fastSleep) as CheckResult.Ok
        assertEquals(InferenceSource.IN_CLOUD, r.source)
        assertTrue(r.failures.single().error.contains("did not answer"))
    }

    private val overload = RuntimeException("This model is currently experiencing high demand.")

    @Test
    fun cloudOverloadWaitsAndRetries() = runBlocking {
        // Emulator / no on-device model: the hybrid call ran in the cloud and hit the spike too.
        val hybrid = Script(listOf(fail(overload)))
        val cloud = Script(listOf(fail(overload), gen(good, InferenceSource.IN_CLOUD)))
        val r = runCheck(ModelKind.HANDOFF, hybrid, cloud, classify, sleep = fastSleep) as CheckResult.Ok
        assertEquals(2, cloud.calls)
        assertEquals(listOf(2_000L, 4_000L), sleeps)
        assertEquals(InferenceSource.IN_CLOUD, r.source)
    }

    @Test
    fun persistentOverloadIsAFailureWithAClearMessage() = runBlocking {
        val hybrid = Script(listOf(fail(overload)))
        val cloud = Script(listOf(fail(overload), fail(overload), fail(overload)))
        val r = runCheck(ModelKind.HANDOFF, hybrid, cloud, classify, sleep = fastSleep) as CheckResult.Failed
        assertEquals(2, cloud.calls) // one retry, not an endless loop
        assertEquals(3, r.failures.size)
        assertTrue(r.summary().startsWith("Gemini is busy"))
    }

    @Test
    fun otherCloudErrorsDoNotWait() = runBlocking {
        val hybrid = Script(listOf(gen("nonsense", InferenceSource.ON_DEVICE)))
        val cloud = Script(listOf(fail(RuntimeException("400 bad request"))))
        runCheck(ModelKind.HANDOFF, hybrid, cloud, classify, sleep = fastSleep) as CheckResult.Failed
        assertEquals(1, cloud.calls)
        assertTrue(sleeps.isEmpty())
    }

    @Test
    fun cloudOnlyReviewRetriesOnce() = runBlocking {
        val review = """{"consistent":true,"flags":[],"explanation_customer_en":"ok","explanation_customer_hi":"","explanation_customer_ta":"","explanation_restaurant":"ok"}"""
        val cloud = Script(listOf(fail(RuntimeException("503")), gen(review, InferenceSource.IN_CLOUD)))
        val r = runCheck(ModelKind.REVIEW, cloud, cloud, classify, sleep = fastSleep) as CheckResult.Ok
        assertEquals(2, cloud.calls)
        assertEquals(InferenceSource.IN_CLOUD, r.source)
    }
}
