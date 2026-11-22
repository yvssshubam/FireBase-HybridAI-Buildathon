import { describe, expect, it } from "vitest";
import { formatRemaining, holdEndsAt, isExpired, remainingMs, shouldSettle } from "../src/data/hold.ts";

const H = 3_600_000;
const T0 = 1_700_000_000_000;

describe("hold window (createdAt + holdHours)", () => {
  it("ends holdHours after creation", () => {
    expect(holdEndsAt(T0, 48)).toBe(T0 + 48 * H);
  });

  it("counts down and stops at zero", () => {
    expect(remainingMs(T0, 48, T0)).toBe(48 * H);
    expect(remainingMs(T0, 48, T0 + 47 * H)).toBe(H);
    expect(remainingMs(T0, 48, T0 + 49 * H)).toBe(0);
  });

  it("is expired exactly at the end (rules: !(request.time < end))", () => {
    expect(isExpired(T0, 48, T0 + 48 * H - 1)).toBe(false);
    expect(isExpired(T0, 48, T0 + 48 * H)).toBe(true);
  });

  it("formats the countdown", () => {
    expect(formatRemaining(48 * H)).toBe("48 h 00 min");
    expect(formatRemaining(47 * H + 59 * 60_000 + 59_999)).toBe("47 h 59 min");
    expect(formatRemaining(59 * 60_000 + 5_000)).toBe("59 min 05 s");
    expect(formatRemaining(999)).toBe("0 min 00 s");
    expect(formatRemaining(0)).toBe("Expired");
    expect(formatRemaining(-5)).toBe("Expired");
  });

  it("settles only unanswered holds whose window has passed", () => {
    const hold = { state: "held", createdAt: T0, holdHours: 48 };
    expect(shouldSettle(hold, T0 + 48 * H)).toBe(true);
    expect(shouldSettle(hold, T0 + 48 * H - 1)).toBe(false);
    for (const state of ["accepted", "resolved", "escalated", "settled"]) {
      expect(shouldSettle({ ...hold, state }, T0 + 100 * H)).toBe(false);
    }
    // Pending server timestamp: not settleable yet.
    expect(shouldSettle({ ...hold, createdAt: null }, T0 + 100 * H)).toBe(false);
  });
});
