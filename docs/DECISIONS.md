# Decisions beyond the plan (Nov 22, 2026)

Agreed while starting Phase 0; they fill gaps in or resolve contradictions in `PLAN.md`. Engine-level rules are pinned by `packages/schemas/test-vectors` (see its README for the exact maths).

## Agreed with the owner
1. **Pairing (gap: anonymous auth had no way to link a judge's phone to a restaurant).** Each restaurant web session creates its own sandbox restaurant (`restaurants/{uid}`) with the seeded menu and a 6-character pair code (`pairCodes/{code}`). The customer enters the code once and places a demo order from that menu; it then appears on the restaurant screen (Flow A step 1). Rules check names and prices against the menu.
2. **Immutable decisions vs. recompute (contradiction: §22.2 create-once vs §8.4 recompute and "moves to review").** Decisions stay immutable. The restaurant writes create-once side records: `counterEvidence/{claimId}` + `resolutions/{claimId}` (Flow E) and `audits/{claimId}` (replay mismatch → "Needs review"). Clear counter-evidence settles the hold automatically; if it is not clear enough, the claim goes to human review.
3. **Matrix gaps:** unlisted combinations → hold; unusable handoff = no handoff; clean dispatch + broken handoff → transit for damage/wrong item; bad dispatch photo rejected at capture; over cap or ≥3 claims/30 d → review.
4. **Hold split is confidence-weighted** (§8.4's 30/70 example), not a flat 50/50.

## Implementation choices (stated assumptions)
- Money is whole rupees with half-up rounding; restaurant share is rounded and transit takes the remainder so shares always add up.
- `Decision.holdUntil` (§7) is replaced by `holds/{id}.createdAt` (server time) + `holdHours`: a client can't write "server time + 48 h", and rules compare against `request.time`.
- Decision `reasons` are stable codes (`packages/schemas/reason-codes.json` has the English text); the UI translates them.
- Review output is flat: `consistent`, `flags`, `explanation_customer_{en,hi,ta}`, `explanation_restaurant`. The prompt tells the model not to state amounts; the UI shows them.
- Model output is normalized before validation (code → digits only, enums lowercased, strings trimmed/truncated, unknown keys dropped) so harmless verbosity doesn't fail a claim; type errors still do.
- The customer picks the affected item(s) from the order list for every claim type; the crop's `matched_item` is a cross-check (T5 fallback built in).
- `customerClaims30d` is stored on the claim so the restaurant's replay audit is deterministic. It is client-counted and resets with a new anonymous account (honest limit).
- Policy has one source file (`packages/schemas/policy/policy.v1.json`) → Remote Config template (generated) and Firestore `config/policy` (seed script) for rules.
- `moireThreshold` 0.35 is a placeholder until test T6 on real photos.
- Android application/package id: `com.fairclaim.customer` (register this in Firebase).
- `claims.challenge.issuedAt` is the challenge doc's server `issuedAt` in **whole** milliseconds (`Math.floor(ts.toMillis())` on web, `ts.toDate().time` on Android); `capturedAt` = that + monotonic elapsed time at the shutter (`SystemClock.elapsedRealtime()`), so a wrong phone clock can't fail an honest claim.

## Phase 1 (restaurant web, Nov 22)
- Open questions 1–3 stay at the Phase 0 behaviour (120 s window, `restaurantPermilleAfterClear` 0, instant restaurant liability for "item absent at dispatch") until the owner answers; none of the web code depends on them.
- `inferenceSource` from the JS SDK is `"on_device"` / `"in_cloud"`; the apps store `ON_DEVICE` / `IN_CLOUD` (schemas, rules).
- Once the SDK has chosen the on-device model it doesn't fall back on errors, so the single retry of a model call uses a separate `ONLY_IN_CLOUD` model.
- The prompt never contains the expected seal code. Since the seal-only change below it contains no restaurant-typed text at all (item names were removed), so there is nothing to inject.
- Emulator mode uses a second Firebase app (`demo-fairclaim`) for Auth/Firestore/Storage; AI Logic, App Check and Remote Config stay on the real project.
- Replay audit: skipped (not written) when the page's policy version differs from the decision's, when the claim was deleted by its customer, or when the crop download fails for a network/CORS reason. A crop missing within the 3-day retention window counts as a mismatch; after it, `cropHashMatch` is `null`.
- Uploads carry `customMetadata.sha256` so a retry after a failed batch can reuse the create-once object instead of getting stuck.
- Server timestamps are read as `seconds * 1000 + floor(nanos / 1e6)` (exact), not `Math.floor(toMillis())`.
- `@grpc/grpc-js` is overridden to 1.14.7 under `@firebase/firestore` (the pinned 1.9.x has a high-severity advisory; only the Node build uses gRPC).

- Pairing UI (owner, Nov 22): the pair code is no longer shown on the main screen. "Connect a phone" (sidebar) opens a QR code encoding `fairclaim://pair?code=<CODE>` (`apps/restaurant-web/src/data/pairing.ts`); the typed code stays in that dialog as a fallback and for `dev/customer-sim.ts`. Phase 2: the Android app scans this QR (live camera) and also offers manual code entry. Data model and rules are unchanged (`pairCodes/{code}`).
- Demo data (owner, Nov 22): `VITE_DEMO_DATA=true` in dev fills the pages with 16 hand-made plus ~45 generated (13 days of history) engine-computed sample claims and ~1,200 background orders, held in memory; never written to Firebase, never in a production build (`check:dist` fails on its markers).

## Seal-only dispatch (owner, Nov 22)
- **Why:** a sealed bag hides the food. On the owner's laptop Gemini Nano reported items it was told to expect (an empty cloth: "Chicken Biryani seen"; a closed lunch box: same). Item visibility at dispatch was therefore a guess that moved money: a false "seen" blamed delivery, a false "not seen" blamed the restaurant.
- **Change:** `DispatchCheck` is `{seal_intact, seal_code_read, spill_or_damage_visible, confidence}`. The dispatch prompt asks only for the seal, the code and outside damage, and holds no item names. Firestore rules reject the old item fields.
- **Matrix (missing / wrong item):** sealed with the right code at dispatch + intact at handoff → restaurant (`restaurant_not_packed`); + broken at handoff → transit (`transit_tamper`); + no usable handoff → neutral hold; no usable dispatch → hold leaning by the handoff seal (unchanged). Damage claims are unchanged.
- **Counter-evidence:** checked for seal + code (+ no damage for damage claims). When the dispatch photo already proved that, a counter photo can't add anything and goes to human review (`counter_evidence_repeats_dispatch`); the UI explains this instead of offering the photo step.
- **Removed:** `hold_investigate_contradiction`, `hold_item_status_unclear`, `hold_absent_and_tampered`, `counter_evidence_conflicts_dispatch`, `counter_evidence_cannot_resolve_contradiction`. Vectors were rewritten by hand; §8.2 rows renumbered (missing.1–4, wrong.1–4).
- **Demo upload:** dispatch and counter-evidence accept an uploaded photo, labelled "For the demo", through the same Gemini check. On unless `VITE_ALLOW_PHOTO_UPLOAD=false`; turn it off for a real launch (an uploaded photo can be an old one). `capturedAt` is the file's last-modified time.

## Phase 2 (customer Android app, Nov 23)
- **Versions:** AGP 9.2.1 (the newest line whose minimum Gradle, 9.4.1, matches the wrapper; AGP 9.3+ needs Gradle 9.5–9.7), built-in Kotlin with KGP 2.4.20, KSP 2.3.13, Compose BOM 2026.08.00 (the Nov '26 BOM needs compileSdk 37.1, which AGP 9.2 doesn't support), CameraX 1.6.2, Firebase BoM 35.2.0 + `firebase-ai` 18.2.0, `firebase-ai-ondevice` 16.0.0-beta08, `firebase-ai-ksp-processor` 17.0.0.
- **On-device status/download/warm-up** use `GenerativeModel.onDeviceExtension` (`checkStatus`, `download`, `warmUp`, `getModelName`); `FirebaseAIOnDevice.checkStatus()/download()` are deprecated in favour of it. The download starts after the Terms are accepted (not automatic).
- **Structured output:** all four calls use `generateObject` with `@Generable` classes (required on-device). Their property and enum names are the wire names (snake_case, lowercase entries), so no `@SerialName` support is needed from the schema generator. The raw text is always re-validated with `parseModelOutput`; the typed object is only a fallback when the SDK returns no text.
- **Retry ladder:** hybrid call → AICore `BUSY` gets exponential backoff (0.8 s, 1.6 s) on device; battery quota or any other error → one `ONLY_IN_CLOUD` retry → clear failure (retake). Review: two cloud attempts, then stored as `unavailable` (engine downgrades to review; the explanation is then written by the rules, Hindi/Tamil left empty).
- **Seal-only prompts:** the three photo prompts are constant strings (no item names, codes or finger counts; unit-tested). The Review prompt is JSON-only and contains the order's item names (needed to flag "claimed item not in order"; sanitised to one line, ≤ 60 chars) but never the seal code (only `seal_code_matches_order`) and no prices or amounts.
- **Timing:** `capturedAt = issuedAt(server) + (elapsedRealtime at shutter − elapsedRealtime read just before the challenge write)`. Including the write latency makes the estimate run slightly late, never early. The same estimate gates the claim write (30 s interval, 120 s window, UTC day for `countToday`), so the phone's wall clock is only used for an early "please wait" hint.
- **Handoff snap is rejected at capture** unless it is usable for the engine (seal visible, right code); a broken seal with the right code is stored (it is evidence for transit).
- **Claim warnings:** when the checks show the claim will likely go to review (code unread or wrong, finger count off, screen suspected, moiré over the threshold, low confidence, no damage on the crop) the customer may retake within the 60 s window or submit anyway.
- **Decision on the phone** is computed from the documents read back from Firestore (same input as the restaurant's replay audit). If the app stops between the claim and the decision, the order screen offers "Finish the decision". Before writing, the app checks that its policy version equals Firestore `config/policy` (the rules require it).
- **QR decoding:** ZXing core 3.5.4 on CameraX luminance frames: pure Java, no Play services, no model download; it is not a model call.
- **Delete my data** deletes the customer's claims, their crops and `users/{uid}`; everything the rules make create-only stays (orders, handoff, challenges, decisions, holds, `claimsByOrder`, `rateLimits`), and the screen says so.
- **Manifest:** the app declares only CAMERA and INTERNET; libraries add normal install-time permissions (e.g. ACCESS_NETWORK_STATE) to the merged manifest. Backups and device transfer are off, cleartext is off.
