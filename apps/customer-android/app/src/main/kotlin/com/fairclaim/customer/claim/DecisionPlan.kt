package com.fairclaim.customer.claim

import com.fairclaim.customer.data.ClaimDoc
import com.fairclaim.customer.data.Doc
import com.fairclaim.customer.data.EvidenceDoc
import com.fairclaim.customer.data.Explanations
import com.fairclaim.customer.data.OrderDoc
import com.fairclaim.customer.data.StoredReview
import com.fairclaim.customer.data.decisionDoc
import com.fairclaim.customer.data.engineInputFor
import com.fairclaim.customer.data.holdDoc
import com.fairclaim.engine.EngineDecision
import com.fairclaim.engine.Policy
import com.fairclaim.engine.ReviewInput
import com.fairclaim.engine.ReviewOutput
import com.fairclaim.engine.decide

// Flow D on the phone. Money comes only from the Kotlin engine; the cloud review can only
// downgrade (cloud_review_flagged / cloud_review_unavailable → review) and explain.

/** Engine result before the review ran (review = null); its verdict and reasons go into the review prompt. */
fun preliminaryDecision(order: OrderDoc, dispatch: EvidenceDoc?, handoff: EvidenceDoc?, claim: ClaimDoc, policy: Policy): EngineDecision =
    decide(engineInputFor(order, dispatch, handoff, claim, null, policy))

data class DecisionPlan(
    val decision: EngineDecision,
    val review: StoredReview,
    val explanations: Explanations,
    val decisionDoc: Doc,
    /** Non-null exactly when the verdict is hold (same batch, rules). */
    val holdDoc: Doc?,
)

/** [reviewOutput] null = the review failed after its retry → stored as "unavailable". */
fun planDecision(
    order: OrderDoc,
    dispatch: EvidenceDoc?,
    handoff: EvidenceDoc?,
    claim: ClaimDoc,
    policy: Policy,
    customerId: String,
    reviewOutput: ReviewOutput?,
    reasons: ReasonTexts,
): DecisionPlan {
    val reviewInput: ReviewInput = reviewOutput?.let { ReviewInput.Ok(it.consistent, it.flags) } ?: ReviewInput.Unavailable
    val d = decide(engineInputFor(order, dispatch, handoff, claim, reviewInput, policy))
    val stored = reviewOutput?.let { StoredReview.Ok(it.consistent, it.flags) } ?: StoredReview.Unavailable
    val ex = reviewOutput?.let(::explanationsFrom) ?: fallbackExplanations(d, reasons)
    return DecisionPlan(
        decision = d,
        review = stored,
        explanations = ex,
        decisionDoc = decisionDoc(claim, customerId, order.restaurantId, d, stored, ex),
        holdDoc = holdDoc(claim.claimId, customerId, order.restaurantId, d, policy),
    )
}
