import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimArchiveNavigation,
  claimedArchiveNavigation,
} from "../../src/app/archive/claims.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("archive navigation claims", () => {
  it("answers for the archive it was taken for, once", () => {
    claimArchiveNavigation("thread");
    expect(claimedArchiveNavigation("thread")).toBe(true);
    expect(claimedArchiveNavigation("thread")).toBe(false);
    expect(claimedArchiveNavigation("other")).toBe(false);
  });

  it("is dropped when the archive never lands", () => {
    const release = claimArchiveNavigation("thread");
    release();
    expect(claimedArchiveNavigation("thread")).toBe(false);
  });

  it("forgets a claim long before an archive could still be landing", () => {
    claimArchiveNavigation("thread");
    vi.setSystemTime(Date.now() + 61_000);
    expect(claimedArchiveNavigation("thread")).toBe(false);
  });
});
