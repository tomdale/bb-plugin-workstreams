/**
 * Settings → Usage: the warning and pause thresholds for what Workstreams'
 * model calls spend, the switch for usage flags, and, while a threshold is
 * reached, what is paused with Resume.
 *
 * A threshold field holds text until it is committed (blur or Enter), so a
 * half-typed number never reaches the preferences. A row's two fields are
 * judged together: a pause threshold below its warning saves neither.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Prefs } from "../../domain/prefs.ts";
import {
  LIMIT_KEYS,
  LIMIT_METRIC,
  type LimitKey,
  type SpendState,
} from "../../domain/usage.ts";
import type { RpcContract } from "../../server/contract.ts";
import { usePrefs } from "../prefs.ts";
import { formatCount } from "../usage/format.ts";
import { pausedText, warningText } from "../usage/text.ts";
import { SectionRows, SettingRow, SettingSwitch } from "./ui.tsx";

type Usage = Prefs["usage"];
type Metric = (typeof LIMIT_METRIC)[LimitKey];
type Side = "warn" | "cap";

/** The largest threshold the preferences accept. */
const MAX_THRESHOLD = 1_000_000;

const ROW_LABEL: Record<LimitKey, string> = {
  hourSpend: "Last hour",
  daySpend: "Today",
  monthSpend: "This month",
  hourCalls: "Requests per hour",
};
const SIDE_LABEL: Record<Side, string> = {
  warn: "Warn at",
  cap: "Pause at",
};
const FIELD: Record<LimitKey, Record<Side, keyof Usage>> = {
  hourSpend: { warn: "hourSpendWarn", cap: "hourSpendCap" },
  daySpend: { warn: "daySpendWarn", cap: "daySpendCap" },
  monthSpend: { warn: "monthSpendWarn", cap: "monthSpendCap" },
  hourCalls: { warn: "hourCallsWarn", cap: "hourCallsCap" },
};

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const textOf = (value: number | null) => (value === null ? "" : String(value));

/**
 * What a field's text means: a threshold, `null` for a blank field (off), or
 * why it is neither. A leading `$` and thousands separators are read past.
 */
export function parseThreshold(
  text: string,
  metric: Metric,
): { value: number | null } | { error: string } {
  const entered = text.replace(/[$,\s]/g, "");
  if (!entered) return { value: null };
  const value = Number(entered);
  if (!Number.isFinite(value) || value <= 0)
    return {
      error:
        metric === "calls"
          ? "Enter a whole number above 0."
          : "Enter a number above 0.",
    };
  if (metric === "calls" && !Number.isInteger(value))
    return { error: "Enter a whole number above 0." };
  if (value > MAX_THRESHOLD)
    return { error: `Enter ${formatCount(MAX_THRESHOLD)} or less.` };
  return { value };
}

/** The limits' current state, read on open and whenever the server says it changed. */
function useSpendState() {
  const rpc = useRpc<RpcContract>();
  const [state, setState] = useState<SpendState | null>(null);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    try {
      const report = await rpc.call("usage", { range: "1h" });
      if (mine === request.current) setState(report.state);
    } catch {
      // The thresholds still edit without the status line.
    }
  }, [rpc]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  useRealtime("usage", () => void load());
  const resume = async () => {
    setResuming(true);
    setError(null);
    const mine = ++request.current;
    try {
      const resumed = await rpc.call("usageResume", null);
      if (mine === request.current) setState(resumed.state);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setResuming(false);
    }
  };
  return { state, load, resume, resuming, error };
}

/** What is paused and why, with Resume; or the one line a reached warning gets. */
function Status({
  state,
  onResume,
  resuming,
}: {
  state: SpendState | null;
  onResume: () => void;
  resuming: boolean;
}) {
  if (!state) return null;
  const paused = pausedText(state);
  if (paused)
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm"
      >
        <div className="min-w-0">
          <p className="font-medium text-foreground">Model calls are paused</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {paused.reasons.join(" ")} {paused.ends}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={resuming}
          onClick={onResume}
        >
          Resume
        </Button>
      </div>
    );
  const warning = warningText(state);
  return warning ? (
    <p role="status" className="text-xs text-(--warning-text)">
      {warning}
    </p>
  ) : null;
}

function ThresholdField({
  label,
  metric,
  text,
  errorId,
  onText,
  onCommit,
  onRevert,
}: {
  label: string;
  metric: Metric;
  text: string;
  /** The row's error line, when it is about this field. */
  errorId: string | undefined;
  onText: (text: string) => void;
  onCommit: () => void;
  onRevert: () => void;
}) {
  return (
    <div className="relative w-24">
      {metric === "spend" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground"
        >
          $
        </span>
      ) : null}
      <Input
        type="text"
        inputMode={metric === "spend" ? "decimal" : "numeric"}
        aria-label={label}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        placeholder="Off"
        spellCheck={false}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit();
          else if (event.key === "Escape") onRevert();
        }}
        className={cn(
          "h-7 px-2 text-right text-xs tabular-nums",
          metric === "spend" && "pl-5",
          errorId && "border-destructive",
        )}
      />
    </div>
  );
}

function LimitRow({
  limit,
  usage,
  onSave,
}: {
  limit: LimitKey;
  usage: Usage;
  onSave: (patch: Partial<Usage>) => void;
}) {
  const metric = LIMIT_METRIC[limit];
  const stored = {
    warn: usage[FIELD[limit].warn] as number | null,
    cap: usage[FIELD[limit].cap] as number | null,
  };
  const [text, setText] = useState({
    warn: textOf(stored.warn),
    cap: textOf(stored.cap),
  });
  const [errors, setErrors] = useState<Partial<Record<Side, string>>>({});
  const errorId = useId();
  // A stored change, from a save here or in another window, replaces what
  // that field holds; the field beside it keeps what is being typed.
  useEffect(() => {
    setText((was) => ({ ...was, warn: textOf(stored.warn) }));
    setErrors((was) => ({ ...was, warn: undefined }));
  }, [stored.warn]);
  useEffect(() => {
    setText((was) => ({ ...was, cap: textOf(stored.cap) }));
    setErrors((was) => ({ ...was, cap: undefined }));
  }, [stored.cap]);

  const commit = (side: Side) => {
    const other: Side = side === "warn" ? "cap" : "warn";
    const edited = parseThreshold(text[side], metric);
    if ("error" in edited) {
      setErrors((was) => ({ ...was, [side]: edited.error }));
      return;
    }
    // The other field counts as typed when it reads as a threshold, so both
    // can be raised one after the other; otherwise its stored value stands.
    const beside = parseThreshold(text[other], metric);
    const value = {
      [side]: edited.value,
      [other]: "error" in beside ? stored[other] : beside.value,
    } as Record<Side, number | null>;
    if (value.warn !== null && value.cap !== null && value.cap < value.warn) {
      setErrors((was) => ({
        ...was,
        [side]:
          side === "cap"
            ? "Pause at can't be below Warn at."
            : "Warn at can't be above Pause at.",
      }));
      return;
    }
    setErrors("error" in beside ? { [other]: beside.error } : {});
    const patch: Partial<Usage> = {};
    for (const each of ["warn", "cap"] as const)
      if (value[each] !== stored[each])
        Object.assign(patch, { [FIELD[limit][each]]: value[each] });
    if (Object.keys(patch).length) onSave(patch);
    else
      setText((was) => ({
        ...was,
        [side]: textOf(value[side]),
        ...("error" in beside ? {} : { [other]: textOf(value[other]) }),
      }));
  };

  // One line per row: the warning field's error first.
  const shown: Side | null = errors.warn ? "warn" : errors.cap ? "cap" : null;
  const field = (side: Side) => (
    <ThresholdField
      label={`${ROW_LABEL[limit]}: ${SIDE_LABEL[side].toLowerCase()}`}
      metric={metric}
      text={text[side]}
      errorId={shown === side ? errorId : undefined}
      onText={(next) => setText((was) => ({ ...was, [side]: next }))}
      onCommit={() => commit(side)}
      onRevert={() => {
        setText((was) => ({ ...was, [side]: textOf(stored[side]) }));
        setErrors((was) => ({ ...was, [side]: undefined }));
      }}
    />
  );
  return (
    <div role="group" aria-label={ROW_LABEL[limit]}>
      <div className={ROW_GRID}>
        <p className="min-w-0 truncate text-sm text-foreground">
          {ROW_LABEL[limit]}
        </p>
        {field("warn")}
        {field("cap")}
      </div>
      {shown ? (
        <p
          id={errorId}
          role="alert"
          className="pb-1 text-right text-xs text-destructive"
        >
          {errors[shown]}
        </p>
      ) : null}
    </div>
  );
}

const ROW_GRID =
  "grid min-h-8 grid-cols-[minmax(0,1fr)_6rem_6rem] items-center gap-3";

export function UsageSettings() {
  const { prefs, save } = usePrefs();
  const navigate = useBbNavigate();
  const status = useSpendState();
  const [error, setError] = useState<string | null>(null);
  if (!prefs)
    return <p className="text-xs text-muted-foreground">Loading settings…</p>;
  const update = (usage: Partial<Usage>) => {
    setError(null);
    // The status depends on the thresholds, so it is read again once they
    // are stored.
    void save({ usage }).then(status.load, (cause: unknown) =>
      setError(messageOf(cause)),
    );
  };
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          When a pause threshold is reached, Workstreams stops calling models
          until it ends or you resume.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => navigate.toPluginPanel("home", { subPath: "usage" })}
        >
          Open Usage
        </Button>
      </div>
      <Status
        state={status.state}
        onResume={() => void status.resume()}
        resuming={status.resuming}
      />
      {(error ?? status.error) ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? status.error}
        </p>
      ) : null}
      {/* slop-ok: 2 every Workstreams settings section draws this card, and BB
          frames its own settings the same way */}
      <SectionRows compact>
        <div className={cn(ROW_GRID, "text-xs text-muted-foreground")}>
          <span />
          <span className="text-right">{SIDE_LABEL.warn}</span>
          <span className="text-right">{SIDE_LABEL.cap}</span>
        </div>
        {LIMIT_KEYS.map((limit) => (
          <LimitRow
            key={limit}
            limit={limit}
            usage={prefs.usage}
            onSave={update}
          />
        ))}
      </SectionRows>
      <SectionRows compact>
        <SettingRow
          label="Flag unusual usage"
          control={
            <SettingSwitch
              size="sm"
              label="Flag unusual usage"
              checked={prefs.usage.detectors}
              onChange={(detectors) => update({ detectors })}
            />
          }
        />
      </SectionRows>
    </div>
  );
}
