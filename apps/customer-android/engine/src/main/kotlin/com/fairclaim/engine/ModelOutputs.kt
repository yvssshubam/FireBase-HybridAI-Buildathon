package com.fairclaim.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

// Raw model text → validated, normalized check. Mirrors
// packages/schemas/src/modelOutput.ts; model-output.vectors.json pins both.
// The JSON Schemas in packages/schemas/schemas are the contract; the checks
// below are their hand-written equivalent (no JSON Schema library on Android).

enum class ModelKind(override val wire: String) : Wire {
    DISPATCH("dispatch"), HANDOFF("handoff"), CHALLENGE("challenge"), DAMAGE("damage"), REVIEW("review")
}

sealed interface ModelParse {
    /** [json] is the normalized object exactly as it should be stored. */
    data class Ok(val json: JsonObject) : ModelParse
    data class Err(val error: String, val detail: String = "") : ModelParse
}

private enum class Field { RAW, CODE, ENUM, TEXT60, TEXT600, ITEMS, FLAGS }

private val FIELDS: Map<ModelKind, Map<String, Field>> = mapOf(
    ModelKind.DISPATCH to linkedMapOf(
        "seal_intact" to Field.RAW, "seal_code_read" to Field.CODE, "visible_item_count" to Field.RAW,
        "visible_items" to Field.ITEMS, "spill_or_damage_visible" to Field.RAW, "confidence" to Field.ENUM,
    ),
    ModelKind.HANDOFF to linkedMapOf("seal_state" to Field.ENUM, "seal_code_read" to Field.CODE, "confidence" to Field.ENUM),
    ModelKind.CHALLENGE to linkedMapOf(
        "seal_code_read" to Field.CODE, "fingers_visible" to Field.RAW, "seal_state" to Field.ENUM,
        "photo_of_screen_suspected" to Field.RAW, "confidence" to Field.ENUM,
    ),
    ModelKind.DAMAGE to linkedMapOf("matched_item" to Field.TEXT60, "issue" to Field.ENUM, "severity" to Field.ENUM, "confidence" to Field.ENUM),
    ModelKind.REVIEW to linkedMapOf(
        "consistent" to Field.RAW, "flags" to Field.FLAGS, "explanation_customer_en" to Field.TEXT600,
        "explanation_customer_hi" to Field.TEXT600, "explanation_customer_ta" to Field.TEXT600, "explanation_restaurant" to Field.TEXT600,
    ),
)

val REVIEW_FLAGS = listOf(
    "claimed_item_not_in_order", "issue_type_inconsistent", "dispatch_contradiction", "handoff_contradiction", "timeline_inconsistent", "other",
)
private val CONFIDENCE = setOf("high", "medium", "low")
private val SEAL_STATES = setOf("intact", "broken", "not_visible")
private val ISSUES = setOf("spilled", "crushed", "missing", "wrong_item", "foreign_object", "none")
private val SEVERITIES = setOf("none", "minor", "partial", "total")
private val CODE_PATTERN = Regex("^([0-9]{4})?$")
private val NON_DIGIT = Regex("[^0-9]")

/** Model may wrap JSON in prose or ``` fences; take the outermost {...}. */
fun extractJson(text: String): String? {
    val start = text.indexOf('{')
    val end = text.lastIndexOf('}')
    return if (start >= 0 && end > start) text.substring(start, end + 1) else null
}

// Same character set as JavaScript's String.prototype.trim().
private fun isJsWhitespace(c: Char) = c in "\t\n\u000B\u000C\r       　﻿" || c in ' '..' '
private fun String.jsTrim(): String = trim(::isJsWhitespace)

private fun JsonElement.stringOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonElement.isBool(): Boolean = this is JsonPrimitive && this !is JsonNull && !isString && booleanOrNull != null

/** A JSON number with an integral value (2 and 2.0 both count), else null. */
private fun JsonElement.integralOrNull(): Long? {
    if (this !is JsonPrimitive || this is JsonNull || isString || booleanOrNull != null) return null
    val d = content.toDoubleOrNull() ?: return null
    if (d.isInfinite() || d != Math.floor(d)) return null
    return d.toLong()
}

fun normalizeSealCode(raw: JsonElement): JsonElement {
    val s = raw.stringOrNull() ?: raw.integralOrNull()?.takeIf { it >= 0 }?.toString() ?: return raw
    val digits = s.replace(NON_DIGIT, "")
    return JsonPrimitive(if (digits.length == 4) digits else "")
}

private fun allStrings(e: JsonElement): List<String>? =
    (e as? JsonArray)?.map { it.stringOrNull() ?: return null }

private fun normalize(field: Field, v: JsonElement): JsonElement = when (field) {
    Field.RAW -> v.integralOrNull()?.let { JsonPrimitive(it) } ?: v
    Field.CODE -> normalizeSealCode(v)
    Field.ENUM -> v.stringOrNull()?.let { JsonPrimitive(it.jsTrim().lowercase()) } ?: v
    Field.TEXT60 -> v.stringOrNull()?.let { JsonPrimitive(it.jsTrim().take(60)) } ?: v
    Field.TEXT600 -> v.stringOrNull()?.let { JsonPrimitive(it.jsTrim().take(600)) } ?: v
    Field.ITEMS -> allStrings(v)?.let { items ->
        JsonArray(items.map { it.jsTrim().take(60) }.filter { it.isNotEmpty() }.take(20).map(::JsonPrimitive))
    } ?: v
    Field.FLAGS -> allStrings(v)?.let { flags ->
        val out = LinkedHashSet<String>()
        flags.forEach { f -> f.jsTrim().lowercase().let { out += if (it in REVIEW_FLAGS) it else "other" } }
        JsonArray(out.take(6).map(::JsonPrimitive))
    } ?: v
}

private class Checker(val o: JsonObject) {
    var error: String? = null
    private fun fail(msg: String) { if (error == null) error = msg }
    fun bool(k: String) { if (o[k]?.isBool() != true) fail("/$k must be boolean") }
    fun int(k: String, min: Long, max: Long) { val n = o[k]?.integralOrNull(); if (n == null || n < min || n > max) fail("/$k must be integer in [$min,$max]") }
    fun oneOf(k: String, allowed: Set<String>) { if (o[k]?.stringOrNull() !in allowed) fail("/$k must be one of $allowed") }
    fun code(k: String) { val s = o[k]?.stringOrNull(); if (s == null || !CODE_PATTERN.matches(s)) fail("/$k must be 4 digits or empty") }
    fun text(k: String, max: Int, min: Int = 0) {
        val s = o[k]?.stringOrNull()
        val n = s?.codePointCount(0, s.length)
        if (n == null || n < min || n > max) fail("/$k must be a string of length [$min,$max]")
    }
    fun stringList(k: String, maxItems: Int, minLen: Int, maxLen: Int) {
        val items = o[k]?.let(::allStrings)
        if (items == null || items.size > maxItems || items.any { it.codePointCount(0, it.length) !in minLen..maxLen }) fail("/$k invalid list")
    }
    fun flags(k: String) {
        val items = o[k]?.let(::allStrings)
        if (items == null || items.size > 6 || items.toSet().size != items.size || items.any { it !in REVIEW_FLAGS }) fail("/$k invalid flags")
    }
}

private fun validate(kind: ModelKind, o: JsonObject): String? {
    val missing = FIELDS.getValue(kind).keys.firstOrNull { it !in o }
    if (missing != null) return "must have required property '$missing'"
    val c = Checker(o)
    when (kind) {
        ModelKind.DISPATCH -> {
            c.bool("seal_intact"); c.code("seal_code_read"); c.int("visible_item_count", 0, 50)
            c.stringList("visible_items", 20, 1, 60); c.bool("spill_or_damage_visible"); c.oneOf("confidence", CONFIDENCE)
        }
        ModelKind.HANDOFF -> { c.oneOf("seal_state", SEAL_STATES); c.code("seal_code_read"); c.oneOf("confidence", CONFIDENCE) }
        ModelKind.CHALLENGE -> {
            c.code("seal_code_read"); c.int("fingers_visible", 0, 10); c.oneOf("seal_state", SEAL_STATES)
            c.bool("photo_of_screen_suspected"); c.oneOf("confidence", CONFIDENCE)
        }
        ModelKind.DAMAGE -> { c.text("matched_item", 60); c.oneOf("issue", ISSUES); c.oneOf("severity", SEVERITIES); c.oneOf("confidence", CONFIDENCE) }
        ModelKind.REVIEW -> {
            c.bool("consistent"); c.flags("flags")
            listOf("explanation_customer_en", "explanation_customer_hi", "explanation_customer_ta", "explanation_restaurant").forEach { c.text(it, 600) }
        }
    }
    return c.error
}

fun parseModelOutput(kind: ModelKind, text: String): ModelParse {
    val json = extractJson(text) ?: return ModelParse.Err("no_json")
    val parsed = try {
        Json.parseToJsonElement(json)
    } catch (e: IllegalArgumentException) { // kotlinx SerializationException extends IllegalArgumentException
        return ModelParse.Err("bad_json", e.message ?: "")
    }
    // extractJson always yields "{...}", so a successful parse is an object.
    val src = parsed as JsonObject
    val out = LinkedHashMap<String, JsonElement>()
    for ((key, field) in FIELDS.getValue(kind)) src[key]?.let { out[key] = normalize(field, it) }
    val normalized = JsonObject(out)
    validate(kind, normalized)?.let { return ModelParse.Err("schema", it) }
    return ModelParse.Ok(normalized)
}
