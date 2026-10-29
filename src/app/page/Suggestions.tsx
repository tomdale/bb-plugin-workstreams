/**
 * Organizing suggestions on the Organization tab: splits of busy topics and
 * tidy edits to the topic tree. Each one leads with its operation and the
 * threads or topics it would move, from where to where, then its reason.
 * Nothing changes until you accept one; a declined suggestion isn't proposed
 * again.
 */
import { useCallback, useEffect, useState } from "react";
import { useRealtime, type useRpc } from "@get-bb/plugin-sdk/app";
import type {
  RpcContract,
  SuggestionsStateWire,
} from "../../server/contract.ts";
import { relativeAgeLabel } from "../../domain/presentation.ts";
import { ghostButton, primaryButton, secondaryButton } from "./controls.ts";
import { SuggestionChangeMoves, changeHeading } from "./SuggestionChange.tsx";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;
type Suggestion = SuggestionsStateWire["suggestions"][number];

const DECIDED: Record<Exclude<Suggestion["status"], "pending">, string> = {
  accepted: "Accepted",
  declined: "Declined",
  stale: "Not applied",
};

export function Suggestions({
  rpc,
  onChanged,
}: {
  rpc: Rpc;
  /** An accepted suggestion changed topics. */
  onChanged?: () => void;
}) {
  const [state, setState] = useState<SuggestionsStateWire | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      setState((await rpc.call("suggestions", null)).state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);
  useEffect(() => {
    void read();
  }, [read]);
  useRealtime("changed", () => void read());

  const act = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      void read();
    }
  };
  const decide = (ids: string[], decision: "accept" | "decline") =>
    act(async () => {
      const result = await rpc.call("suggestionsDecide", { ids, decision });
      setState(result.state);
      if (decision === "accept" && result.applied.length) onChanged?.();
      return result.failed.length
        ? result.failed.map((f) => `Couldn't apply: ${f.reason}`).join(" ")
        : null;
    });
  const ask = () =>
    act(async () => {
      const result = await rpc.call("suggestionsRun", null);
      setState(result.state);
      return result.state.suggestions.some((s) => s.status === "pending")
        ? null
        : "No suggestions: your topics look tidy.";
    });

  if (!state) return null;
  const pending = state.suggestions.filter((s) => s.status === "pending");
  const recent = state.suggestions
    .filter((s) => s.status !== "pending")
    .slice(0, 5);
  const ready = pending.filter((s) => !s.problem);
  const running = busy || state.running;

  return (
    <section
      aria-label="Organizing suggestions"
      className="rounded-xl border border-border p-4"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-sm font-semibold">Suggestions</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Splits for busy topics and tidy edits to your topics. Nothing
            changes until you accept one.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ready.length > 1 ? (
            <button
              type="button"
              className={secondaryButton}
              disabled={running}
              onClick={() =>
                void decide(
                  ready.map((s) => s.id),
                  "accept",
                )
              }
            >
              Accept all
            </button>
          ) : null}
          <button
            type="button"
            className={ghostButton}
            disabled={running}
            onClick={() => void ask()}
          >
            {state.running ? "Asking…" : "Ask now"}
          </button>
        </div>
      </div>
      {pending.length ? (
        <ul className="mt-3 divide-y divide-border">
          {pending.map((s) => (
            <li key={s.id} className="py-3">
              <div className="flex items-center gap-x-4">
                <h3 className="min-w-0 flex-1 text-[13px] font-medium">
                  {s.change ? changeHeading(s.change) : s.summary}
                </h3>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className={ghostButton}
                    disabled={running}
                    aria-label={`Decline: ${s.summary}`}
                    onClick={() => void decide([s.id], "decline")}
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={running || s.problem !== null}
                    aria-label={`Accept: ${s.summary}`}
                    onClick={() => void decide([s.id], "accept")}
                  >
                    Accept
                  </button>
                </div>
              </div>
              {s.change ? (
                <div className="mt-2">
                  <SuggestionChangeMoves change={s.change} />
                </div>
              ) : null}
              {s.reason ? (
                <p className="mt-2 text-xs text-muted-foreground">{s.reason}</p>
              ) : null}
              {s.problem ? (
                <p className="mt-1 text-xs text-(--ws-needs-you-strong)">
                  Can't apply now: {s.problem}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No suggestions right now
          {state.lastRunAt
            ? `; last checked ${relativeAgeLabel(state.lastRunAt, Date.now())}`
            : ""}
          .
        </p>
      )}
      {recent.length ? (
        <details className="group mt-3 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer list-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            Recently decided
          </summary>
          <ul className="mt-2 space-y-1">
            {recent.map((s) => (
              <li key={s.id}>
                <span className="font-medium">
                  {DECIDED[s.status as keyof typeof DECIDED]}:
                </span>{" "}
                {s.summary}
                {s.status === "stale" && s.problem ? ` (${s.problem})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p role="status" aria-live="polite" className="mt-2 text-xs">
        {message ?? ""}
      </p>
      {error || state.error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error ?? `The last run failed: ${state.error}`}
        </p>
      ) : null}
    </section>
  );
}
