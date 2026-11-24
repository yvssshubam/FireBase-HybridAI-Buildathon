package com.fairclaim.customer.data

import com.fairclaim.engine.EngineInput
import com.fairclaim.engine.Policy
import com.fairclaim.engine.ReviewInput
import com.fairclaim.engine.claimFrom
import com.fairclaim.engine.dispatchCheckFrom
import com.fairclaim.engine.handoffCheckFrom
import com.fairclaim.engine.orderFrom
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

// Firestore documents (as plain maps: String, Long, Double, Boolean, List, Map, null; timestamps
// already turned into epoch millis) ↔ the app's doc types and the Kotlin engine's JSON input.
// The engine input is rebuilt exactly the way the restaurant's replay audit rebuilds it
// (apps/restaurant-web/src/data/engineInput.ts), so both engines see the same evidence.

class DocError(path: String, message: String) : IllegalArgumentException("$path: $message")

/** Firestore value → JSON. Integers stay integers, so the engine sees `2`, not `2.0`. */
fun anyToJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is String -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Long -> JsonPrimitive(v)
    is Int -> JsonPrimitive(v.toLong())
    is Double -> JsonPrimitive(v)
    is Float -> JsonPrimitive(v.toDouble())
    is List<*> -> JsonArray(v.map(::anyToJson))
    is Map<*, *> -> JsonObject(v.entries.associate { (k, value) -> k.toString() to anyToJson(value) })
    else -> throw IllegalArgumentException("unsupported Firestore value ${v::class.simpleName}")
}

/** JSON → Firestore value (integral numbers → Long, others → Double). */
fun jsonToFirestore(e: JsonElement): Any? = when (e) {
    is JsonNull -> null
    is JsonPrimitive -> when {
        e.isString -> e.content
        e.booleanOrNull != null -> e.booleanOrNull
        e.longOrNull != null -> e.longOrNull
        else -> e.content.toDouble()
    }
    is JsonArray -> e.map(::jsonToFirestore)
    is JsonObject -> LinkedHashMap<String, Any?>().apply { e.forEach { (k, v) -> put(k, jsonToFirestore(v)) } }
}

private class Reader(val path: String, val m: Map<String, Any?>) {
    fun str(k: String): String = m[k] as? String ?: throw DocError("$path.$k", "expected a string")
    fun strOrNull(k: String): String? = when (val v = m[k]) {
        null -> null
        is String -> v
        else -> throw DocError("$path.$k", "expected a string or null")
    }
    fun long(k: String): Long = when (val v = m[k]) {
        is Long -> v
        is Int -> v.toLong()
        else -> throw DocError("$path.$k", "expected an integer")
    }
    fun longOrNull(k: String): Long? = if (m[k] == null) null else long(k)
    fun int(k: String): Int = long(k).toInt()
    fun intOrNull(k: String): Int? = longOrNull(k)?.toInt()
    fun map(k: String): Map<String, Any?> = asMap(m[k], "$path.$k")
    fun list(k: String): List<Any?> = m[k] as? List<*> ?: throw DocError("$path.$k", "expected a list")
    fun strings(k: String): List<String> = list(k).mapIndexed { i, v -> v as? String ?: throw DocError("$path.$k[$i]", "expected a string") }
}

@Suppress("UNCHECKED_CAST")
private fun asMap(v: Any?, path: String): Map<String, Any?> = v as? Map<String, Any?> ?: throw DocError(path, "expected a map")

fun parseRestaurant(id: String, data: Map<String, Any?>): Restaurant {
    val r = Reader("restaurants/$id", data)
    val menu = r.map("menu").map { (itemId, raw) ->
        val m = Reader("restaurants/$id.menu.$itemId", asMap(raw, "restaurants/$id.menu.$itemId"))
        MenuItem(itemId, m.str("name"), m.long("price"))
    }.sortedBy { it.name.lowercase() }
    return Restaurant(id, r.str("name"), menu)
}

fun parseOrder(id: String, data: Map<String, Any?>): OrderDoc {
    val r = Reader("orders/$id", data)
    val items = r.list("items").mapIndexed { i, raw ->
        val l = Reader("orders/$id.items[$i]", asMap(raw, "orders/$id.items[$i]"))
        OrderLine(l.str("id"), l.str("name"), l.long("price"))
    }
    val status = r.str("status").let { s -> OrderStatus.entries.firstOrNull { it.wire == s } ?: throw DocError("orders/$id.status", "unknown $s") }
    return OrderDoc(
        id = id,
        restaurantId = r.str("restaurantId"),
        customerId = r.str("customerId"),
        items = items,
        total = r.long("total"),
        status = status,
        sealCode = r.strOrNull("sealCode"),
        createdAt = r.longOrNull("createdAt"),
    )
}

/** handoff/{orderId} and dispatch/{orderId}. */
fun parseEvidence(collection: String, orderId: String, data: Map<String, Any?>): EvidenceDoc {
    val r = Reader("$collection/$orderId", data)
    return EvidenceDoc(orderId, anyToJson(r.map("check")) as JsonObject, r.str("inferenceSource"))
}

fun parseClaim(id: String, data: Map<String, Any?>): ClaimDoc {
    val r = Reader("claims/$id", data)
    val sources = r.map("inferenceSources").mapValues { (k, v) ->
        when (v) {
            null -> null
            is String -> v
            else -> throw DocError("claims/$id.inferenceSources.$k", "expected a string or null")
        }
    }
    return ClaimDoc(
        claimId = r.str("claimId"),
        orderId = r.str("orderId"),
        issueType = r.str("issueType"),
        selectedItemIds = r.strings("selectedItemIds"),
        inferenceSources = sources,
        createdAt = r.longOrNull("createdAt"),
        json = anyToJson(data - "createdAt") as JsonObject,
    )
}

fun parseDecision(id: String, data: Map<String, Any?>): DecisionDoc {
    val r = Reader("decisions/$id", data)
    val liability = Reader("decisions/$id.liability", r.map("liability")).let { l ->
        mapOf("restaurant" to l.long("restaurant"), "transit" to l.long("transit"), "platform" to l.long("platform"))
    }
    val split = data["split"]?.let { asMap(it, "decisions/$id.split") }?.let {
        val s = Reader("decisions/$id.split", it)
        s.int("restaurantPermille") to s.int("transitPermille")
    }
    val explanations = r.map("explanations").mapValues { (k, v) -> v as? String ?: throw DocError("decisions/$id.explanations.$k", "expected a string") }
    return DecisionDoc(
        claimId = r.str("claimId"),
        orderId = r.str("orderId"),
        restaurantId = r.str("restaurantId"),
        verdict = r.str("verdict"),
        refundAmount = r.long("refundAmount"),
        liability = liability,
        liabilityCase = r.str("liabilityCase"),
        split = split,
        reasons = r.strings("reasons"),
        holdHours = r.intOrNull("holdHours"),
        reviewStatus = Reader("decisions/$id.review", r.map("review")).str("status"),
        explanations = explanations,
        policyVersion = r.str("policyVersion"),
        createdAt = r.longOrNull("createdAt"),
    )
}

fun parseHold(id: String, data: Map<String, Any?>): HoldDoc {
    val r = Reader("holds/$id", data)
    return HoldDoc(r.str("claimId"), r.long("amount"), r.str("state"), r.int("holdHours"), r.longOrNull("createdAt"))
}

fun parseRateLimit(data: Map<String, Any?>): RateLimitDoc {
    val r = Reader("rateLimits", data)
    return RateLimitDoc(r.long("lastClaimAt"), r.int("countToday"))
}

/** Order in the engine/vector shape: { id, items, total, sealCode }. */
fun engineOrderJson(o: OrderDoc): JsonObject = buildJsonObject {
    put("id", o.id)
    put("items", JsonArray(o.items.map { buildJsonObject { put("id", it.id); put("name", it.name); put("price", it.price) } }))
    put("total", o.total)
    put("sealCode", o.sealCode)
}

/** Stored documents → engine input, the same way the restaurant's replay audit builds it. */
fun engineInputFor(
    order: OrderDoc,
    dispatch: EvidenceDoc?,
    handoff: EvidenceDoc?,
    claim: ClaimDoc,
    review: ReviewInput?,
    policy: Policy,
): EngineInput = EngineInput(
    order = orderFrom(engineOrderJson(order)),
    dispatch = dispatch?.let { dispatchCheckFrom(it.check) },
    handoff = handoff?.let { handoffCheckFrom(it.check) },
    claim = claimFrom(claim.json),
    review = review,
    policy = policy,
)
