import { useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract, RepairPreview } from "../../server/contract.ts";
import { secondaryButton, primaryButton } from "./controls.ts";

/** Explicit preview/apply keeps workstream tree repairs separate from editing workstreams. */
export function Repair({
  rpc,
  threadIds,
  onApplied,
}: {
  rpc: ReturnType<typeof useRpc<RpcContract>>;
  threadIds: string[];
  onApplied: () => void;
}) {
  const [plan, setPlan] = useState<RepairPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (apply: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (apply && plan) {
        const result = await rpc.call("repairApply", {
          planId: plan.id,
        });
        setMessage(
          `Moved ${result.changed} threads; skipped ${result.skipped}. Threads you moved, and newer requests, are left as they are.`,
        );
        setPlan(null);
        onApplied();
      } else {
        const next = await rpc.call("repairPreview", { threadIds });
        setPlan(next);
        setMessage(
          `${next.rows.filter((row) => !row.error).length} moves ready for review; ${next.excludedManual} threads you moved left out.`,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="rounded-xl border border-border p-4"
      aria-label="Preview automatic moves"
    >
      <h2 className="text-sm font-semibold">Preview automatic moves</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        After changing your workstreams, preview where Workstreams would move
        the threads it placed itself. Previewing makes model calls but moves no
        threads and changes no titles.
      </p>
      <button
        type="button"
        className={`${secondaryButton} mt-3`}
        disabled={busy || !threadIds.length || threadIds.length > 100}
        onClick={() => void run(false)}
      >
        {busy ? "Previewing…" : "Preview moves"}
      </button>
      {threadIds.length > 100 ? (
        <p className="mt-2 text-xs">
          This view previews up to 100 threads. For a larger set, preview
          threads one at a time with{" "}
          <code>bb workstreams preview &lt;thread-id&gt;</code>.
        </p>
      ) : null}
      {plan ? (
        <div className="mt-3">
          {plan.excludedManual ? (
            <p className="mb-2 text-xs">
              {plan.excludedManual} threads you moved left out
            </p>
          ) : null}
          <ul className="space-y-1 text-xs">
            {plan.rows.map((row) => (
              <li key={row.threadId}>
                {row.title}: {row.from ?? "No workstream"} →{" "}
                {row.to ?? "No workstream"}
                {row.error ? ` — ${row.error}` : ""}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`${primaryButton} mt-3`}
            disabled={busy || plan.rows.every((row) => row.error)}
            onClick={() => void run(true)}
          >
            Apply the preview
          </button>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="mt-2 text-xs">
        {message ?? ""}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
