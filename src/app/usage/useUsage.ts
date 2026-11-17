/**
 * The Usage page's data: the report for the chosen range, kept current, and
 * the light status behind the Page menu's mark.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, type useRpc } from "@get-bb/plugin-sdk/app";
import {
  USAGE_RANGES,
  type UsageIndicator,
  type UsageRange,
  type UsageReport,
} from "../../domain/usage.ts";
import type { RpcContract } from "../../server/contract.ts";
import { shareJson } from "../structuralSharing.ts";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

const REPORT_REFRESH_MS = 30_000;
const INDICATOR_REFRESH_MS = 60_000;
const DEFAULT_RANGE: UsageRange = "24h";
const RANGE_KEY = "workstreams:usage-range";

/** The range chosen earlier in this session, so reopening the page keeps it. */
function storedRange(): UsageRange {
  try {
    const stored = sessionStorage.getItem(RANGE_KEY);
    return USAGE_RANGES.find((range) => range === stored) ?? DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

function storeRange(range: UsageRange): void {
  try {
    sessionStorage.setItem(RANGE_KEY, range);
  } catch {
    // Storage is unavailable; the choice lasts while the page is open.
  }
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * The report for the chosen range. A refresh (every 30 seconds, on the
 * server's `usage` signal, and after a resume) replaces the report in place
 * and shares its unchanged branches, so the page neither flickers nor loses
 * its scroll. A range change keeps showing the previous range's report,
 * marked `stale`, until the new one arrives. Only the latest request's answer
 * or error is kept.
 */
export function useUsageReport(rpc: Rpc) {
  const [range, setRangeState] = useState<UsageRange>(storedRange);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const generation = ++request.current;
    try {
      const next = await rpc.call("usage", { range });
      if (generation !== request.current) return;
      setReport((previous) => shareJson(previous, next));
      setError(null);
    } catch (cause) {
      if (generation === request.current) setError(messageOf(cause));
    }
  }, [rpc, range]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REPORT_REFRESH_MS);
    return () => {
      clearInterval(timer);
      request.current++;
    };
  }, [load]);
  useRealtime("usage", () => void load());

  const setRange = useCallback((next: UsageRange) => {
    storeRange(next);
    setRangeState(next);
    setError(null);
  }, []);

  const resume = useCallback(async () => {
    setResuming(true);
    try {
      await rpc.call("usageResume", null);
      await load();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setResuming(false);
    }
  }, [rpc, load]);

  const current = report?.range === range;
  return {
    range,
    setRange,
    /** The report to show; a failed load of another range shows none. */
    report: current || !error ? report : null,
    /** The shown report belongs to the previous range. */
    stale: report !== null && !current,
    error,
    retry: load,
    resume,
    resuming,
  };
}

/**
 * The limits' level and the flag count, read while the caller is mounted:
 * once, every minute, and on the server's `usage` signal. Null until the
 * first read answers; a failed read keeps the last answer.
 */
export function useUsageIndicator(rpc: Rpc): UsageIndicator | null {
  const [indicator, setIndicator] = useState<UsageIndicator | null>(null);
  const mounted = useRef(true);
  const read = useCallback(() => {
    rpc.call("usageStatus", null).then(
      (next) => {
        if (mounted.current)
          setIndicator((previous) => shareJson(previous, next));
      },
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    mounted.current = true;
    read();
    const timer = setInterval(read, INDICATOR_REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [read]);
  useRealtime("usage", read);
  return indicator;
}
