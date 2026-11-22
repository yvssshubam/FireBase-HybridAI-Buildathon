package com.fairclaim.engine

private val NON_ALNUM = Regex("[^a-z0-9]+")

/** Lowercase, non-alphanumerics → single spaces. Non-Latin names normalize to "". */
fun normalizeName(s: String): String = s.lowercase().replace(NON_ALNUM, " ").trim()

/** Equal, or one contains the other as whole words ("biryani" ~ "chicken biryani"). */
fun namesMatch(a: String, b: String): Boolean {
    val na = normalizeName(a)
    val nb = normalizeName(b)
    if (na.isEmpty() || nb.isEmpty()) return false
    if (na == nb) return true
    val wa = " $na "
    val wb = " $nb "
    return wa.contains(wb) || wb.contains(wa)
}
