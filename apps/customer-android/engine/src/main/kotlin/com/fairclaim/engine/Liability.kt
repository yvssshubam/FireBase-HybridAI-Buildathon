package com.fairclaim.engine

// §8.2 liability matrix + agreed defaults (packages/schemas/test-vectors/README.md).
// The claim photo's seal state is deliberately ignored: the customer always
// breaks the seal to open the bag.

sealed interface Liability {
    val liabilityCase: String

    data class Clear(val party: Party, override val liabilityCase: String) : Liability
    data class Hold(override val liabilityCase: String, val lean: Party? = null, val confidence: Confidence? = null) : Liability
    data object Undetermined : Liability { override val liabilityCase = "undetermined" }
}

fun assignLiability(input: EngineInput, ev: Evidence): Liability {
    val d = ev.dispatch
    val h = ev.handoff

    if (input.claim.issueType == IssueType.DAMAGED) {
        // Handling question: the seal can't tell us anything about spills.
        if (d == null) return Liability.Hold("hold_no_dispatch")
        if (d.spillOrDamageVisible) return Liability.Clear(Party.RESTAURANT, "restaurant_damage_at_dispatch")
        if (d.confidence != Confidence.HIGH) return Liability.Hold("hold_damage_dispatch_uncertain", Party.TRANSIT, d.confidence)
        if (h != null) return Liability.Clear(input.policy.handlingDamageLiable, "handling_damage")
        return Liability.Hold("hold_damage_no_handoff", Party.TRANSIT, d.confidence)
    }

    // Missing / wrong item: tampering question, answered by dispatch seal vs handoff seal.
    if (d == null) {
        if (h == null) return Liability.Hold("hold_no_dispatch")
        val lean = if (h.sealState == SealState.INTACT) Party.RESTAURANT else Party.TRANSIT
        return Liability.Hold("hold_no_dispatch", lean, h.confidence)
    }
    // Sealed with the right code at dispatch and still intact at handoff → never packed.
    if (h == null) return Liability.Hold("hold_no_handoff")
    return if (h.sealState == SealState.INTACT) Liability.Clear(Party.RESTAURANT, "restaurant_not_packed")
    else Liability.Clear(Party.TRANSIT, "transit_tamper")
}

/** Confidence-weighted split: base ± maxShift × weight / 1000 toward the party the evidence points at. */
fun holdSplit(l: Liability.Hold, policy: Policy): Split {
    val p = policy.holdSplit
    var r = p.baseRestaurantPermille
    if (l.lean != null && l.confidence != null) {
        val shift = p.maxShiftPermille * (p.confidenceWeightPermille.getValue(l.confidence)) / 1000
        r += if (l.lean == Party.RESTAURANT) shift else -shift
    }
    r = r.coerceIn(0, 1000)
    return Split(r, 1000 - r)
}
