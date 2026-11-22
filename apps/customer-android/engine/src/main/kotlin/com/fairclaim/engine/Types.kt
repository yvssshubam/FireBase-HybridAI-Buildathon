package com.fairclaim.engine

// Kotlin mirror of packages/schemas/src/types.ts. Wire names match the JSON schemas.

interface Wire { val wire: String }

inline fun <reified E> wireOf(s: String): E where E : Enum<E>, E : Wire =
    enumValues<E>().firstOrNull { it.wire == s } ?: throw IllegalArgumentException("unknown ${E::class.simpleName}: $s")

enum class Confidence(override val wire: String) : Wire { HIGH("high"), MEDIUM("medium"), LOW("low") }
enum class InferenceSource(override val wire: String) : Wire { ON_DEVICE("ON_DEVICE"), IN_CLOUD("IN_CLOUD") }
enum class SealState(override val wire: String) : Wire { INTACT("intact"), BROKEN("broken"), NOT_VISIBLE("not_visible") }
enum class DamageIssue(override val wire: String) : Wire {
    SPILLED("spilled"), CRUSHED("crushed"), MISSING("missing"), WRONG_ITEM("wrong_item"), FOREIGN_OBJECT("foreign_object"), NONE("none")
}
enum class Severity(override val wire: String) : Wire { NONE("none"), MINOR("minor"), PARTIAL("partial"), TOTAL("total") }
enum class IssueType(override val wire: String) : Wire { DAMAGED("damaged"), MISSING("missing"), WRONG_ITEM("wrong_item") }
enum class Party(override val wire: String) : Wire { RESTAURANT("restaurant"), TRANSIT("transit"), PLATFORM("platform") }
enum class Verdict(override val wire: String) : Wire { AUTO_REFUND("auto_refund"), HOLD("hold"), REVIEW("review") }

data class DispatchCheck(
    val sealIntact: Boolean,
    val sealCodeRead: String,
    val visibleItemCount: Int,
    val visibleItems: List<String>,
    val spillOrDamageVisible: Boolean,
    val confidence: Confidence,
)

data class HandoffCheck(val sealState: SealState, val sealCodeRead: String, val confidence: Confidence)

data class ChallengeCheck(
    val sealCodeRead: String,
    val fingersVisible: Int,
    val sealState: SealState,
    val photoOfScreenSuspected: Boolean,
    val confidence: Confidence,
)

data class DamageCheck(val matchedItem: String, val issue: DamageIssue, val severity: Severity, val confidence: Confidence)

data class ReviewOutput(
    val consistent: Boolean,
    val flags: List<String>,
    val explanationCustomerEn: String,
    val explanationCustomerHi: String,
    val explanationCustomerTa: String,
    val explanationRestaurant: String,
)

/** Only the "fingers" challenge exists today (two-angle is the §13 fallback if T4 fails). */
data class Challenge(val code: String, val fingers: Int, val issuedAt: Long, val capturedAt: Long, val expiresAt: Long)

data class EngineClaim(
    val issueType: IssueType,
    val selectedItemIds: List<String>,
    val challenge: Challenge,
    val challengeCheck: ChallengeCheck,
    val damageCheck: DamageCheck?,
    val moireScore: Double,
    val customerClaims30d: Int,
)

data class OrderItem(val id: String, val name: String, val price: Long)
data class Order(val id: String, val items: List<OrderItem>, val total: Long, val sealCode: String?)

data class SeverityPermille(val minor: Int, val partial: Int, val total: Int, val missing: Int, val wrongItem: Int)
data class HoldSplitPolicy(val baseRestaurantPermille: Int, val maxShiftPermille: Int, val confidenceWeightPermille: Map<Confidence, Int>)

data class Policy(
    val policyVersion: String,
    val autoApproveCap: Long,
    val claimHistoryLimit30d: Int,
    val challengeWindowSec: Int,
    val moireThreshold: Double,
    val severityPermille: SeverityPermille,
    val handlingDamageLiable: Party,
    val holdHours: Int,
    val holdSplit: HoldSplitPolicy,
    val counterRestaurantPermilleAfterClear: Int,
)

sealed interface ReviewInput {
    data class Ok(val consistent: Boolean, val flags: List<String>) : ReviewInput
    data object Unavailable : ReviewInput
}

data class EngineInput(
    val order: Order,
    val dispatch: DispatchCheck?,
    val handoff: HandoffCheck?,
    val claim: EngineClaim,
    /** null = preliminary decision before the cloud review has run. */
    val review: ReviewInput?,
    val policy: Policy,
)

data class Amounts(val restaurant: Long, val transit: Long, val platform: Long) {
    val sum: Long get() = restaurant + transit + platform

    companion object {
        val ZERO = Amounts(0, 0, 0)
        fun allTo(party: Party, amount: Long) = when (party) {
            Party.RESTAURANT -> Amounts(amount, 0, 0)
            Party.TRANSIT -> Amounts(0, amount, 0)
            Party.PLATFORM -> Amounts(0, 0, amount)
        }
    }
}

data class Split(val restaurantPermille: Int, val transitPermille: Int)

data class EngineDecision(
    val verdict: Verdict,
    val refundAmount: Long,
    val assessedAmount: Long,
    val liability: Amounts,
    val liabilityCase: String,
    val split: Split?,
    val reasons: List<String>,
    val holdHours: Int?,
    val policyVersion: String,
) {
    val currency: String get() = "INR"
}

enum class Outcome(override val wire: String) : Wire { SETTLED("settled"), REVIEW("review") }

data class Resolution(
    val outcome: Outcome,
    val refundAmount: Long,
    val liability: Amounts,
    val reasons: List<String>,
    val policyVersion: String,
)

class EngineException(val code: String) : RuntimeException(code)
