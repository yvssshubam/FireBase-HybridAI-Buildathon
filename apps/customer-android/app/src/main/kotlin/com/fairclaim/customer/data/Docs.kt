package com.fairclaim.customer.data

import kotlinx.serialization.json.JsonObject

// Firestore documents as the customer app reads them. Timestamps arrive already converted to
// epoch milliseconds (floored), see FirestorePlain.kt; everything here is plain Kotlin so the
// mappers and batch builders are unit-testable on the JVM.

data class MenuItem(val id: String, val name: String, val price: Long)

data class Restaurant(val id: String, val name: String, val menu: List<MenuItem>)

enum class OrderStatus(val wire: String) { PLACED("placed"), DISPATCHED("dispatched"), DELIVERED("delivered") }

data class OrderLine(val id: String, val name: String, val price: Long)

data class OrderDoc(
    val id: String,
    val restaurantId: String,
    val customerId: String,
    val items: List<OrderLine>,
    val total: Long,
    val status: OrderStatus,
    val sealCode: String?,
    val createdAt: Long?,
) {
    /** Rules: challenges, handoff and claims need dispatched or delivered. */
    val claimable: Boolean get() = status != OrderStatus.PLACED && sealCode != null
}

/** handoff/{orderId} or dispatch/{orderId}: `check` is the normalized model output, kept as JSON. */
data class EvidenceDoc(val orderId: String, val check: JsonObject, val inferenceSource: String)

data class ClaimDoc(
    val claimId: String,
    val orderId: String,
    val issueType: String,
    val selectedItemIds: List<String>,
    val inferenceSources: Map<String, String?>,
    val createdAt: Long?,
    /** The whole document in JSON form, as the engine's claimFrom() reads it. */
    val json: JsonObject,
)

data class DecisionDoc(
    val claimId: String,
    val orderId: String,
    val restaurantId: String,
    val verdict: String,
    val refundAmount: Long,
    val liability: Map<String, Long>,
    val liabilityCase: String,
    val split: Pair<Int, Int>?,
    val reasons: List<String>,
    val holdHours: Int?,
    val reviewStatus: String,
    val explanations: Map<String, String>,
    val policyVersion: String,
    val createdAt: Long?,
)

data class HoldDoc(
    val claimId: String,
    val amount: Long,
    val state: String,
    val holdHours: Int,
    val createdAt: Long?,
) {
    /** Server-clock window (rules holdEnds); null until the server timestamp has resolved. */
    val endsAt: Long? get() = createdAt?.plus(holdHours * 3_600_000L)
}

data class RateLimitDoc(val lastClaimAt: Long, val countToday: Int)
