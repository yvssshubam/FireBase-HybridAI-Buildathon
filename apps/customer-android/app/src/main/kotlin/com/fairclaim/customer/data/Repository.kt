package com.fairclaim.customer.data

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import com.google.firebase.firestore.snapshots
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageException
import com.google.firebase.storage.storageMetadata
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

// Every Firestore / Storage call of the customer app, in the shapes Batches.kt builds and the
// order dev/customer-sim.ts proved against the rules. Reads of other customers' or restaurants'
// data are impossible by rules; queries always filter on customerId == uid so the rules can
// prove them.

class Repository(private val auth: FirebaseAuth, private val db: FirebaseFirestore, private val storage: FirebaseStorage) {

    suspend fun signIn(): String {
        auth.currentUser?.let { return it.uid }
        val user = auth.signInAnonymously().await().user ?: error("anonymous sign-in returned no user")
        return user.uid
    }

    // ---- users (Terms gate, §23) ----
    suspend fun termsAccepted(uid: String): Boolean {
        val d = db.collection("users").document(uid).get().await()
        return d.getString("termsVersion") == TERMS_VERSION && d.getString("role") == "customer"
    }

    suspend fun acceptTerms(uid: String) {
        db.collection("users").document(uid).set(userDoc().forFirestore()).await()
    }

    // ---- pairing + menu ----
    /** null when no restaurant has this code (the web app shows it under the QR). */
    suspend fun restaurantForPairCode(code: String): Restaurant? {
        val pair = db.collection("pairCodes").document(code).get().await()
        val restaurantId = pair.getString("restaurantId") ?: return null
        return restaurant(restaurantId)
    }

    suspend fun restaurant(id: String): Restaurant? {
        val d = db.collection("restaurants").document(id).get().await()
        return d.plainData()?.let { parseRestaurant(id, it) }
    }

    // ---- orders ----
    suspend fun placeOrder(restaurant: Restaurant, uid: String, itemIds: List<String>): String {
        val id = newId("o")
        db.collection("orders").document(id).set(orderDoc(restaurant, uid, itemIds).forFirestore()).await()
        return id
    }

    fun myOrders(uid: String): Flow<List<OrderDoc>> =
        // Single-field equality: no composite index needed; sorted on the phone.
        db.collection("orders").whereEqualTo("customerId", uid).snapshots().map { s ->
            s.documents.mapNotNull { d -> parsed("orders/${d.id}") { d.plainData()?.let { parseOrder(d.id, it) } } }
                .sortedByDescending { it.createdAt ?: Long.MAX_VALUE }
        }

    suspend fun order(id: String): OrderDoc? = getDoc("orders", id)?.let { parseOrder(id, it) }

    suspend fun markDelivered(orderId: String) {
        db.collection("orders").document(orderId).update(deliveredUpdate().forFirestore()).await()
    }

    // ---- evidence ----
    fun handoff(orderId: String): Flow<EvidenceDoc?> =
        db.collection("handoff").document(orderId).snapshots().map { d -> d.plainData()?.let { parseEvidence("handoff", orderId, it) } }

    suspend fun handoffOnce(orderId: String): EvidenceDoc? = getDoc("handoff", orderId)?.let { parseEvidence("handoff", orderId, it) }

    suspend fun dispatchOnce(orderId: String): EvidenceDoc? = getDoc("dispatch", orderId)?.let { parseEvidence("dispatch", orderId, it) }

    suspend fun writeHandoff(orderId: String, doc: Doc) {
        db.collection("handoff").document(orderId).set(doc.forFirestore()).await()
    }

    // ---- claim (Flow C) ----
    suspend fun rateLimit(uid: String): RateLimitDoc? = getDoc("rateLimits", uid)?.let(::parseRateLimit)

    /** Writes challenges/{claimId}; issuedAt is set by the server (rules: == request.time). */
    suspend fun createChallenge(claimId: String, doc: Doc) {
        db.collection("challenges").document(claimId).set(doc.forFirestore()).await()
    }

    /** The server's issuedAt in whole milliseconds, read from the server (not the local cache). */
    suspend fun challengeIssuedAt(claimId: String): Long {
        val d = db.collection("challenges").document(claimId).get(Source.SERVER).await()
        return d.getTimestamp("issuedAt")?.millis() ?: error("challenge has no issuedAt yet")
    }

    suspend fun uploadCrop(claimId: String, jpeg: ByteArray) {
        val meta = storageMetadata { contentType = "image/jpeg" }
        storage.reference.child(cropPath(claimId)).putBytes(jpeg, meta).await()
    }

    /** claims + rateLimits + claimsByOrder in one batch (rules use getAfter on all three). */
    suspend fun commitClaim(claim: Doc, rateLimit: Doc, uid: String) {
        val claimId = claim["claimId"] as String
        val orderId = claim["orderId"] as String
        db.batch().apply {
            set(db.collection("claims").document(claimId), claim.forFirestore())
            set(db.collection("rateLimits").document(uid), rateLimit.forFirestore())
            set(db.collection("claimsByOrder").document(orderId), claimsByOrderDoc(claimId, uid).forFirestore())
        }.commit().await()
    }

    fun myClaims(uid: String): Flow<List<ClaimDoc>> =
        db.collection("claims").whereEqualTo("customerId", uid).snapshots().map { s ->
            s.documents.mapNotNull { d -> parsed("claims/${d.id}") { d.plainData()?.let { parseClaim(d.id, it) } } }
        }

    suspend fun myClaimsOnce(uid: String): List<ClaimDoc> =
        db.collection("claims").whereEqualTo("customerId", uid).get().await().documents.mapNotNull { d ->
            parsed("claims/${d.id}") { d.plainData()?.let { parseClaim(d.id, it) } }
        }

    suspend fun claim(id: String): ClaimDoc? = getDoc("claims", id)?.let { parseClaim(id, it) }

    // ---- decision (Flow D) ----
    /** config/policy is what the rules compare policyVersion and the cap against. */
    suspend fun serverPolicyVersion(): String? = db.collection("config").document("policy").get().await().getString("policyVersion")

    /** Decision + (for holds) the hold, in one batch: the rules check the hold with getAfter. */
    suspend fun commitDecision(claimId: String, decision: Doc, hold: Doc?) {
        db.batch().apply {
            set(db.collection("decisions").document(claimId), decision.forFirestore())
            if (hold != null) set(db.collection("holds").document(claimId), hold.forFirestore())
        }.commit().await()
    }

    fun myDecisions(uid: String): Flow<List<DecisionDoc>> =
        db.collection("decisions").whereEqualTo("customerId", uid).snapshots().map { s ->
            s.documents.mapNotNull { d -> parsed("decisions/${d.id}") { d.plainData()?.let { parseDecision(d.id, it) } } }
        }

    fun myHolds(uid: String): Flow<List<HoldDoc>> =
        db.collection("holds").whereEqualTo("customerId", uid).snapshots().map { s ->
            s.documents.mapNotNull { d -> parsed("holds/${d.id}") { d.plainData()?.let { parseHold(d.id, it) } } }
        }

    /** Window over and nobody answered: the customer's app may settle (rules: !beforeEnd()). */
    suspend fun settleHold(claimId: String) {
        db.collection("holds").document(claimId).update(holdSettleUpdate().forFirestore()).await()
    }

    // ---- "Delete my data" (§23, privacy page) ----
    data class DeleteReport(val claims: Int, val crops: Int, val cropsAlreadyGone: Int)

    /**
     * Deletes what the rules let the customer delete: their claims, the claim crops and users/{uid}.
     * Orders, handoff snaps, challenges, decisions, holds, claimsByOrder and rateLimits are
     * create-only by design (so deleting can't reset the limits or rewrite a restaurant's record).
     */
    suspend fun deleteMyData(uid: String): DeleteReport {
        var crops = 0
        var gone = 0
        val claims = db.collection("claims").whereEqualTo("customerId", uid).get().await().documents
        for (d in claims) {
            val ref = d.getString("cropRef")
            if (ref != null) {
                try {
                    storage.reference.child(ref).delete().await()
                    crops++
                } catch (e: StorageException) {
                    // Crops are also removed by the 3-day lifecycle rule.
                    if (e.errorCode == StorageException.ERROR_OBJECT_NOT_FOUND) gone++ else throw e
                }
            }
            d.reference.delete().await()
        }
        db.collection("users").document(uid).delete().await()
        return DeleteReport(claims.size, crops, gone)
    }

    // ---- helpers ----
    private suspend fun getDoc(collection: String, id: String): Map<String, Any?>? {
        val d: DocumentSnapshot = db.collection(collection).document(id).get().await()
        return d.plainData()
    }

    private inline fun <T> parsed(path: String, block: () -> T?): T? = try {
        block()
    } catch (e: IllegalArgumentException) {
        // A malformed document is skipped (and logged) instead of breaking the whole list.
        Log.w("FairClaim", "skipping $path: ${e.message}")
        null
    }

    companion object {
        fun isPermissionDenied(e: Throwable): Boolean =
            e is FirebaseFirestoreException && e.code == FirebaseFirestoreException.Code.PERMISSION_DENIED
    }
}
