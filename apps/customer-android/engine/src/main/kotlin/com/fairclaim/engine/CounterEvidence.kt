package com.fairclaim.engine

// Flow E: the restaurant answers a hold with a counter photo (checked like a
// dispatch photo). Clear → settle with the policy share; anything else → human
// review. The customer's refund never changes here. Mirrors engine/src/counterEvidence.ts.

fun resolveCounterEvidence(input: EngineInput, decision: EngineDecision, counter: DispatchCheck): Resolution {
    if (decision.verdict != Verdict.HOLD) throw EngineException("not_hold")
    val order = input.order
    val claim = input.claim
    val refund = decision.refundAmount
    fun escalate(reason: String) = Resolution(Outcome.REVIEW, refund, Amounts.ZERO, listOf(reason), input.policy.policyVersion)

    // Packed, sealed at dispatch and sealed at handoff, yet missing: another photo can't explain that.
    if (decision.liabilityCase == "hold_investigate_contradiction") return escalate("counter_evidence_cannot_resolve_contradiction")

    // A late photo must not override the restaurant's own dispatch photo showing the item absent.
    val dispatch = classifyEvidence(input).dispatch
    if (dispatch != null && claim.issueType != IssueType.DAMAGED &&
        ItemStatus.ABSENT in itemStatuses(dispatch, order, claim.selectedItemIds)
    ) {
        return escalate("counter_evidence_conflicts_dispatch")
    }

    val contentOk = if (claim.issueType == IssueType.DAMAGED) {
        !counter.spillOrDamageVisible
    } else {
        claim.selectedItemIds.all { id ->
            val item = order.items.firstOrNull { it.id == id }
            item != null && counter.visibleItems.any { namesMatch(it, item.name) }
        }
    }
    val clear = counter.sealIntact && order.sealCode != null && counter.sealCodeRead == order.sealCode &&
        counter.confidence == Confidence.HIGH && contentOk
    if (!clear) return escalate("counter_evidence_unclear")

    val restaurant = permilleOf(refund, input.policy.counterRestaurantPermilleAfterClear)
    return Resolution(Outcome.SETTLED, refund, Amounts(restaurant, refund - restaurant, 0), listOf("counter_evidence_clear"), input.policy.policyVersion)
}
