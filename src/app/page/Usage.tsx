/**
 * The Usage page: what Workstreams' model calls cost over a range, read in
 * the order the reader needs it. A pause or a reached warning comes first,
 * then reported cost over time and the range's totals, the current windows
 * against their limits, the detectors' flags, and the breakdowns.
 *
 * Worker-thread and agent-thread calls report no cost, so every amount is
 * labeled "reported" and the requests it leaves out are counted beside it.
 */
import type { ReactNode } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import {
  USAGE_RANGES,
  type SpendState,
  type UsageGroup,
  type UsageRange,
  type UsageReport,
} from "../../domain/usage.ts";
import type { RpcContract } from "../../server/contract.ts";
import { SelectField } from "../SelectField.tsx";
import { WorkstreamName } from "../WorkstreamName.tsx";
import { Breakdown } from "../usage/Breakdown.tsx";
import { Flags } from "../usage/Flags.tsx";
import { Limits } from "../usage/Limits.tsx";
import { SpendChart } from "../usage/SpendChart.tsx";
import { UsageThreadLink } from "../usage/ThreadLink.tsx";
import {
  RANGE_LABEL,
  pausedText,
  retainedText,
  totalsText,
  warningText,
} from "../usage/text.ts";
import { useUsageReport } from "../usage/useUsage.ts";
import { ghostButton, secondaryButton } from "./controls.ts";

const RANGE_OPTIONS = USAGE_RANGES.map((value) => ({
  value,
  label: RANGE_LABEL[value],
}));

/** "the last 24 hours", for a sentence about a range. */
const inRange = (range: UsageRange) =>
  `the ${RANGE_LABEL[range].toLowerCase()}`;

const workstreamName = (group: UsageGroup) =>
  // The server's `none` group holds calls for threads in no workstream.
  group.key === "none" ? (
    group.label
  ) : (
    <WorkstreamName
      name={group.label}
      className="whitespace-normal font-normal leading-[inherit]"
    />
  );

const threadName = (group: UsageGroup) => (
  <UsageThreadLink
    threadId={group.key}
    fallback={group.label === group.key ? undefined : group.label}
  />
);

function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-[13px] font-semibold">{heading}</h2>
      {children}
    </section>
  );
}

/**
 * The limits' state above everything else: a pause with its reasons, when it
 * ends, and Resume; or the one line a reached warning gets.
 */
function StateNotice({
  state,
  onResume,
  resuming,
}: {
  state: SpendState;
  onResume: () => void;
  resuming: boolean;
}) {
  const paused = pausedText(state);
  if (paused)
    return (
      <div
        role="status"
        className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[13px]"
      >
        <div className="min-w-0">
          <p className="m-0 font-medium">Model calls are paused</p>
          <p className="m-0 text-muted-foreground">
            {paused.reasons.join(" ")} {paused.ends}
          </p>
        </div>
        <button
          type="button"
          className={secondaryButton}
          disabled={resuming}
          onClick={onResume}
        >
          Resume
        </button>
      </div>
    );
  const warning = warningText(state);
  return warning ? (
    <p role="status" className="mb-6 mt-0 text-[13px] text-(--warning-text)">
      {warning}
    </p>
  ) : null;
}

function Report({
  report,
  onResume,
  resuming,
}: {
  report: UsageReport;
  onResume: () => void;
  resuming: boolean;
}) {
  const { totals } = report;
  const notice = (
    <StateNotice state={report.state} onResume={onResume} resuming={resuming} />
  );
  if (report.retainedSince === null)
    return (
      <>
        {notice}
        <p className="mt-10 text-center text-sm text-muted-foreground">
          No model calls recorded yet.
        </p>
      </>
    );
  const text = totalsText(totals);
  return (
    <>
      {notice}
      {totals.calls === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          No model calls in {inRange(report.range)}.
        </p>
      ) : (
        <>
          <SpendChart
            buckets={report.buckets}
            bucketMs={report.bucketMs}
            label={`Reported cost over ${inRange(report.range)}`}
          />
          <p className="mb-0 mt-4 text-[13px]">
            {text.cost ? (
              <>
                <span className="font-semibold tabular-nums">
                  {text.cost}
                </span>{" "}
              </>
            ) : null}
            {text.sentence}
            {text.unmetered ? ` ${text.unmetered}` : null}
          </p>
          {text.tokens ? (
            <p className="m-0 mt-0.5 text-xs text-muted-foreground">
              {text.tokens}
            </p>
          ) : null}
          {report.retainedSince > report.from ? (
            <p className="m-0 mt-0.5 text-xs text-muted-foreground">
              {retainedText(report.retainedSince, report.bucketMs)}
            </p>
          ) : null}
        </>
      )}
      <Section heading="Limits">
        <Limits state={report.state} windows={report.windows} />
      </Section>
      {report.flags.length ? (
        <Section heading="Flags">
          <Flags flags={report.flags} now={report.now} />
        </Section>
      ) : null}
      {totals.calls > 0 ? (
        <div className="mt-8 flex flex-col gap-8">
          <Breakdown
            heading="Workstream"
            groups={report.byWorkstream}
            name={workstreamName}
          />
          <Breakdown heading="Call kind" groups={report.bySource} />
          <Breakdown heading="Model" groups={report.byModel} />
          <Breakdown
            heading="Thread"
            groups={report.byThread}
            name={threadName}
          />
          <Breakdown heading="Path" groups={report.byPath} />
        </div>
      ) : null}
    </>
  );
}

export function Usage({
  rpc,
}: {
  rpc: ReturnType<typeof useRpc<RpcContract>>;
}) {
  const usage = useUsageReport(rpc);
  const { report, error } = usage;
  return (
    <div className="mt-5">
      <SelectField
        label="Range"
        value={usage.range}
        options={RANGE_OPTIONS}
        onChange={usage.setRange}
        className="h-7 w-auto px-2 text-xs"
      />
      {error ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p role="alert" className="m-0 text-xs text-destructive">
            {report
              ? "Usage could not be refreshed."
              : "Usage could not be loaded."}{" "}
            {error}
          </p>
          <button
            type="button"
            className={report ? ghostButton : secondaryButton}
            onClick={() => void usage.retry()}
          >
            Retry
          </button>
        </div>
      ) : null}
      {report ? (
        <div
          aria-busy={usage.stale}
          className={cn("mt-5", usage.stale && "opacity-60")}
        >
          <Report
            report={report}
            onResume={() => void usage.resume()}
            resuming={usage.resuming}
          />
        </div>
      ) : error ? null : (
        <p role="status" className="mt-5 text-[13px] text-muted-foreground">
          Loading usage…
        </p>
      )}
    </div>
  );
}
