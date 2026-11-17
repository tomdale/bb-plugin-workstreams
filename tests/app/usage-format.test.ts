import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatCount,
  formatMoney,
  formatTokens,
} from "../../src/app/usage/format.ts";

describe("usage formats", () => {
  it("keeps a sub-cent sum visible", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(0.0042)).toBe("$0.0042");
    expect(formatMoney(0.01)).toBe("$0.01");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
  });

  it("shows a dash, not zero, for a cost nobody reported", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(0)).toBe("$0.00");
  });

  it("groups counts and abbreviates tokens", () => {
    expect(formatCount(12345)).toBe("12,345");
    expect(formatTokens(9_999)).toBe("9,999");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });
});
