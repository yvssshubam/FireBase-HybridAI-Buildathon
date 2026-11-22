package com.fairclaim.engine

// Flow E: the restaurant answers a hold with a counter photo (checked like a
// dispatch photo: sealed, right code, no visible damage). Clear → settle with the policy share; anything else → human
// review. The customer's refund never changes here. Mirrors engine/src/counterEvidence.ts.

/**
 * False when the restaurant's own dispatch photo already proves everything a
 * counter photo could: the seal for missing/wrong items, a clean high-confidence
 * parcel for damage. Re-sending that proof must not shift the cost.
 */
fun counterEvidenceCanHelp(input: EngineInput): Boolean {
    val dispatch = classifyEvidence(input).dispatch ?: return true
    return input.claim.issueType == IssueType.DAMAGED && dispatch.confidence != Confidence.HIGH
}

fun resolveCounterEvidence(input: EngineInput, decision: EngineDecision, counter: DispatchCheck): Resolution {
    if (decision.verdict != Verdict.HOLD) throw EngineException("not_hold")
    val order = input.order
    val claim = input.claim
    val refund = decision.refundAmount
    fun escalate(reason: String) = Resolution(Outcome.REVIEW, refund, Amounts.ZERO, listOf(reason), input.policy.policyVersion)

    if (!counterEvidenceCanHelp(input)) return escalate("counter_evidence_repeats_dispatch")

    // Damage needs a clean-looking parcel; missing/wrong items can only be answered by the seal.
    val contentOk = claim.issueType != IssueType.DAMAGED || !counter.spillOrDamageVisible
    val clear = counter.sealIntact && order.sealCode != null && counter.sealCodeRead == order.sealCode &&
        counter.confidence == Confidence.HIGH && contentOk
    if (!clear) return escalate("counter_evidence_unclear")

    val restaurant = permilleOf(refund, input.policy.counterRestaurantPermilleAfterClear)
    return Resolution(Outcome.SETTLED, refund, Amounts(restaurant, refund - restaurant, 0), listOf("counter_evidence_clear"), input.policy.policyVersion)
}
