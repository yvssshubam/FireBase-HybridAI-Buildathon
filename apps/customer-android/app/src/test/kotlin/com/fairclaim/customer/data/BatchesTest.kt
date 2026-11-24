package com.fairclaim.customer.data

import com.fairclaim.customer.TestFiles
import com.fairclaim.customer.claim.ReasonTexts
import com.fairclaim.customer.claim.planDecision
import com.fairclaim.engine.ReviewOutput
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

// Field-for-field against dev/customer-sim.ts (which is known to pass the rules) and the
// exactKeys(...) lists in firestore.rules. A key added or dropped here is a permission error.
class BatchesTest {
    private val restaurant = Restaurant(
        "rest1", "Kitchen",
        listOf(MenuItem("biryani", "Chicken Biryani", 380), MenuItem("gulab-jamun", "Gulab Jamun", 180), MenuItem("raita", "Raita", 80)),
    )
    private val order = OrderDoc(
        "o-1", "rest1", "cust1",
        listOf(OrderLine("biryani", "Chicken Biryani", 380), OrderLine("gulab-jamun", "Gulab Jamun", 180)),
        560, OrderStatus.DELIVERED, "4721", 1L,
    )
    private val challengeCheck = anyToJson(mapOf("seal_code_read" to "4721", "fingers_visible" to 2L, "seal_state" to "broken", "photo_of_screen_suspected" to false, "confidence" to "high")) as JsonObject
    private val damageCheck = anyToJson(mapOf("matched_item" to "Gulab Jamun", "issue" to "spilled", "severity" to "partial", "confidence" to "high")) as JsonObject

    @Test
    fun userDocMatchesTheTermsGate() {
        assertEquals(mapOf("termsVersion" to "2026-11-22", "acceptedAt" to ServerTimestamp, "role" to "customer"), userDoc())
    }

    @Test
    fun orderCopiesNamesAndPricesFromTheMenu() {
        val d = orderDoc(restaurant, "cust1", listOf("biryani", "gulab-jamun"))
        assertEquals(setOf("restaurantId", "customerId", "items", "itemIds", "total", "status", "sealCode", "createdAt"), d.keys)
        assertEquals(
            listOf(mapOf("id" to "biryani", "name" to "Chicken Biryani", "price" to 380L), mapOf("id" to "gulab-jamun", "name" to "Gulab Jamun", "price" to 180L)),
            d["items"],
        )
        assertEquals(listOf("biryani", "gulab-jamun"), d["itemIds"])
        assertEquals(560L, d["total"])
        assertEquals("placed", d["status"])
        assertNull(d["sealCode"])
        assertSame(ServerTimestamp, d["createdAt"])
    }

    @Test(expected = IllegalArgumentException::class)
    fun orderRejectsDuplicates() {
        orderDoc(restaurant, "cust1", listOf("raita", "raita"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun orderRejectsMoreThanFiveLines() {
        val big = restaurant.copy(menu = (1..6).map { MenuItem("m$it", "Dish $it", 10) })
        orderDoc(big, "cust1", (1..6).map { "m$it" })
    }

    @Test
    fun handoffChallengeAndDelivered() {
        val check = anyToJson(mapOf("seal_state" to "intact", "seal_code_read" to "4721", "confidence" to "high")) as JsonObject
        assertEquals(
            mapOf("check" to mapOf("seal_state" to "intact", "seal_code_read" to "4721", "confidence" to "high"), "inferenceSource" to "ON_DEVICE", "capturedAt" to 123L, "recordedAt" to ServerTimestamp),
            handoffDoc(check, "ON_DEVICE", 123L),
        )
        assertEquals(mapOf("status" to "delivered", "deliveredAt" to ServerTimestamp), deliveredUpdate())
        assertEquals(
            mapOf("customerId" to "cust1", "orderId" to "o-1", "restaurantId" to "rest1", "kind" to "fingers", "fingers" to 2, "issuedAt" to ServerTimestamp),
            challengeDoc("cust1", order, 2),
        )
    }

    private fun evidence(issueType: String) = ClaimEvidence(
        claimId = "c-1", order = order, customerId = "cust1", issueType = issueType,
        selectedItemIds = listOf("gulab-jamun"), fingers = 2, issuedAt = 1_000_000L, capturedAt = 1_012_000L, challengeWindowSec = 60,
        challengeCheck = challengeCheck, damageCheck = if (issueType == "missing") null else damageCheck, moireScore = 0.08,
        cropSha256 = if (issueType == "missing") null else "ab".repeat(32),
        challengeSource = "ON_DEVICE", damageSource = if (issueType == "missing") null else "IN_CLOUD", customerClaims30d = 0,
    )

    @Test
    fun claimBatchMatchesCustomerSim() {
        val d = claimDoc(evidence("damaged"))
        assertEquals(
            setOf("claimId", "orderId", "customerId", "issueType", "selectedItemIds", "challenge", "challengeCheck", "damageCheck", "moireScore", "cropSha256", "cropRef", "inferenceSources", "customerClaims30d", "createdAt"),
            d.keys,
        )
        assertEquals(
            mapOf("kind" to "fingers", "code" to "4721", "fingers" to 2, "issuedAt" to 1_000_000L, "capturedAt" to 1_012_000L, "expiresAt" to 1_060_000L),
            d["challenge"],
        )
        assertEquals(mapOf("seal_code_read" to "4721", "fingers_visible" to 2L, "seal_state" to "broken", "photo_of_screen_suspected" to false, "confidence" to "high"), d["challengeCheck"])
        assertEquals(mapOf("matched_item" to "Gulab Jamun", "issue" to "spilled", "severity" to "partial", "confidence" to "high"), d["damageCheck"])
        assertEquals("claims/c-1/crop.jpg", d["cropRef"])
        assertEquals(mapOf("challenge" to "ON_DEVICE", "damage" to "IN_CLOUD"), d["inferenceSources"])
        assertEquals(0.08, d["moireScore"])
        assertSame(ServerTimestamp, d["createdAt"])

        assertEquals(mapOf("lastClaimAt" to ServerTimestamp, "countToday" to 3), rateLimitDoc(3))
        assertEquals(mapOf("claimId" to "c-1", "customerId" to "cust1"), claimsByOrderDoc("c-1", "cust1"))
    }

    @Test
    fun missingItemClaimHasNoCrop() {
        val d = claimDoc(evidence("missing"))
        assertNull(d["damageCheck"])
        assertNull(d["cropSha256"])
        assertNull(d["cropRef"])
        assertEquals(mapOf("challenge" to "ON_DEVICE", "damage" to null), d["inferenceSources"])
    }

    @Test(expected = IllegalArgumentException::class)
    fun damageClaimNeedsTheCrop() {
        claimDoc(evidence("damaged").copy(cropSha256 = null))
    }

    private fun storedClaim(issueType: String): ClaimDoc {
        @Suppress("UNCHECKED_CAST")
        val m = (claimDoc(evidence(issueType)) - "createdAt") + ("createdAt" to 2L)
        return parseClaim("c-1", m)
    }

    private val reasons by lazy { ReasonTexts.parse(TestFiles.reasonCodesJson) }

    @Test
    fun decisionDocHasExactlyTheRuleKeys() {
        val review = ReviewOutput(true, emptyList(), "Approved.", "स्वीकृत।", "அனுமதிக்கப்பட்டது.", "Transit pays.")
        val dispatch = EvidenceDoc("o-1", anyToJson(mapOf("seal_intact" to true, "seal_code_read" to "4721", "spill_or_damage_visible" to false, "confidence" to "high")) as JsonObject, "ON_DEVICE")
        val handoff = EvidenceDoc("o-1", anyToJson(mapOf("seal_state" to "intact", "seal_code_read" to "4721", "confidence" to "high")) as JsonObject, "ON_DEVICE")
        val plan = planDecision(order, dispatch, handoff, storedClaim("damaged"), TestFiles.policy, "cust1", review, reasons)
        assertEquals(
            setOf("claimId", "orderId", "customerId", "restaurantId", "verdict", "refundAmount", "assessedAmount", "currency", "liability", "liabilityCase",
                "split", "reasons", "holdHours", "review", "explanations", "engine", "policyVersion", "createdAt"),
            plan.decisionDoc.keys,
        )
        // Same numbers as the "gate: happy path" vector, at the high-confidence crop: 180 × 0.6 = 108, transit pays.
        assertEquals("auto_refund", plan.decisionDoc["verdict"])
        assertEquals(108L, plan.decisionDoc["refundAmount"])
        assertEquals(mapOf("restaurant" to 0L, "transit" to 108L, "platform" to 0L), plan.decisionDoc["liability"])
        assertEquals(mapOf("status" to "ok", "consistent" to true, "flags" to emptyList<String>()), plan.decisionDoc["review"])
        assertEquals(mapOf("customer_en" to "Approved.", "customer_hi" to "स्वीकृत।", "customer_ta" to "அனுமதிக்கப்பட்டது.", "restaurant" to "Transit pays."), plan.decisionDoc["explanations"])
        assertEquals("kotlin", plan.decisionDoc["engine"])
        assertNull(plan.decisionDoc["split"])
        assertNull(plan.decisionDoc["holdHours"])
        assertNull(plan.holdDoc)
    }

    @Test
    fun holdIsWrittenWithTheDecisionAndMatchesIt() {
        // No handoff snap on a damage claim with a clean dispatch → confidence-weighted hold (30/70).
        val dispatch = EvidenceDoc("o-1", anyToJson(mapOf("seal_intact" to true, "seal_code_read" to "4721", "spill_or_damage_visible" to false, "confidence" to "high")) as JsonObject, "ON_DEVICE")
        val review = ReviewOutput(true, emptyList(), "a", "b", "c", "d")
        val plan = planDecision(order, dispatch, null, storedClaim("damaged"), TestFiles.policy, "cust1", review, reasons)
        assertEquals("hold", plan.decisionDoc["verdict"])
        val hold = requireNotNull(plan.holdDoc)
        assertEquals(setOf("claimId", "customerId", "restaurantId", "amount", "parties", "state", "holdHours", "createdAt"), hold.keys)
        assertEquals(plan.decisionDoc["refundAmount"], hold["amount"])
        assertEquals(plan.decisionDoc["liability"], hold["parties"]) // rules: d.parties == dec.liability
        assertEquals("held", hold["state"])
        assertEquals(48, hold["holdHours"])
        assertEquals(48L, plan.decisionDoc["holdHours"])
        assertEquals(mapOf("restaurantPermille" to 300L, "transitPermille" to 700L), plan.decisionDoc["split"])
        assertEquals(mapOf("state" to "settled", "resolvedAt" to ServerTimestamp), holdSettleUpdate())
    }

    @Test
    fun unavailableReviewDowngradesAndSaysSo() {
        val plan = planDecision(order, null, null, storedClaim("missing"), TestFiles.policy, "cust1", null, reasons)
        assertEquals("review", plan.decisionDoc["verdict"])
        assertEquals(0L, plan.decisionDoc["refundAmount"])
        assertEquals(mapOf("status" to "unavailable"), plan.decisionDoc["review"])
        @Suppress("UNCHECKED_CAST")
        val ex = plan.decisionDoc["explanations"] as Map<String, String>
        assert(ex.getValue("customer_en").contains("person to review")) { ex }
        assertEquals("", ex["customer_hi"])
        assert((plan.decisionDoc["reasons"] as List<*>).contains("cloud_review_unavailable"))
        assertNull(plan.holdDoc)
    }
}
