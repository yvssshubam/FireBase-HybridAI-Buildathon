package com.fairclaim.engine

// Integer-only money so the TS and Kotlin engines agree to the rupee.

/** ⌊(amount × permille + 500) / 1000⌋ — half-up rounding to whole rupees (amounts are never negative). */
fun permilleOf(amount: Long, permille: Int): Long = (amount * permille + 500) / 1000

/** §8.3 proportionate refund before the order-total cap. Assumes a valid item selection. */
fun rawAssessment(input: EngineInput): Long {
    val claim = input.claim
    val f = input.policy.severityPermille
    fun priceOf(id: String?): Long = input.order.items.firstOrNull { it.id == id }?.price ?: 0
    return when (claim.issueType) {
        IssueType.DAMAGED -> when (claim.damageCheck?.severity) {
            Severity.MINOR -> permilleOf(priceOf(claim.selectedItemIds.firstOrNull()), f.minor)
            Severity.PARTIAL -> permilleOf(priceOf(claim.selectedItemIds.firstOrNull()), f.partial)
            Severity.TOTAL -> permilleOf(priceOf(claim.selectedItemIds.firstOrNull()), f.total)
            Severity.NONE, null -> 0
        }
        IssueType.MISSING -> claim.selectedItemIds.sumOf { permilleOf(priceOf(it), f.missing) }
        IssueType.WRONG_ITEM -> permilleOf(priceOf(claim.selectedItemIds.firstOrNull()), f.wrongItem)
    }
}
