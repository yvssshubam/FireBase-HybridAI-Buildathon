package com.fairclaim.engine

enum class ItemStatus { VISIBLE, ABSENT, UNCLEAR }

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

/** Per selected item: matched by name → visible; not matched and count short → absent; else unclear. */
fun itemStatuses(check: DispatchCheck, order: Order, selectedIds: List<String>): List<ItemStatus> {
    val countShort = check.visibleItemCount < order.items.size
    return selectedIds.map { id ->
        val item = order.items.firstOrNull { it.id == id }
        when {
            item == null -> ItemStatus.UNCLEAR
            check.visibleItems.any { namesMatch(it, item.name) } -> ItemStatus.VISIBLE
            countShort -> ItemStatus.ABSENT
            else -> ItemStatus.UNCLEAR
        }
    }
}

/** All the same → that status; mixed → unclear. */
fun aggregateStatus(statuses: List<ItemStatus>): ItemStatus {
    val first = statuses.firstOrNull() ?: return ItemStatus.UNCLEAR
    return if (statuses.all { it == first }) first else ItemStatus.UNCLEAR
}
