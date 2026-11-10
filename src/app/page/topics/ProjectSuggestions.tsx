import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { ProjectSuggestion } from "../../../server/projectAssociations.ts";
import type { useWorkstreams } from "../../useWorkstreams.ts";
import { SectionHeading } from "../../primitives/SectionHeading.tsx";
import { DebugThreadButton } from "../../debug/DebugThreadButton.tsx";
import { projectSuggestionSubject } from "../../debug/subjects.ts";
import { shareJson } from "../../structuralSharing.ts";
import { useUnscopedChanged } from "../../useChanged.ts";

export function ProjectSuggestions({
  ws,
}: {
  ws: ReturnType<typeof useWorkstreams>;
}) {
  const navigate = useBbNavigate();
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const needsFocus = useRef(false);
  const generation = useRef(0);
  const read = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const result = await ws.rpc.call("projectSuggestions", null);
      if (mine === generation.current)
        setSuggestions((previous) => shareJson(previous, result.suggestions));
    } catch (cause) {
      if (mine === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [ws.rpc]);
  useEffect(() => {
    void read();
    return () => {
      generation.current++;
    };
  }, [read]);
  useEffect(() => {
    if (busy || !needsFocus.current) return;
    needsFocus.current = false;
    (
      root.current?.querySelector<HTMLButtonElement>("button") ?? root.current
    )?.focus();
  }, [busy]);
  useUnscopedChanged(() => void read());
  const decide = async (id: string, decision: "accept" | "decline") => {
    needsFocus.current = true;
    setBusy(true);
    setError(null);
    try {
      const { entry } = await ws.rpc.call("projectSuggestionDecide", {
        id,
        decision,
      });
      setEntryId(decision === "accept" ? entry.id : null);
      setNotice(decision === "decline" ? "Project association kept." : null);
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!entryId) return;
    needsFocus.current = true;
    setBusy(true);
    setError(null);
    try {
      await ws.rpc.call("undo", { entryId });
      setEntryId(null);
      setNotice("Project association restored.");
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!suggestions.length && !entryId && !error && !notice) return null;
  return (
    <section
      ref={root}
      tabIndex={-1}
      aria-label="Project associations"
      className="mt-8 space-y-3 outline-none"
    >
      <SectionHeading>Project associations</SectionHeading>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          className="space-y-2 rounded-md border border-border p-3"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="min-w-24 basis-full truncate font-medium sm:basis-0 sm:flex-1">
              {suggestion.topic}
            </span>
            <span className="min-w-0 max-w-full break-words text-muted-foreground">
              {suggestion.fromProject} → {suggestion.toProject ?? "No project"}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <DebugThreadButton
                subject={projectSuggestionSubject(suggestion)}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void decide(suggestion.id, "accept")}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void decide(suggestion.id, "decline")}
              >
                Decline
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Supporting threads
            </summary>
            <ul className="mt-1 space-y-1">
              {suggestion.threads.map((thread) => (
                <li key={thread.id} className="flex gap-2">
                  <button
                    type="button"
                    className="min-w-0 truncate text-left hover:underline"
                    onClick={() => navigate.toThread(thread.id)}
                  >
                    {thread.name}
                  </button>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {thread.project}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ))}
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {entryId ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Project association updated.
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void undo()}
          >
            Undo
          </Button>
        </div>
      ) : null}
    </section>
  );
}
