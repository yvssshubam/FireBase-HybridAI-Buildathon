// Integer-only money so the TS and Kotlin engines agree to the rupee.
import type { EngineInput } from "@fairclaim/schemas";

/** ⌊(amount × permille + 500) / 1000⌋ — half-up rounding to whole rupees. */
export function permilleOf(amount: number, permille: number): number {
  return Math.floor((amount * permille + 500) / 1000);
}

/** §8.3 proportionate refund before the order-total cap. Assumes valid item selection. */
export function rawAssessment(input: EngineInput): number {
  const { claim, order, policy } = input;
  const f = policy.severityPermille;
  const priceOf = (id: string) => order.items.find((i) => i.id === id)?.price ?? 0;
  switch (claim.issueType) {
    case "damaged": {
      const sev = claim.damageCheck?.severity;
      if (sev !== "minor" && sev !== "partial" && sev !== "total") return 0;
      return permilleOf(priceOf(claim.selectedItemIds[0] ?? ""), f[sev]);
    }
    case "missing":
      return claim.selectedItemIds.reduce((sum, id) => sum + permilleOf(priceOf(id), f.missing), 0);
    case "wrong_item":
      return permilleOf(priceOf(claim.selectedItemIds[0] ?? ""), f.wrong_item);
  }
}
