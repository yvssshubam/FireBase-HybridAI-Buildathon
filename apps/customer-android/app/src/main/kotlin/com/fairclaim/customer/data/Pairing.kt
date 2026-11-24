package com.fairclaim.customer.data

// Pairing with a sandbox restaurant (Decision 1). Mirrors apps/restaurant-web/src/data/pairing.ts:
// the QR encodes exactly `fairclaim://pair?code=<CODE>`, CODE being the pairCodes/{code} id.

/** firestore.rules pairCodes/{code}: 6 chars, no I, O, 0 or 1. */
val PAIR_CODE = Regex("^[A-HJ-NP-Z2-9]{6}$")
private val PAYLOAD = Regex("^fairclaim://pair\\?code=([A-HJ-NP-Z2-9]{6})$")

/** The pair code inside a scanned payload or deep link, or null. Same rule as pairing.ts parsePairPayload. */
fun parsePairPayload(text: String): String? = PAYLOAD.matchEntire(text.trim())?.groupValues?.get(1)

/** Typed fallback: tolerant of case and spaces ("abc 234"), strict about the alphabet. */
fun normalizeTypedCode(text: String): String? {
    val code = text.filterNot { it.isWhitespace() || it == '-' }.uppercase()
    return code.takeIf { PAIR_CODE.matches(it) }
}
