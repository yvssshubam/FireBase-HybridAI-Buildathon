package com.fairclaim.customer.claim

import com.fairclaim.customer.ai.CheckResult
import com.fairclaim.customer.ai.FairClaimAi
import com.fairclaim.customer.ai.reviewInputJson
import com.fairclaim.customer.ai.reviewPrompt
import com.fairclaim.customer.data.Repository
import com.fairclaim.customer.firebase.LoadedPolicy
import com.fairclaim.engine.reviewOutputFrom

/**
 * Flow D, run on the phone right after the claim is stored (and again from the order screen if the
 * app was closed in between). Everything is read back from Firestore, so the input is exactly what
 * the restaurant's replay audit will rebuild.
 */
class DecisionRunner(private val repo: Repository, private val ai: FairClaimAi, private val reasons: ReasonTexts) {

    class PolicyMismatch(app: String, server: String?) :
        IllegalStateException("This app uses policy $app but the server expects ${server ?: "no policy (config/policy missing)"}. Update Remote Config / config/policy so they match.")

    data class Result(val plan: DecisionPlan, val reviewWorked: Boolean)

    suspend fun run(claimId: String, uid: String, policy: LoadedPolicy, progress: (String) -> Unit = {}): Result {
        progress("Reading the evidence")
        val claim = repo.claim(claimId) ?: error("claim $claimId not found")
        val order = repo.order(claim.orderId) ?: error("order ${claim.orderId} not found")
        val dispatch = repo.dispatchOnce(order.id)
        val handoff = repo.handoffOnce(order.id)
        val serverVersion = repo.serverPolicyVersion()
        if (serverVersion != policy.policy.policyVersion) throw PolicyMismatch(policy.policy.policyVersion, serverVersion)

        val preliminary = preliminaryDecision(order, dispatch, handoff, claim, policy.policy)
        progress("Cloud review and explanations")
        val review = when (val r = ai.review(reviewPrompt(reviewInputJson(order, dispatch, handoff, claim, preliminary)))) {
            is CheckResult.Ok -> reviewOutputFrom(r.json)
            is CheckResult.Failed -> null // stored as "unavailable"; the engine downgrades to review
        }
        val plan = planDecision(order, dispatch, handoff, claim, policy.policy, uid, review, reasons)
        progress("Saving the decision")
        repo.commitDecision(claimId, plan.decisionDoc, plan.holdDoc)
        return Result(plan, review != null)
    }
}
