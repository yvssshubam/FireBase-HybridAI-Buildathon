package com.fairclaim.customer.camera

import java.security.MessageDigest

/** Lowercase hex SHA-256 (rules: ^[0-9a-f]{64}$), computed over exactly the bytes that get uploaded. */
fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }

const val MAX_CROP_BYTES = 300 * 1024 // storage.rules jpegUnder(300): size < 300 KB
