import { describe, expect, it } from "vitest";
import { parseLocation } from "../src/ui/router.tsx";

describe("parseLocation", () => {
  it("reads the page, the claim drawer and the order to open", () => {
    expect(parseLocation("/")).toEqual({ page: "overview", claim: null, order: null });
    expect(parseLocation("/action?claim=c-1")).toEqual({ page: "action", claim: "c-1", order: null });
    expect(parseLocation("/orders?order=o-825d6d2fc3c8")).toEqual({ page: "orders", claim: null, order: "o-825d6d2fc3c8" });
  });
  it("ignores an order id off the Orders page and rejects odd ids", () => {
    expect(parseLocation("/claims?order=o-1").order).toBeNull();
    expect(parseLocation("/orders?order=../x").order).toBeNull();
    expect(parseLocation("/orders/?order=" + "a".repeat(65)).order).toBeNull();
  });
});
