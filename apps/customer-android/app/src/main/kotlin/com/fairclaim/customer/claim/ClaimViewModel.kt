package com.fairclaim.customer.claim

import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fairclaim.customer.AppGraph
import com.fairclaim.customer.ai.CheckResult
import com.fairclaim.customer.ai.summary
import com.fairclaim.customer.camera.CameraHandle
import com.fairclaim.customer.camera.PointF
import com.fairclaim.customer.camera.Still
import com.fairclaim.customer.camera.cropAround
import com.fairclaim.customer.camera.cropped
import com.fairclaim.customer.camera.jpegUnder
import com.fairclaim.customer.camera.moireScore
import com.fairclaim.customer.camera.scaledToMax
import com.fairclaim.customer.camera.sha256Hex
import com.fairclaim.customer.camera.viewToImage
import com.fairclaim.customer.data.ClaimEvidence
import com.fairclaim.customer.data.OrderDoc
import com.fairclaim.customer.data.OrderStatus
import com.fairclaim.customer.data.RateLimitDoc
import com.fairclaim.customer.data.Repository
import com.fairclaim.customer.data.challengeDoc
import com.fairclaim.customer.data.claimDoc
import com.fairclaim.customer.data.newId
import com.fairclaim.customer.data.randomFingers
import com.fairclaim.customer.data.rateLimitDoc
import com.fairclaim.customer.firebase.LoadedPolicy
import com.fairclaim.engine.InferenceSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive

// Flow C, the claim, in the order dev/customer-sim.ts proved against the rules:
//   issue type + item(s) → challenges/{claimId} (server issuedAt) → random fingers 1–3 →
//   live capture with a countdown → tap the item → crop → ChallengeCheck (full frame) +
//   DamageCheck (crop; not for missing items) + FFT moiré (off the main thread) →
//   crop JPEG < 300 KB + SHA-256 → upload → claims + rateLimits + claimsByOrder batch →
//   decision (DecisionRunner).

enum class StageState { PENDING, RUNNING, DONE, FAILED, SKIPPED }

data class Stage(val label: String, val state: StageState = StageState.PENDING, val source: InferenceSource? = null, val note: String? = null)

sealed interface ClaimUi {
    data object Loading : ClaimUi
    data class Blocked(val message: String, val claimId: String? = null) : ClaimUi
    data class Setup(val order: OrderDoc, val hasHandoff: Boolean, val issueType: String?, val selected: Set<String>) : ClaimUi
    data class Waiting(val secondsLeft: Int) : ClaimUi
    data class Preparing(val text: String) : ClaimUi
    data class Camera(val fingers: Int, val issueType: String, val note: String?) : ClaimUi
    data class Tap(val photo: Bitmap, val issueType: String, val itemName: String, val error: String?) : ClaimUi
    data class Working(val stages: List<Stage>) : ClaimUi
    /** The checks ran but something will likely send the claim to review; the customer may retake while time is left. */
    data class Warnings(val stages: List<Stage>, val warnings: List<String>, val canRetake: Boolean) : ClaimUi
    data class Failed(val message: String, val stages: List<Stage>, val canRetake: Boolean) : ClaimUi
    data class Submitted(val claimId: String, val decisionError: String?) : ClaimUi
}

val ISSUE_TYPES = listOf("damaged" to "Damaged or spilled", "missing" to "Missing item", "wrong_item" to "Wrong item")

class ClaimViewModel(private val g: AppGraph, private val uid: String, private val orderId: String, private val policy: LoadedPolicy) : ViewModel() {
    private val _ui = MutableStateFlow<ClaimUi>(ClaimUi.Loading)
    val ui: StateFlow<ClaimUi> = _ui.asStateFlow()

    /** Countdown shown on the camera (policy.challengeWindowSec from the server's issuedAt). */
    private val _remainingMs = MutableStateFlow(0L)
    val remainingMs: StateFlow<Long> = _remainingMs.asStateFlow()

    val camera = CameraHandle()
    private val runner = DecisionRunner(g.repo, g.ai, g.reasons)

    private var order: OrderDoc? = null
    private var hasHandoff = false
    private var issueType: String? = null
    private var selected: Set<String> = emptySet()
    private var rateLimit: RateLimitDoc? = null

    private var claimId: String? = null
    private var fingers = 0
    private var clock: ChallengeClock? = null
    private var still: Still? = null
    private var crop: Bitmap? = null
    private var stages: List<Stage> = emptyList()
    private var challengeResult: CheckResult.Ok? = null
    private var damageResult: CheckResult.Ok? = null
    private var moire: Double = 0.0
    private var ticker: Job? = null

    init {
        load()
    }

    private fun setup() = ClaimUi.Setup(requireNotNull(order), hasHandoff, issueType, selected)

    fun load() {
        viewModelScope.launch {
            _ui.value = ClaimUi.Loading
            try {
                val o = g.repo.order(orderId)
                order = o
                val existing = g.repo.myClaimsOnce(uid).firstOrNull { it.orderId == orderId }
                _ui.value = when {
                    o == null -> ClaimUi.Blocked("Order not found.")
                    existing != null -> ClaimUi.Blocked("This order already has a claim (one claim per order).", existing.claimId)
                    !o.claimable -> ClaimUi.Blocked("You can report a problem once the restaurant has dispatched the order.")
                    else -> {
                        hasHandoff = g.repo.handoffOnce(orderId) != null
                        setup()
                    }
                }
                g.deviceModel.warmUp()
            } catch (e: Exception) {
                _ui.value = ClaimUi.Blocked("Couldn't load the order: ${e.message}")
            }
        }
    }

    fun chooseIssue(type: String) {
        issueType = type
        // Damaged / wrong item: exactly one item (the tapped one); missing: one or more (engine selectedItemsValid).
        if (type != "missing" && selected.size > 1) selected = emptySet()
        _ui.value = setup()
    }

    fun toggleItem(id: String) {
        selected = when {
            id in selected -> selected - id
            issueType == "missing" -> selected + id
            else -> setOf(id)
        }
        _ui.value = setup()
    }

    val canStart: Boolean get() = issueType != null && selected.isNotEmpty() && (issueType == "missing" || selected.size == 1)

    /** Rate-limit checks, then the server-clock challenge. */
    fun startChallenge() {
        val o = order ?: return
        if (!canStart) return
        viewModelScope.launch {
            try {
                _ui.value = ClaimUi.Preparing("Checking your claim limits")
                val rl = g.repo.rateLimit(uid)
                rateLimit = rl
                // Device clock only for this early hint; the binding checks below use server time.
                val deviceNow = System.currentTimeMillis()
                if (dailyLimitReached(rl, deviceNow)) {
                    _ui.value = ClaimUi.Blocked("You've made 5 claims today, the daily limit. Try again tomorrow (UTC).")
                    return@launch
                }
                var wait = waitForIntervalMs(rl, deviceNow)
                while (wait > 0) { // one claim per 30 s: wait before the challenge so the 120 s window isn't spent waiting
                    _ui.value = ClaimUi.Waiting(((wait + 999) / 1000).toInt())
                    delay(minOf(wait, 1000))
                    wait -= 1000
                }
                _ui.value = ClaimUi.Preparing("Getting your live challenge")
                if (o.status == OrderStatus.DISPATCHED) g.repo.markDelivered(o.id)

                val id = newId("c")
                val f = randomFingers()
                val anchor = SystemClock.elapsedRealtime() // before the write, see ChallengeClock
                g.repo.createChallenge(id, challengeDoc(uid, o, f))
                val issuedAt = g.repo.challengeIssuedAt(id)
                if (dailyLimitReached(rl, issuedAt)) {
                    _ui.value = ClaimUi.Blocked("You've made 5 claims today, the daily limit. Try again tomorrow (UTC).")
                    return@launch
                }
                claimId = id
                fingers = f
                clock = ChallengeClock(issuedAt, anchor, policy.policy.challengeWindowSec)
                g.deviceModel.warmUp()
                showCamera(null)
            } catch (e: Exception) {
                Log.w(TAG, "challenge failed", e)
                _ui.value = ClaimUi.Failed("Couldn't start the challenge: ${e.message}", emptyList(), canRetake = false)
            }
        }
    }

    private fun showCamera(note: String?) {
        val c = clock ?: return
        _ui.value = ClaimUi.Camera(fingers, requireNotNull(issueType), note)
        ticker?.cancel()
        ticker = viewModelScope.launch {
            while (isActive) {
                _remainingMs.value = c.windowRemainingMs(SystemClock.elapsedRealtime())
                delay(250)
            }
        }
    }

    fun shoot() {
        val c = clock ?: return
        if (c.windowRemainingMs(SystemClock.elapsedRealtime()) <= 0) {
            _ui.value = ClaimUi.Failed("Time's up for this challenge. Start again for a new one.", emptyList(), canRetake = false)
            return
        }
        viewModelScope.launch {
            try {
                val s = camera.takeStill()
                ticker?.cancel()
                still = s
                if (issueType == "missing") {
                    crop = null
                    runChecks()
                } else {
                    _ui.value = ClaimUi.Tap(s.bitmap, requireNotNull(issueType), itemName(), null)
                }
            } catch (e: Exception) {
                showCamera("The camera failed: ${e.message}. Try again.")
            }
        }
    }

    private fun itemName(): String = order?.items?.firstOrNull { it.id in selected }?.name ?: "the item"

    /** Tap on the still (view coordinates of the Fit-scaled image). */
    fun tap(point: PointF, viewW: Float, viewH: Float) {
        val s = still ?: return
        val p = viewToImage(point, viewW, viewH, s.bitmap.width, s.bitmap.height)
        if (p == null) {
            _ui.value = ClaimUi.Tap(s.bitmap, requireNotNull(issueType), itemName(), "Tap on the photo, on the item itself.")
            return
        }
        crop = s.bitmap.cropped(cropAround(p, s.bitmap.width, s.bitmap.height))
        runChecks()
    }

    private fun publish(i: Int, st: Stage) {
        stages = stages.toMutableList().also { it[i] = st }
        _ui.value = ClaimUi.Working(stages)
    }

    private fun runChecks() {
        val s = still ?: return
        val damage = crop
        stages = listOf(
            Stage("Seal code and fingers (full photo)"),
            Stage("Tapped item: damage and severity", if (damage == null) StageState.SKIPPED else StageState.PENDING, note = if (damage == null) "not needed for a missing item" else null),
            Stage("Screen-photo check (FFT, no AI)"),
        )
        _ui.value = ClaimUi.Working(stages)
        viewModelScope.launch {
            try {
                val moireJob = async(Dispatchers.Default) { moireScore(s.bitmap) }
                val frame = withContext(Dispatchers.Default) { s.bitmap.scaledToMax(1024) }

                publish(0, stages[0].copy(state = StageState.RUNNING))
                val ch = g.ai.challengeCheck(frame)
                if (ch is CheckResult.Failed) {
                    publish(0, stages[0].copy(state = StageState.FAILED, note = ch.summary()))
                    return@launch fail(ch.summary())
                }
                ch as CheckResult.Ok
                challengeResult = ch
                publish(0, stages[0].copy(state = StageState.DONE, source = ch.source))

                damageResult = null
                if (damage != null) {
                    publish(1, stages[1].copy(state = StageState.RUNNING))
                    val small = withContext(Dispatchers.Default) { damage.scaledToMax(768) }
                    val dr = g.ai.damageCheck(small)
                    if (dr is CheckResult.Failed) {
                        publish(1, stages[1].copy(state = StageState.FAILED, note = dr.summary()))
                        return@launch fail(dr.summary())
                    }
                    dr as CheckResult.Ok
                    damageResult = dr
                    publish(1, stages[1].copy(state = StageState.DONE, source = dr.source))
                }

                publish(2, stages[2].copy(state = StageState.RUNNING))
                moire = moireJob.await().coerceIn(0.0, 1.0)
                publish(2, stages[2].copy(state = StageState.DONE, note = "score %.2f (limit %.2f)".format(moire, policy.policy.moireThreshold)))

                val warnings = warningsFor(ch.json, damageResult?.json)
                if (warnings.isNotEmpty()) {
                    _ui.value = ClaimUi.Warnings(stages, warnings, canRetake())
                } else {
                    submit()
                }
            } catch (e: Exception) {
                Log.w(TAG, "checks failed", e)
                fail("The checks failed: ${e.message}")
            }
        }
    }

    private fun fail(message: String) {
        _ui.value = ClaimUi.Failed(message, stages, canRetake())
    }

    private fun canRetake(): Boolean {
        val c = clock ?: return false
        return c.windowRemainingMs(SystemClock.elapsedRealtime()) > 3_000
    }

    /** What would send this claim to review, told to the customer before it is submitted. */
    private fun warningsFor(cc: JsonObject, dc: JsonObject?): List<String> {
        val out = mutableListOf<String>()
        val code = cc["seal_code_read"]?.jsonPrimitive?.content.orEmpty()
        if (code.isEmpty()) out += "We couldn't read the 4-digit seal code."
        else if (code != order?.sealCode) out += "The seal code we read ($code) isn't this order's code."
        val seen = cc["fingers_visible"]?.jsonPrimitive?.int ?: 0
        if (seen != fingers) out += "We counted $seen finger(s); the challenge asked for $fingers."
        if (cc["photo_of_screen_suspected"]?.jsonPrimitive?.content == "true") out += "The photo looks like a picture of a screen."
        if (moire >= policy.policy.moireThreshold) out += "The photo shows a screen-like pixel pattern."
        if (cc["confidence"]?.jsonPrimitive?.content == "low") out += "The photo was hard to read (low confidence)."
        if (dc?.get("confidence")?.jsonPrimitive?.content == "low") out += "The tapped item was hard to judge (low confidence)."
        if (issueType == "damaged" && (dc?.get("issue")?.jsonPrimitive?.content == "none" || dc?.get("severity")?.jsonPrimitive?.content == "none")) {
            out += "No damage was visible in the area you tapped."
        }
        return out
    }

    fun retake() {
        if (!canRetake()) {
            _ui.value = ClaimUi.Failed("Time's up for this challenge. Start again for a new one.", stages, canRetake = false)
            return
        }
        still = null
        crop = null
        showCamera(null)
    }

    /** New challenge, same issue and items (nothing was stored for the old one except the challenge itself). */
    fun restart() {
        ticker?.cancel()
        claimId = null
        clock = null
        still = null
        crop = null
        startChallenge()
    }

    fun submitAnyway() = submit()

    private fun submit() {
        val o = order ?: return
        val id = claimId ?: return
        val c = clock ?: return
        val s = still ?: return
        val ch = challengeResult ?: return
        viewModelScope.launch {
            val sub = stages + listOf(Stage("Uploading the crop", if (crop == null) StageState.SKIPPED else StageState.RUNNING), Stage("Saving the claim"), Stage("Decision"))
            stages = sub
            _ui.value = ClaimUi.Working(stages)
            val base = stages.size - 3
            try {
                val jpeg = crop?.let { withContext(Dispatchers.Default) { it.jpegUnder() } }
                val sha = jpeg?.let(::sha256Hex)

                // One claim per 30 s, judged by server time (estimate runs slightly ahead → safe side).
                val wait = waitForIntervalMs(rateLimit, c.serverNow(SystemClock.elapsedRealtime()))
                if (wait > 0) delay(wait)
                if (c.writeRemainingMs(SystemClock.elapsedRealtime()) <= 0) {
                    _ui.value = ClaimUi.Failed("This took too long for the 2-minute server window. Start again for a new challenge.", stages, canRetake = false)
                    return@launch
                }
                if (jpeg != null) {
                    g.repo.uploadCrop(id, jpeg)
                    publish(base, stages[base].copy(state = StageState.DONE, note = "${jpeg.size / 1024} KB"))
                }
                publish(base + 1, stages[base + 1].copy(state = StageState.RUNNING))
                val serverNow = c.serverNow(SystemClock.elapsedRealtime())
                val history = claimsInLast30Days(g.repo.myClaimsOnce(uid).map { it.createdAt }, serverNow)
                val evidence = ClaimEvidence(
                    claimId = id, order = o, customerId = uid, issueType = requireNotNull(issueType), selectedItemIds = selected.toList(),
                    fingers = fingers, issuedAt = c.issuedAt, capturedAt = c.capturedAt(s.shutterElapsed), challengeWindowSec = c.windowSec,
                    challengeCheck = ch.json, damageCheck = damageResult?.json, moireScore = moire, cropSha256 = sha,
                    challengeSource = ch.source.wire, damageSource = damageResult?.source?.wire, customerClaims30d = history,
                )
                g.repo.commitClaim(claimDoc(evidence), rateLimitDoc(nextCountToday(rateLimit, serverNow)), uid)
                publish(base + 1, stages[base + 1].copy(state = StageState.DONE))
            } catch (e: Exception) {
                Log.w(TAG, "claim write failed", e)
                val why = if (Repository.isPermissionDenied(e)) "The server refused the claim (time window or claim limits)." else "Couldn't save the claim: ${e.message}"
                _ui.value = ClaimUi.Failed("$why Start again for a new challenge.", stages, canRetake = false)
                return@launch
            }
            // The claim is stored; a failed decision can be finished later from the order screen.
            publish(base + 2, stages[base + 2].copy(state = StageState.RUNNING))
            val decisionError = try {
                runner.run(id, uid, policy) { step -> publish(base + 2, stages[base + 2].copy(state = StageState.RUNNING, note = step)) }
                null
            } catch (e: Exception) {
                Log.w(TAG, "decision failed", e)
                e.message ?: "decision failed"
            }
            _ui.value = ClaimUi.Submitted(id, decisionError)
        }
    }

    override fun onCleared() {
        ticker?.cancel()
    }

    private companion object {
        const val TAG = "FairClaim/Claim"
    }
}
