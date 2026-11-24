@file:Suppress("EnumEntryName", "PropertyName", "ClassName")

package com.fairclaim.customer.ai

import com.google.firebase.ai.annotations.Generable
import com.google.firebase.ai.annotations.Guide
import kotlinx.serialization.Serializable

// Structured-output schemas for Firebase AI Logic. On-device (and hybrid) structured output only
// accepts @Generable data classes (KSP generates `X.firebaseAISchema()`); enums must sit inside a
// data class. They mirror packages/schemas/schemas/*.schema.json.
//
// Names are deliberately the wire names (snake_case properties, lowercase enum entries) so the
// generated schema, the model's JSON and the stored documents all use the same strings without
// relying on @SerialName support in the schema generator. Whatever comes back is still validated
// by parseModelOutput (the typed object is never trusted on its own).

@Serializable
enum class SealStateOut { intact, broken, not_visible }

@Serializable
enum class ConfidenceOut { high, medium, low }

@Serializable
enum class IssueOut { spilled, crushed, missing, wrong_item, foreign_object, none }

@Serializable
enum class SeverityOut { none, minor, partial, total }

@Serializable
enum class ReviewFlagOut { claimed_item_not_in_order, issue_type_inconsistent, dispatch_contradiction, handoff_contradiction, timeline_inconsistent, other }

@Serializable
@Generable(description = "What the sealed-bag photo shows at handoff")
data class HandoffOut(
    @Guide(description = "intact, broken or not_visible") val seal_state: SealStateOut,
    @Guide(description = "Exactly the 4 digits on the seal sticker, or an empty string if not readable") val seal_code_read: String,
    @Guide(description = "How sure you are about the seal and the code") val confidence: ConfidenceOut,
) {
    companion object
}

@Serializable
@Generable(description = "What the claim photo shows")
data class ChallengeOut(
    @Guide(description = "Exactly the 4 digits on the seal sticker, or an empty string if not readable") val seal_code_read: String,
    @Guide(description = "Number of raised fingers visible, 0 if no hand") val fingers_visible: Int,
    @Guide(description = "intact, broken or not_visible") val seal_state: SealStateOut,
    @Guide(description = "true if this looks like a photo of a screen or of a printed photo") val photo_of_screen_suspected: Boolean,
    @Guide(description = "How sure you are about the code and the finger count") val confidence: ConfidenceOut,
) {
    companion object
}

@Serializable
@Generable(description = "What the tapped crop shows")
data class DamageOut(
    @Guide(description = "Short name of the food or item, 2 to 4 words, or an empty string") val matched_item: String,
    @Guide(description = "The visible problem") val issue: IssueOut,
    @Guide(description = "How much of the item is affected") val severity: SeverityOut,
    @Guide(description = "How sure you are") val confidence: ConfidenceOut,
) {
    companion object
}

@Serializable
@Generable(description = "Consistency review and explanations of a refund decision")
data class ReviewOut(
    @Guide(description = "false only if the data contains a real contradiction") val consistent: Boolean,
    @Guide(description = "Contradictions found, empty if none", maxItems = 6) val flags: List<ReviewFlagOut>,
    @Guide(description = "For the customer, English, at most 3 sentences, no amounts") val explanation_customer_en: String,
    @Guide(description = "The same in Hindi (Devanagari)") val explanation_customer_hi: String,
    @Guide(description = "The same in Tamil (Tamil script)") val explanation_customer_ta: String,
    @Guide(description = "For the restaurant, neutral, at most 3 sentences, no amounts") val explanation_restaurant: String,
) {
    companion object
}
