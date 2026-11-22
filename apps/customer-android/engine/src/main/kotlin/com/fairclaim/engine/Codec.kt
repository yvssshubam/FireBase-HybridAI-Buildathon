package com.fairclaim.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

// JSON ↔ engine types, using the same field names as the JSON Schemas.
// Inputs here are already-validated data (normalized model output, our own
// stored documents, Remote Config) — malformed input throws.

private fun JsonObject.obj(k: String) = getValue(k).jsonObject
private fun JsonObject.str(k: String) = getValue(k).jsonPrimitive.also { require(it.isString) { "$k must be a string" } }.content
private fun JsonObject.strOrNull(k: String) = this[k]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content
private fun JsonObject.int(k: String) = getValue(k).jsonPrimitive.int
private fun JsonObject.long(k: String) = getValue(k).jsonPrimitive.long
private fun JsonObject.bool(k: String) = getValue(k).jsonPrimitive.boolean
private fun JsonObject.strings(k: String) = getValue(k).jsonArray.map { it.jsonPrimitive.content }
private fun JsonObject.objOrNull(k: String) = this[k]?.takeUnless { it is JsonNull }?.jsonObject

fun dispatchCheckFrom(o: JsonObject) = DispatchCheck(
    sealIntact = o.bool("seal_intact"),
    sealCodeRead = o.str("seal_code_read"),
    visibleItemCount = o.int("visible_item_count"),
    visibleItems = o.strings("visible_items"),
    spillOrDamageVisible = o.bool("spill_or_damage_visible"),
    confidence = wireOf(o.str("confidence")),
)

fun handoffCheckFrom(o: JsonObject) = HandoffCheck(wireOf(o.str("seal_state")), o.str("seal_code_read"), wireOf(o.str("confidence")))

fun challengeCheckFrom(o: JsonObject) = ChallengeCheck(
    sealCodeRead = o.str("seal_code_read"),
    fingersVisible = o.int("fingers_visible"),
    sealState = wireOf(o.str("seal_state")),
    photoOfScreenSuspected = o.bool("photo_of_screen_suspected"),
    confidence = wireOf(o.str("confidence")),
)

fun damageCheckFrom(o: JsonObject) = DamageCheck(o.str("matched_item"), wireOf(o.str("issue")), wireOf(o.str("severity")), wireOf(o.str("confidence")))

fun reviewOutputFrom(o: JsonObject) = ReviewOutput(
    consistent = o.bool("consistent"),
    flags = o.strings("flags"),
    explanationCustomerEn = o.str("explanation_customer_en"),
    explanationCustomerHi = o.str("explanation_customer_hi"),
    explanationCustomerTa = o.str("explanation_customer_ta"),
    explanationRestaurant = o.str("explanation_restaurant"),
)

fun dispatchCheckJson(d: DispatchCheck): JsonObject = buildJsonObject {
    put("seal_intact", d.sealIntact)
    put("seal_code_read", d.sealCodeRead)
    put("visible_item_count", d.visibleItemCount)
    putJsonArray("visible_items") { d.visibleItems.forEach { add(JsonPrimitive(it)) } }
    put("spill_or_damage_visible", d.spillOrDamageVisible)
    put("confidence", d.confidence.wire)
}

private fun permille(o: JsonObject, k: String): Int = o.int(k).also { require(it in 0..1000) { "$k must be 0..1000" } }

private val POLICY_KEYS = setOf(
    "policyVersion", "currency", "autoApproveCap", "claimHistoryLimit30d", "challengeWindowSec", "moireThreshold",
    "severityPermille", "handlingDamageLiable", "holdHours", "holdSplit", "counterEvidence",
)

/** Parses and range-checks a policy, mirroring policy.schema.json. Throws IllegalArgumentException. */
fun policyFrom(o: JsonObject): Policy {
    require(o.keys == POLICY_KEYS) { "policy keys must be exactly $POLICY_KEYS" }
    require(o.str("currency") == "INR") { "currency must be INR" }
    val version = o.str("policyVersion").also { require(Regex("^v[0-9]+$").matches(it)) { "bad policyVersion" } }
    val sev = o.obj("severityPermille")
    require(sev.keys == setOf("minor", "partial", "total", "missing", "wrong_item")) { "bad severityPermille keys" }
    val split = o.obj("holdSplit")
    require(split.keys == setOf("baseRestaurantPermille", "maxShiftPermille", "confidenceWeightPermille")) { "bad holdSplit keys" }
    val weights = split.obj("confidenceWeightPermille")
    require(weights.keys == setOf("high", "medium", "low")) { "bad confidenceWeightPermille keys" }
    val counter = o.obj("counterEvidence")
    require(counter.keys == setOf("restaurantPermilleAfterClear")) { "bad counterEvidence keys" }
    val moire = o.getValue("moireThreshold").jsonPrimitive.double
    require(moire > 0 && moire <= 1) { "moireThreshold must be in (0,1]" }
    return Policy(
        policyVersion = version,
        autoApproveCap = o.long("autoApproveCap").also { require(it in 0..1_000_000) },
        claimHistoryLimit30d = o.int("claimHistoryLimit30d").also { require(it in 1..100) },
        challengeWindowSec = o.int("challengeWindowSec").also { require(it in 10..120) },
        moireThreshold = moire,
        severityPermille = SeverityPermille(
            permille(sev, "minor"), permille(sev, "partial"), permille(sev, "total"), permille(sev, "missing"), permille(sev, "wrong_item"),
        ),
        handlingDamageLiable = wireOf(o.str("handlingDamageLiable")),
        holdHours = o.int("holdHours").also { require(it in 1..168) },
        holdSplit = HoldSplitPolicy(
            permille(split, "baseRestaurantPermille"),
            permille(split, "maxShiftPermille"),
            mapOf(
                Confidence.HIGH to permille(weights, "high"),
                Confidence.MEDIUM to permille(weights, "medium"),
                Confidence.LOW to permille(weights, "low"),
            ),
        ),
        counterRestaurantPermilleAfterClear = permille(counter, "restaurantPermilleAfterClear"),
    )
}

/** For the Remote Config `policy_json` string. */
fun policyFromJsonString(text: String): Policy = policyFrom(Json.parseToJsonElement(text).jsonObject)

fun orderFrom(o: JsonObject) = Order(
    id = o.str("id"),
    items = o.getValue("items").jsonArray.map { it.jsonObject.let { i -> OrderItem(i.str("id"), i.str("name"), i.long("price")) } },
    total = o.long("total"),
    sealCode = o.strOrNull("sealCode"),
)

fun claimFrom(o: JsonObject): EngineClaim {
    val ch = o.obj("challenge")
    require(ch.str("kind") == "fingers") { "unsupported challenge kind" }
    return EngineClaim(
        issueType = wireOf(o.str("issueType")),
        selectedItemIds = o.strings("selectedItemIds"),
        challenge = Challenge(ch.str("code"), ch.int("fingers"), ch.long("issuedAt"), ch.long("capturedAt"), ch.long("expiresAt")),
        challengeCheck = challengeCheckFrom(o.obj("challengeCheck")),
        damageCheck = o.objOrNull("damageCheck")?.let(::damageCheckFrom),
        moireScore = o.getValue("moireScore").jsonPrimitive.double,
        customerClaims30d = o.int("customerClaims30d"),
    )
}

fun reviewInputFrom(o: JsonObject?): ReviewInput? = when (o?.str("status")) {
    null -> null
    "unavailable" -> ReviewInput.Unavailable
    "ok" -> ReviewInput.Ok(o.bool("consistent"), o.strings("flags"))
    else -> throw IllegalArgumentException("bad review status")
}

/** Engine input in the vector/TS shape: dispatch and handoff are `{ check }` wrappers or null. */
fun engineInputFrom(o: JsonObject, policy: Policy) = EngineInput(
    order = orderFrom(o.obj("order")),
    dispatch = o.objOrNull("dispatch")?.let { dispatchCheckFrom(it.obj("check")) },
    handoff = o.objOrNull("handoff")?.let { handoffCheckFrom(it.obj("check")) },
    claim = claimFrom(o.obj("claim")),
    review = reviewInputFrom(o.objOrNull("review")),
    policy = policy,
)

private fun amountsJson(a: Amounts) = buildJsonObject {
    put("restaurant", a.restaurant)
    put("transit", a.transit)
    put("platform", a.platform)
}

fun decisionJson(d: EngineDecision): JsonObject = buildJsonObject {
    put("verdict", d.verdict.wire)
    put("refundAmount", d.refundAmount)
    put("assessedAmount", d.assessedAmount)
    put("currency", d.currency)
    put("liability", amountsJson(d.liability))
    put("liabilityCase", d.liabilityCase)
    if (d.split == null) put("split", JsonNull) else putJsonObject("split") {
        put("restaurantPermille", d.split.restaurantPermille)
        put("transitPermille", d.split.transitPermille)
    }
    put("reasons", JsonArray(d.reasons.map(::JsonPrimitive)))
    put("holdHours", d.holdHours?.let(::JsonPrimitive) ?: JsonNull)
    put("policyVersion", d.policyVersion)
}

fun resolutionJson(r: Resolution): JsonObject = buildJsonObject {
    put("outcome", r.outcome.wire)
    put("refundAmount", r.refundAmount)
    put("liability", amountsJson(r.liability))
    put("reasons", JsonArray(r.reasons.map(::JsonPrimitive)))
    put("policyVersion", r.policyVersion)
}
