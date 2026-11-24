package com.fairclaim.customer.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Same cases as apps/restaurant-web/test/pairing.test.ts: both sides must agree on the payload.
class PairingTest {
    @Test
    fun acceptsTheWebPayload() {
        assertEquals("K7QM4P", parsePairPayload("fairclaim://pair?code=K7QM4P"))
        assertEquals("ABCDEF", parsePairPayload("  fairclaim://pair?code=ABCDEF \n"))
    }

    @Test
    fun rejectsAnythingElse() {
        listOf(
            "K7QM4P",
            "https://example.com/?code=K7QM4P",
            "fairclaim://pair?code=K7QM4I", // I is not in the alphabet
            "fairclaim://pair?code=K7QM4P&x=1",
            "fairclaim://pair?code=k7qm4p",
            "fairclaim://pair?code=K7QM4",
            "fairclaim://pair?code=K7QM40", // 0
            "FAIRCLAIM://pair?code=K7QM4P",
            "",
        ).forEach { assertNull(it, parsePairPayload(it)) }
    }

    @Test
    fun typedCodeIsNormalizedButStrict() {
        assertEquals("ABC234", normalizeTypedCode("abc 234"))
        assertEquals("ABC234", normalizeTypedCode("ABC-234"))
        assertNull(normalizeTypedCode("ABC23"))
        assertNull(normalizeTypedCode("ABC2O4")) // letter O
        assertNull(normalizeTypedCode("ABC2341"))
    }

    @Test
    fun idsMatchTheRulesIdPattern() {
        val id = Regex("^[A-Za-z0-9_-]{1,64}$")
        repeat(50) {
            val o = newId("o")
            assert(id.matches(o)) { o }
            assert(Regex("^o-[0-9a-f]{12}$").matches(o)) { o }
        }
        val counts = IntArray(4)
        repeat(3000) { counts[randomFingers()]++ }
        assertEquals(0, counts[0])
        (1..3).forEach { assert(counts[it] > 800) { counts.toList() } }
    }
}
