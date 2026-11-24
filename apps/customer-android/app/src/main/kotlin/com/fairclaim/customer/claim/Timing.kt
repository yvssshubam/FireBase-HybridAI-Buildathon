package com.fairclaim.customer.claim

import com.fairclaim.customer.data.CLAIM_INTERVAL_MS
import com.fairclaim.customer.data.MAX_CLAIMS_PER_DAY
import com.fairclaim.customer.data.RateLimitDoc
import com.fairclaim.customer.data.SERVER_CLAIM_WINDOW_MS

// All claim timing hangs off the server's challenge issuedAt plus the phone's monotonic clock
// (SystemClock.elapsedRealtime()), never the phone's wall clock, so a wrong clock can't fail an
// honest claim (Decisions: capturedAt). `anchorElapsed` is read just before the challenge write
// is sent, so elapsed times include the write's latency: capturedAt can only come out a little
// late, never earlier than the real shutter press relative to issuedAt.

class ChallengeClock(val issuedAt: Long, val anchorElapsed: Long, val windowSec: Int) {
    /** Server-time estimate for a monotonic reading (slightly ahead of the true server time). */
    fun serverNow(elapsed: Long): Long = issuedAt + (elapsed - anchorElapsed)

    fun capturedAt(shutterElapsed: Long): Long = serverNow(shutterElapsed)

    val expiresAt: Long get() = issuedAt + windowSec * 1000L

    /** What the countdown shows; ≤ 0 means the engine would mark the photo gate_window_expired. */
    fun windowRemainingMs(elapsed: Long): Long = expiresAt - serverNow(elapsed)

    /**
     * Time left for the claim write itself (rules: request.time < issuedAt + 120 s), minus a margin
     * for the crop upload and the batch round trip.
     */
    fun writeRemainingMs(elapsed: Long, marginMs: Long = WRITE_MARGIN_MS): Long =
        issuedAt + SERVER_CLAIM_WINDOW_MS - marginMs - serverNow(elapsed)

    companion object {
        const val WRITE_MARGIN_MS = 8_000L
    }
}

/** UTC day number, as the rules' timestamp.date() compares days. */
fun utcDay(epochMs: Long): Long = Math.floorDiv(epochMs, 86_400_000L)

/**
 * The batch's rateLimits.countToday, computed against server time (issuedAt): the rules
 * compare request.time.date() with lastClaimAt.date(). A claim straddling UTC midnight inside
 * the 120 s window can still be rejected; the app then asks the customer to retry.
 */
fun nextCountToday(rl: RateLimitDoc?, serverNowMs: Long): Int = when {
    rl == null -> 1
    utcDay(rl.lastClaimAt) == utcDay(serverNowMs) -> rl.countToday + 1
    else -> 1
}

fun dailyLimitReached(rl: RateLimitDoc?, serverNowMs: Long): Boolean = nextCountToday(rl, serverNowMs) > MAX_CLAIMS_PER_DAY

/**
 * How long to wait before the claim batch so request.time > lastClaimAt + 30 s holds. Uses the
 * server-time estimate (which runs a little ahead), plus a margin.
 */
fun waitForIntervalMs(rl: RateLimitDoc?, serverNowMs: Long, marginMs: Long = 1_500L): Long =
    if (rl == null) 0 else maxOf(0L, rl.lastClaimAt + CLAIM_INTERVAL_MS + marginMs - serverNowMs)

/** customerClaims30d (stored on the claim so the restaurant's replay is deterministic). */
fun claimsInLast30Days(createdAts: List<Long?>, serverNowMs: Long): Int {
    val since = serverNowMs - 30L * 86_400_000L
    return createdAts.count { it != null && it >= since }
}
