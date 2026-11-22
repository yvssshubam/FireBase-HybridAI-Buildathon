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
