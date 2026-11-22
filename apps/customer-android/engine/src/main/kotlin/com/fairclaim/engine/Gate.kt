package com.fairclaim.engine

// §8.1 verification gate. App Check validity is enforced by Firebase itself
// (requests without a valid token never reach Firestore), so it isn't checked here.

fun gateFailures(input: EngineInput): List<String> {
    val claim = input.claim
    val cc = claim.challengeCheck
    val out = mutableListOf<String>()
    val code = input.order.sealCode
    if (code == null || cc.sealCodeRead != code) out += "gate_code_mismatch"
    if (cc.fingersVisible != claim.challenge.fingers) out += "gate_fingers_mismatch"
    val elapsed = claim.challenge.capturedAt - claim.challenge.issuedAt
    if (elapsed < 0) out += "gate_time_invalid"
    else if (elapsed > input.policy.challengeWindowSec * 1000L) out += "gate_window_expired"
    if (claim.moireScore >= input.policy.moireThreshold) out += "gate_moire_high"
    if (cc.photoOfScreenSuspected) out += "gate_screen_suspected"
    if (cc.confidence == Confidence.LOW) out += "gate_challenge_low_confidence"
    if (claim.issueType != IssueType.MISSING) {
        val dc = claim.damageCheck
        if (dc == null) out += "gate_damage_check_missing"
        else if (dc.confidence == Confidence.LOW) out += "gate_damage_low_confidence"
    }
    return out
}

fun selectedItemsValid(input: EngineInput): Boolean {
    val ids = input.claim.selectedItemIds
    if (ids.toSet().size != ids.size) return false
    if (!ids.all { id -> input.order.items.any { it.id == id } }) return false
    return if (input.claim.issueType == IssueType.MISSING) ids.isNotEmpty() else ids.size == 1
}

private val DAMAGE_ISSUES = setOf(DamageIssue.SPILLED, DamageIssue.CRUSHED, DamageIssue.FOREIGN_OBJECT)

/** Crop result vs what the customer reported. Assumes selected items are valid. */
fun itemConsistency(input: EngineInput): List<String> {
    val claim = input.claim
    val dc = claim.damageCheck ?: return emptyList()
    if (claim.issueType == IssueType.MISSING) return emptyList()
    val selected = input.order.items.firstOrNull { it.id == claim.selectedItemIds.firstOrNull() } ?: return emptyList()
    val out = mutableListOf<String>()
    val matchesSelected = namesMatch(dc.matchedItem, selected.name)
    if (claim.issueType == IssueType.DAMAGED) {
        if (dc.issue == DamageIssue.NONE || dc.severity == Severity.NONE) out += "damage_none_on_crop"
        else if (dc.issue !in DAMAGE_ISSUES) out += "damage_issue_mismatch"
        val matchesOther = input.order.items.any { it.id != selected.id && namesMatch(dc.matchedItem, it.name) }
        if (!matchesSelected && matchesOther) out += "damage_item_mismatch"
    } else if (matchesSelected) {
        out += "wrong_item_disputed"
    }
    return out
}
