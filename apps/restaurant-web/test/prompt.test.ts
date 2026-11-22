import { describe, expect, it } from "vitest";
import { buildDispatchPrompt } from "../src/ai/prompt.ts";
import { SEED_MENU } from "../src/data/menu.ts";

describe("buildDispatchPrompt (seal-only)", () => {
  it("contains no restaurant-typed text, so item names can't inject instructions", () => {
    for (const purpose of ["dispatch", "counter"] as const) {
      const p = buildDispatchPrompt(purpose);
      for (const item of Object.values(SEED_MENU)) expect(p).not.toContain(item.name);
    }
  });

  it("never contains a seal code (the model must read it, not echo it)", () => {
    expect(buildDispatchPrompt("dispatch")).not.toMatch(/\b[0-9]{4}\b/);
    expect(buildDispatchPrompt("counter")).not.toMatch(/\b[0-9]{4}\b/);
  });

  it("asks for exactly the DispatchCheck fields and JSON only", () => {
    const p = buildDispatchPrompt("dispatch");
    for (const f of ["seal_intact", "seal_code_read", "spill_or_damage_visible", "confidence"]) expect(p).toContain(f);
    expect(p).not.toContain("visible_item");
    expect(p.trim().endsWith("Respond with JSON only.")).toBe(true);
  });

  it("tells the model an unreadable code is a valid answer", () => {
    expect(buildDispatchPrompt("dispatch")).toContain('cannot read all 4 digits, ""');
  });

  it("uses a different framing for counter-evidence", () => {
    expect(buildDispatchPrompt("dispatch")).toContain("just before it leaves");
    expect(buildDispatchPrompt("counter")).toContain("disputed");
  });
});
