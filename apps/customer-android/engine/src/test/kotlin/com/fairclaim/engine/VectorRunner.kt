package com.fairclaim.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

/**
 * Runs the shared vectors from packages/schemas/test-vectors against the Kotlin
 * engine. Returns one message per failing vector (empty = all pass). Kept free
 * of JUnit so it can also run from a plain main().
 */
class VectorRunner(private val vectorsDir: File, policyFile: File) {
    private val basePolicy: JsonObject = Json.parseToJsonElement(policyFile.readText()).jsonObject

    private fun load(name: String): JsonArray = Json.parseToJsonElement(File(vectorsDir, name).readText()).jsonArray

    private fun policy(v: JsonObject): Policy {
        val patch = v["policyPatch"]?.jsonObject ?: JsonObject(emptyMap())
        return policyFrom(JsonObject(basePolicy + patch))
    }

    private fun name(v: JsonObject) = v.getValue("name").jsonPrimitive.content

    private fun diff(name: String, expected: JsonElement, actual: JsonElement) =
        if (expected == actual) null else "$name\n  expected: $expected\n  actual:   $actual"

    fun engine(): List<String> = load("engine.vectors.json").mapNotNull { e ->
        val v = e.jsonObject
        val n = name(v)
        runCatching {
            val d = decide(engineInputFrom(v.getValue("input").jsonObject, policy(v)))
            check(d.liability.sum == d.refundAmount) { "liability does not add up" }
            diff(n, v.getValue("expected"), decisionJson(d))
        }.getOrElse { "$n threw $it" }
    }

    fun counterEvidence(): List<String> = load("counter-evidence.vectors.json").mapNotNull { e ->
        val v = e.jsonObject
        val n = name(v)
        val expected = v.getValue("expected").jsonObject
        runCatching {
            val input = engineInputFrom(v.getValue("input").jsonObject, policy(v))
            val decision = decide(input)
            val counter = dispatchCheckFrom(v.getValue("counterCheck").jsonObject)
            val expectedError = expected["error"]?.jsonPrimitive?.content
            if (expectedError != null) {
                try {
                    resolveCounterEvidence(input, decision, counter)
                    "$n: expected error $expectedError"
                } catch (x: EngineException) {
                    if (x.code == expectedError) null else "$n: error ${x.code} != $expectedError"
                }
            } else {
                diff(n, expected, resolutionJson(resolveCounterEvidence(input, decision, counter)))
            }
        }.getOrElse { "$n threw $it" }
    }

    fun modelOutput(): List<String> = load("model-output.vectors.json").mapNotNull { e ->
        val v = e.jsonObject
        val n = "${v.getValue("kind").jsonPrimitive.content}: ${name(v)}"
        val kind = wireOf<ModelKind>(v.getValue("kind").jsonPrimitive.content)
        val expected = v.getValue("expected").jsonObject
        runCatching {
            val r = parseModelOutput(kind, v.getValue("text").jsonPrimitive.content)
            val wantOk = expected.getValue("ok").jsonPrimitive.boolean
            when {
                wantOk && r is ModelParse.Ok -> diff(n, expected.getValue("value"), r.json) ?: typedRoundTrip(n, kind, r.json)
                !wantOk && r is ModelParse.Err ->
                    if (r.error == expected.getValue("error").jsonPrimitive.content) null else "$n: error ${r.error} (${r.detail})"
                else -> "$n: expected ok=$wantOk, got $r"
            }
        }.getOrElse { "$n threw $it" }
    }

    /** Every accepted model output must also convert to the typed check without throwing. */
    private fun typedRoundTrip(n: String, kind: ModelKind, json: JsonObject): String? = runCatching {
        when (kind) {
            ModelKind.DISPATCH -> check(dispatchCheckJson(dispatchCheckFrom(json)) == json)
            ModelKind.HANDOFF -> handoffCheckFrom(json)
            ModelKind.CHALLENGE -> challengeCheckFrom(json)
            ModelKind.DAMAGE -> damageCheckFrom(json)
            ModelKind.REVIEW -> reviewOutputFrom(json)
        }
        null
    }.getOrElse { "$n typed conversion failed: $it" }

    fun itemMatch(): List<String> = load("item-match.vectors.json").mapNotNull { e ->
        val v = e.jsonObject
        val a = v.getValue("a").jsonPrimitive.content
        val b = v.getValue("b").jsonPrimitive.content
        val want = v.getValue("expected").jsonPrimitive.boolean
        if (namesMatch(a, b) == want && namesMatch(b, a) == want) null else "namesMatch(\"$a\", \"$b\") != $want"
    }

    fun count(name: String) = load(name).size

    companion object {
        fun fromSystemProperties(): VectorRunner {
            val dir = System.getProperty("fairclaim.vectors") ?: error("system property fairclaim.vectors not set")
            val policy = System.getProperty("fairclaim.policy") ?: error("system property fairclaim.policy not set")
            return VectorRunner(File(dir), File(policy))
        }
    }
}
