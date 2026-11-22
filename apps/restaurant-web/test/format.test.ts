import { describe, expect, it } from "vitest";
import { mismatchText } from "../src/ui/format.ts";

describe("mismatchText", () => {
  it("reads as a sentence after 'changes'", () => {
    expect(mismatchText(["verdict"])).toBe("the verdict");
    expect(mismatchText(["liability.restaurant", "liability.transit"])).toBe("the restaurant's share and the delivery share");
    expect(mismatchText(["verdict", "refundAmount", "reasons"])).toBe("the verdict, the refund amount and the reasons");
    expect(mismatchText([])).toBe("the decision");
  });
});
