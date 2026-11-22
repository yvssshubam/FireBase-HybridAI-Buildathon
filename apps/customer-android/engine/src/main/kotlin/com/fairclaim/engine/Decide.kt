package com.fairclaim.engine

// Deterministic decision: AI-produced evidence in, money out. No clock, no I/O.
// Must stay byte-for-byte equivalent to engine/src/decide.ts (shared vectors).

fun decide(input: EngineInput): EngineDecision {
    val policy = input.policy
    val ev = classifyEvidence(input)
    val reasons = mutableListOf(ev.dispatchFact, ev.handoffFact)
    val problems = gateFailures(input).toMutableList()

    val itemsValid = selectedItemsValid(input)
    if (!itemsValid) problems += "claim_items_invalid" else problems += itemConsistency(input)

    var assessed = 0L
    val amountNotes = mutableListOf<String>()
    if (itemsValid) {
        val raw = rawAssessment(input)
        assessed = minOf(raw, input.order.total)
        if (raw > input.order.total) amountNotes += "refund_capped_at_order_total"
    }

    val risk = mutableListOf<String>()
    if (assessed > policy.autoApproveCap) risk += "over_auto_approve_cap"
    if (input.claim.customerClaims30d >= policy.claimHistoryLimit30d) risk += "claim_history_limit"

    val reviewNotes = when (val r = input.review) {
        ReviewInput.Unavailable -> listOf("cloud_review_unavailable")
        is ReviewInput.Ok -> if (!r.consistent || r.flags.isNotEmpty()) listOf("cloud_review_flagged") else emptyList()
        null -> emptyList()
    }

    val liability = if (itemsValid) assignLiability(input, ev) else Liability.Undetermined
    reasons += problems + amountNotes + risk + reviewNotes

    fun decision(verdict: Verdict, refund: Long, amounts: Amounts, split: Split?, holdHours: Int?) =
        EngineDecision(verdict, refund, assessed, amounts, liability.liabilityCase, split, reasons.toList(), holdHours, policy.policyVersion)

    val flagged = problems.isNotEmpty() || risk.isNotEmpty() || reviewNotes.isNotEmpty()
    return when {
        flagged || liability is Liability.Undetermined -> decision(Verdict.REVIEW, 0, Amounts.ZERO, null, null)
        liability is Liability.Clear -> decision(Verdict.AUTO_REFUND, assessed, Amounts.allTo(liability.party, assessed), null, null)
        liability is Liability.Hold -> {
            val split = holdSplit(liability, policy)
            val restaurant = permilleOf(assessed, split.restaurantPermille)
            decision(Verdict.HOLD, assessed, Amounts(restaurant, assessed - restaurant, 0), split, policy.holdHours)
        }
        else -> error("unreachable")
    }
}
