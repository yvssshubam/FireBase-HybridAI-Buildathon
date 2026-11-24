package com.fairclaim.customer.data

import com.fairclaim.customer.TestFiles
import com.fairclaim.engine.ReviewInput
import com.fairclaim.engine.decide
import com.fairclaim.engine.decisionJson
import com.fairclaim.engine.reviewInputFrom
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MappersTest {
    @Suppress("UNCHECKED_CAST")
    private fun fs(e: kotlinx.serialization.json.JsonElement): Map<String, Any?> = jsonToFirestore(e) as Map<String, Any?>

    /**
     * Every shared engine vector, pushed through the Firestore document shapes the app writes and
     * reads (orders/, dispatch/, handoff/, claims/), then parsed back and decided. If a mapper drops
     * or reshapes a field, the decision differs from the hand-written expectation.
     */
    @Test
    fun allEngineVectorsSurviveTheFirestoreRoundTrip() {
        val failures = mutableListOf<String>()
        for (e in TestFiles.vectors("engine.vectors.json")) {
            val v = e.jsonObject
            val name = v.getValue("name").jsonPrimitive.content
            val input = v.getValue("input").jsonObject
            val o = input.getValue("order").jsonObject
            val c = input.getValue("claim").jsonObject
            val orderDoc = fs(o) - "id" + mapOf(
                "restaurantId" to "rest1", "customerId" to "cust1", "itemIds" to o.getValue("items").jsonArray.map { it.jsonObject.getValue("id").jsonPrimitive.content },
                "status" to "delivered", "createdAt" to 1_700_000_000_000L,
            )
            val claimMap = fs(c) + mapOf(
                "claimId" to "c-1", "orderId" to o.getValue("id").jsonPrimitive.content, "customerId" to "cust1",
                "cropSha256" to null, "cropRef" to null, "inferenceSources" to mapOf("challenge" to "ON_DEVICE", "damage" to null), "createdAt" to 1L,
            )
            fun evidence(k: String) = (input[k] as? JsonObject)?.let { parseEvidence(k, "o", mapOf("check" to fs(it.getValue("check")), "inferenceSource" to "IN_CLOUD", "capturedAt" to 1L)) }
            try {
                val order = parseOrder(o.getValue("id").jsonPrimitive.content, orderDoc)
                val claim = parseClaim("c-1", claimMap)
                val review: ReviewInput? = reviewInputFrom(input["review"]?.takeUnless { it is JsonNull }?.jsonObject)
                val actual = decisionJson(decide(engineInputFor(order, evidence("dispatch"), evidence("handoff"), claim, review, TestFiles.policyFor(v))))
                if (actual != v.getValue("expected")) failures += "$name\n  expected ${v.getValue("expected")}\n  actual   $actual"
            } catch (x: Exception) {
                failures += "$name threw $x"
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test
    fun integersStayIntegers() {
        val m = mapOf("fingers" to 2L, "score" to 0.25, "whole" to 1.0, "ok" to true, "s" to "2", "n" to null, "l" to listOf(1L, "x"))
        val j = anyToJson(m) as JsonObject
        assertEquals("2", j.getValue("fingers").toString())
        assertEquals(JsonPrimitive("2"), j.getValue("s"))
        assertEquals(m, jsonToFirestore(j))
        assertEquals(2L, (jsonToFirestore(JsonPrimitive(2)) as Long))
        assertEquals(0.5, jsonToFirestore(JsonPrimitive(0.5)))
        assertNull(jsonToFirestore(JsonNull))
    }

    @Test
    fun parsesTheRestaurantAndItsMenu() {
        val r = parseRestaurant(
            "rest1",
            mapOf("name" to "Kitchen", "pairCode" to "ABC234", "createdAt" to 1L, "menu" to mapOf(
                "raita" to mapOf("name" to "Raita", "price" to 80L),
                "biryani" to mapOf("name" to "Chicken Biryani", "price" to 380L),
            )),
        )
        assertEquals(listOf("Chicken Biryani", "Raita"), r.menu.map { it.name })
        assertEquals(MenuItem("biryani", "Chicken Biryani", 380), r.menu.first())
    }

    @Test
    fun parsesDecisionsAndHolds() {
        val d = parseDecision(
            "c-1",
            mapOf(
                "claimId" to "c-1", "orderId" to "o-1", "customerId" to "cust1", "restaurantId" to "rest1", "verdict" to "hold",
                "refundAmount" to 108L, "assessedAmount" to 108L, "currency" to "INR",
                "liability" to mapOf("restaurant" to 32L, "transit" to 76L, "platform" to 0L), "liabilityCase" to "hold_damage_no_handoff",
                "split" to mapOf("restaurantPermille" to 300L, "transitPermille" to 700L), "reasons" to listOf("dispatch_valid", "handoff_missing"),
                "holdHours" to 48L, "review" to mapOf("status" to "unavailable"),
                "explanations" to mapOf("customer_en" to "x", "customer_hi" to "", "customer_ta" to "", "restaurant" to "y"),
                "engine" to "kotlin", "policyVersion" to "v1", "createdAt" to 5L,
            ),
        )
        assertEquals(300 to 700, d.split)
        assertEquals(48, d.holdHours)
        assertEquals("unavailable", d.reviewStatus)
        val h = parseHold("c-1", mapOf("claimId" to "c-1", "amount" to 108L, "state" to "held", "holdHours" to 48L, "createdAt" to 1_000L))
        assertEquals(1_000L + 48 * 3_600_000L, h.endsAt)
        assertNull(parseHold("c-1", mapOf("claimId" to "c-1", "amount" to 1L, "state" to "held", "holdHours" to 48L, "createdAt" to null)).endsAt)
    }

    @Test(expected = DocError::class)
    fun rejectsMalformedDocs() {
        parseOrder("o-1", mapOf("restaurantId" to "r", "customerId" to "c", "items" to "nope", "total" to 1L, "status" to "placed"))
    }
}
