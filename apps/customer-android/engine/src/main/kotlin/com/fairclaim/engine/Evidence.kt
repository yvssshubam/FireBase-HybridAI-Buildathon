package com.fairclaim.engine

/** Usable dispatch/handoff evidence plus the fact codes reported in `reasons`. */
data class Evidence(
    val dispatchFact: String,
    val dispatch: DispatchCheck?,
    val handoffFact: String,
    val handoff: HandoffCheck?,
)

fun classifyEvidence(input: EngineInput): Evidence {
    val code = input.order.sealCode
    val d = input.dispatch
    val h = input.handoff

    val dispatchValid = d != null && d.sealIntact && code != null && d.sealCodeRead == code
    val dispatchFact = when {
        d == null -> "dispatch_missing"
        dispatchValid -> "dispatch_valid"
        else -> "dispatch_invalid"
    }

    val handoffUsable = h != null && code != null && h.sealCodeRead == code && h.sealState != SealState.NOT_VISIBLE
    val handoffFact = when {
        h == null -> "handoff_missing"
        !handoffUsable -> "handoff_unusable"
        h.sealState == SealState.INTACT -> "handoff_intact"
        else -> "handoff_broken"
    }
    return Evidence(dispatchFact, if (dispatchValid) d else null, handoffFact, if (handoffUsable) h else null)
}
