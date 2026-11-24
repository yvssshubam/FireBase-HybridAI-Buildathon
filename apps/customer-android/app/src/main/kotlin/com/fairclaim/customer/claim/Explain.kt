package com.fairclaim.customer.claim

import com.fairclaim.customer.data.Explanations
import com.fairclaim.engine.EngineDecision
import com.fairclaim.engine.ReviewOutput
import com.fairclaim.engine.Verdict
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** packages/schemas/reason-codes.json (bundled as an asset): stable code → English text. */
class ReasonTexts(private val texts: Map<String, String>) {
    fun text(code: String): String = texts[code] ?: code

    companion object {
        fun parse(json: String) = ReasonTexts(Json.parseToJsonElement(json).jsonObject.mapValues { it.value.jsonPrimitive.content })
    }
}

/** Explanations are shown as plain text; the rules allow 2400 chars, the UI shows at most 600. */
const val EXPLANATION_MAX = 600

fun capExplanation(s: String): String = s.trim().let { if (it.length <= EXPLANATION_MAX) it else it.take(EXPLANATION_MAX - 1).trimEnd() + "…" }

fun explanationsFrom(r: ReviewOutput) = Explanations(
    customerEn = capExplanation(r.explanationCustomerEn),
    customerHi = capExplanation(r.explanationCustomerHi),
    customerTa = capExplanation(r.explanationCustomerTa),
    restaurant = capExplanation(r.explanationRestaurant),
)

/**
 * Used when the cloud review is unavailable: written by the app from the engine's result, never
 * by a model, and says so. Hindi/Tamil stay empty rather than machine-free guesses.
 */
fun fallbackExplanations(d: EngineDecision, reasons: ReasonTexts): Explanations {
    val customer = when (d.verdict) {
        Verdict.AUTO_REFUND -> "Your photo passed the capture checks, so the refund was approved straight away."
        Verdict.HOLD -> "Your photo passed the capture checks. The refund is approved and held for ${d.holdHours ?: 48} hours while the evidence about who pays is settled."
        Verdict.REVIEW -> "This claim needs a person to review it before any refund."
    }
    val facts = d.reasons.take(3).joinToString("; ") { reasons.text(it) }
    return Explanations(
        customerEn = capExplanation("$customer The written review was unavailable, so this note comes from the rules."),
        customerHi = "",
        customerTa = "",
        restaurant = capExplanation("Decided by the FairClaim rules (review unavailable). $facts."),
    )
}
