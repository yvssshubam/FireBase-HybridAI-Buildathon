package com.fairclaim.customer.claim

import com.fairclaim.customer.data.RateLimitDoc
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TimingTest {
    private val issuedAt = 1_764_000_000_000L // server time from challenges/{id}.issuedAt

    @Test
    fun capturedAtIsServerIssuedAtPlusMonotonicElapsed() {
        // The phone's wall clock never enters: only elapsedRealtime() deltas.
        val clock = ChallengeClock(issuedAt = issuedAt, anchorElapsed = 5_000_000L, windowSec = 60)
        assertEquals(issuedAt + 12_345, clock.capturedAt(5_012_345L))
        assertEquals(issuedAt, clock.capturedAt(5_000_000L))
        assertEquals(issuedAt + 60_000, clock.expiresAt)
    }

    @Test
    fun countdownAndServerWriteWindow() {
        val clock = ChallengeClock(issuedAt, anchorElapsed = 100L, windowSec = 60)
        assertEquals(60_000, clock.windowRemainingMs(100L))
        assertEquals(0, clock.windowRemainingMs(60_100L))
        assertTrue(clock.windowRemainingMs(70_100L) < 0)
        // 120 s server window minus the 8 s margin for upload + batch.
        assertEquals(112_000, clock.writeRemainingMs(100L))
        assertEquals(0, clock.writeRemainingMs(112_100L))
    }

    @Test
    fun countTodayFollowsTheRulesUtcDay() {
        val sameDay = RateLimitDoc(lastClaimAt = issuedAt - 60_000, countToday = 2)
        assertEquals(1, nextCountToday(null, issuedAt))
        assertEquals(3, nextCountToday(sameDay, issuedAt))
        val midnight = 1_764_028_800_000L // 2025-11-25T00:00:00Z
        assertEquals(1, nextCountToday(RateLimitDoc(midnight - 1, 4), midnight))
        assertEquals(5, nextCountToday(RateLimitDoc(midnight, 4), midnight + 1))
        assertTrue(dailyLimitReached(RateLimitDoc(issuedAt - 60_000, 5), issuedAt))
        assertFalse(dailyLimitReached(RateLimitDoc(issuedAt - 60_000, 4), issuedAt))
    }

    @Test
    fun waitsOutTheThirtySecondInterval() {
        assertEquals(0, waitForIntervalMs(null, issuedAt))
        assertEquals(31_500, waitForIntervalMs(RateLimitDoc(issuedAt, 1), issuedAt))
        assertEquals(1_500, waitForIntervalMs(RateLimitDoc(issuedAt - 30_000, 1), issuedAt))
        assertEquals(0, waitForIntervalMs(RateLimitDoc(issuedAt - 40_000, 1), issuedAt))
    }

    @Test
    fun claimHistoryCountsTheLast30Days() {
        val day = 86_400_000L
        val created = listOf(issuedAt - day, issuedAt - 29 * day, issuedAt - 30 * day, issuedAt - 31 * day, null)
        assertEquals(3, claimsInLast30Days(created, issuedAt))
        assertEquals(0, claimsInLast30Days(emptyList(), issuedAt))
    }
}
