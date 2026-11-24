package com.fairclaim.customer.data

import com.fairclaim.engine.EngineDecision
import com.fairclaim.engine.Policy
import com.fairclaim.engine.Verdict
import com.fairclaim.engine.decisionJson
import kotlinx.serialization.json.JsonObject

// Every customer write, field for field as dev/customer-sim.ts writes it and firestore.rules accepts
// it (exactKeys everywhere, so a missing or extra key is a permission error). The Android layer
// replaces [ServerTimestamp] with FieldValue.serverTimestamp(); the rules require request.time there.

/** Placeholder for FieldValue.serverTimestamp() (kept out of pure code so this is JVM-testable). */
object ServerTimestamp

const val TERMS_VERSION = "2026-11-22" // apps/restaurant-web/src/legal.ts; bump both together
const val CHALLENGE_KIND = "fingers"
const val MAX_ORDER_LINES = 5 // firestore.rules validNewOrder
const val MAX_CLAIMS_PER_DAY = 5 // rateLimits rule
const val CLAIM_INTERVAL_MS = 30_000L // rateLimits rule: request.time > lastClaimAt + 30 s
const val SERVER_CLAIM_WINDOW_MS = 120_000L // claims + crop rules: request.time < issuedAt + 120 s

typealias Doc = Map<String, Any?>

fun userDoc(): Doc = linkedMapOf("termsVersion" to TERMS_VERSION, "acceptedAt" to ServerTimestamp, "role" to "customer")

/** Names and prices are copied from the menu; the rules re-check them against restaurants/{id}.menu. */
fun orderDoc(restaurant: Restaurant, customerId: String, itemIds: List<String>): Doc {
    require(itemIds.isNotEmpty() && itemIds.size <= MAX_ORDER_LINES) { "an order has 1 to $MAX_ORDER_LINES items" }
    require(itemIds.toSet().size == itemIds.size) { "each item at most once" }
    val items = itemIds.map { id ->
        val m = restaurant.menu.firstOrNull { it.id == id } ?: throw IllegalArgumentException("$id is not on the menu")
        linkedMapOf<String, Any?>("id" to m.id, "name" to m.name, "price" to m.price)
    }
    return linkedMapOf(
        "restaurantId" to restaurant.id,
        "customerId" to customerId,
        "items" to items,
        "itemIds" to itemIds.toList(),
        "total" to items.sumOf { it["price"] as Long },
        "status" to "placed",
        "sealCode" to null,
        "createdAt" to ServerTimestamp,
    )
}

fun handoffDoc(check: JsonObject, inferenceSource: String, capturedAtMs: Long): Doc = linkedMapOf(
    "check" to jsonToFirestore(check),
    "inferenceSource" to inferenceSource,
    "capturedAt" to capturedAtMs,
    "recordedAt" to ServerTimestamp,
)

fun deliveredUpdate(): Doc = linkedMapOf("status" to "delivered", "deliveredAt" to ServerTimestamp)

fun challengeDoc(customerId: String, order: OrderDoc, fingers: Int): Doc {
    require(fingers in 1..3)
    return linkedMapOf(
        "customerId" to customerId,
        "orderId" to order.id,
        "restaurantId" to order.restaurantId,
        "kind" to CHALLENGE_KIND,
        "fingers" to fingers,
        "issuedAt" to ServerTimestamp,
    )
}

/** Everything the claim document needs, gathered by the capture flow. */
data class ClaimEvidence(
    val claimId: String,
    val order: OrderDoc,
    val customerId: String,
    val issueType: String,
    val selectedItemIds: List<String>,
    val fingers: Int,
    val issuedAt: Long,
    val capturedAt: Long,
    val challengeWindowSec: Int,
    val challengeCheck: JsonObject,
    val damageCheck: JsonObject?,
    val moireScore: Double,
    val cropSha256: String?,
    val challengeSource: String,
    val damageSource: String?,
    val customerClaims30d: Int,
) {
    val cropRef: String? get() = cropSha256?.let { cropPath(claimId) }
}

fun cropPath(claimId: String) = "claims/$claimId/crop.jpg"

fun claimDoc(e: ClaimEvidence): Doc {
    val code = requireNotNull(e.order.sealCode) { "order has no seal code yet" }
    require(e.moireScore in 0.0..1.0)
    require((e.issueType == "missing") == (e.damageCheck == null)) { "damage check runs exactly for damaged / wrong item" }
    require((e.damageCheck == null) == (e.cropSha256 == null)) { "the crop belongs to the damage check" }
    return linkedMapOf(
        "claimId" to e.claimId,
        "orderId" to e.order.id,
        "customerId" to e.customerId,
        "issueType" to e.issueType,
        "selectedItemIds" to e.selectedItemIds.toList(),
        "challenge" to linkedMapOf(
            "kind" to CHALLENGE_KIND,
            "code" to code,
            "fingers" to e.fingers,
            "issuedAt" to e.issuedAt,
            "capturedAt" to e.capturedAt,
            "expiresAt" to e.issuedAt + e.challengeWindowSec * 1000L,
        ),
        "challengeCheck" to jsonToFirestore(e.challengeCheck),
        "damageCheck" to e.damageCheck?.let(::jsonToFirestore),
        "moireScore" to e.moireScore,
        "cropSha256" to e.cropSha256,
        "cropRef" to e.cropRef,
        "inferenceSources" to linkedMapOf("challenge" to e.challengeSource, "damage" to e.damageSource),
        "customerClaims30d" to e.customerClaims30d,
        "createdAt" to ServerTimestamp,
    )
}

fun rateLimitDoc(countToday: Int): Doc {
    require(countToday in 1..MAX_CLAIMS_PER_DAY)
    return linkedMapOf("lastClaimAt" to ServerTimestamp, "countToday" to countToday)
}

fun claimsByOrderDoc(claimId: String, customerId: String): Doc = linkedMapOf("claimId" to claimId, "customerId" to customerId)

data class Explanations(val customerEn: String, val customerHi: String, val customerTa: String, val restaurant: String)

/** Review as stored: { status: "ok", consistent, flags } or { status: "unavailable" }. */
sealed interface StoredReview {
    data class Ok(val consistent: Boolean, val flags: List<String>) : StoredReview
    data object Unavailable : StoredReview
}

fun reviewMap(r: StoredReview): Doc = when (r) {
    is StoredReview.Ok -> linkedMapOf("status" to "ok", "consistent" to r.consistent, "flags" to r.flags.toList())
    StoredReview.Unavailable -> linkedMapOf("status" to "unavailable")
}

fun decisionDoc(claim: ClaimDoc, customerId: String, restaurantId: String, d: EngineDecision, review: StoredReview, ex: Explanations): Doc {
    val out = linkedMapOf<String, Any?>(
        "claimId" to claim.claimId,
        "orderId" to claim.orderId,
        "customerId" to customerId,
        "restaurantId" to restaurantId,
    )
    @Suppress("UNCHECKED_CAST")
    out.putAll(jsonToFirestore(decisionJson(d)) as Map<String, Any?>)
    out["review"] = reviewMap(review)
    out["explanations"] = linkedMapOf(
        "customer_en" to ex.customerEn,
        "customer_hi" to ex.customerHi,
        "customer_ta" to ex.customerTa,
        "restaurant" to ex.restaurant,
    )
    out["engine"] = "kotlin"
    out["createdAt"] = ServerTimestamp
    return out
}

/** Rules: a hold decision must be written in the same batch as holds/{claimId}. */
fun holdDoc(claimId: String, customerId: String, restaurantId: String, d: EngineDecision, policy: Policy): Doc? {
    if (d.verdict != Verdict.HOLD) return null
    return linkedMapOf(
        "claimId" to claimId,
        "customerId" to customerId,
        "restaurantId" to restaurantId,
        "amount" to d.refundAmount,
        "parties" to linkedMapOf("restaurant" to d.liability.restaurant, "transit" to d.liability.transit, "platform" to d.liability.platform),
        "state" to "held",
        "holdHours" to policy.holdHours,
        "createdAt" to ServerTimestamp,
    )
}

/** Nobody answered within the window: either party may settle (holds rule, !beforeEnd()). */
fun holdSettleUpdate(): Doc = linkedMapOf("state" to "settled", "resolvedAt" to ServerTimestamp)
