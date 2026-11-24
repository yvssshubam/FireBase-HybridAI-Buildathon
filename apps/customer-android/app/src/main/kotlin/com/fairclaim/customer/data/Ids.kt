package com.fairclaim.customer.data

import java.security.SecureRandom

private val random = SecureRandom()

/** "o-3fa9c01b2e4d": same shape as dev/customer-sim.ts (6 random bytes, hex); matches the rules' isId. */
fun newId(prefix: String): String {
    val bytes = ByteArray(6).also(random::nextBytes)
    return prefix + "-" + bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
}

/** Finger count for the live challenge: uniformly 1–3 (rules: isInt(fingers, 1, 3)). */
fun randomFingers(): Int = 1 + random.nextInt(3)
