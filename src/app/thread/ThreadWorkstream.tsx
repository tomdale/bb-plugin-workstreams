import { useId, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  useSharedServerState,
  useThreadRecordSelector,
} from "../serverState.ts";
import {
  takesThreads,
  type WorkstreamAssignment,
  type Workstream,
} from "../../domain/workstreams.ts";
import { workstreamPath } from "../../domain/workstream-path.ts";
import { compareGroupNames } from "../../domain/group-name-order.ts";
import { TAG_ICON } from "../workstream-icon.ts";

/**
 * A thread's Workstream setting. Automatic (the default) lets the classifier pick
 * the workstream, and the picker shows its current result under that choice.
 * Picking a workstream replaces Automatic and is never reclassified; choosing
 * Automatic again hands the thread back to the classifier. A fork shows its
 * parent thread's workstream and can't be set on its own.
 */

const UNCLASSIFIED = "No workstream";
const CLASSIFYING = "Organizing…";

const displayWorkstreamPath = (
  id: string,
  workstreams: readonly Workstream[],
) => workstreamPath(id, workstreams);

/** Whether the classifier, not the user, owns this thread's workstream. */
export const isAutomaticWorkstream = (
  assignment: WorkstreamAssignment | null,
) => assignment?.provenance !== "manual";

type WorkstreamButtonProps = {
  /** The effective workstream path, or null when the thread has none. */
  label: string | null;
  isAutomatic: boolean;
  /** Where the workstream came from, for its description. */
  provenance?: WorkstreamAssignment["provenance"];
  isFork?: boolean;
  isClassifying?: boolean;
  /** The workstream is still being read; the button holds its place unseen. */
  isLoading?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

function WorkstreamButton({
  label,
  isAutomatic,
  provenance = null,
  isFork = false,
  isClassifying = false,
  isLoading = false,
  onClick,
  disabled = false,
}: WorkstreamButtonProps) {
  const displayLabel = isClassifying ? CLASSIFYING : (label ?? UNCLASSIFIED);
  const source = isFork
    ? "follows its parent thread"
    : !isAutomatic
      ? "moved there by you"
      : provenance === "composer"
        ? "the composer's until the thread's start answers"
        : provenance === "inherited"
          ? "from where the thread started"
          : "automatic";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={
        isLoading ? "Workstream" : `Workstream: ${displayLabel} (${source})`
      }
      title={isLoading ? undefined : `Workstream: ${displayLabel} (${source})`}
      aria-busy={isLoading || undefined}
      className={`ws-thread-workstream ${
        label ? "" : "ws-thread-workstream-none"
      }${isLoading ? " invisible" : ""}`}
    >
      <Icon
        name={isClassifying ? "Spinner" : TAG_ICON}
        className={`size-3.5 shrink-0 opacity-70 ${
          isClassifying ? "animate-spin" : ""
        }`}
        aria-hidden="true"
      />
      <span className="ws-thread-workstream-label">{displayLabel}</span>
    </button>
  );
}

type WorkstreamPickerProps = {
  assignment: WorkstreamAssignment | null;
  workstreams: readonly Workstream[];
  onSelectWorkstream: (workstreamId: string) => Promise<void> | void;
  onSelectAutomatic: () => Promise<void> | void;
  onClose?: () => void;
};

function WorkstreamPicker({
  assignment,
  workstreams,
  onSelectWorkstream,
  onSelectAutomatic,
  onClose,
}: WorkstreamPickerProps) {
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const searchInputId = useId();

  const automatic = isAutomaticWorkstream(assignment);
  const currentWorkstream = assignment?.workstreamId
    ? (workstreams.find((e) => e.id === assignment.workstreamId) ?? null)
    : null;
  const classifierResult =
    pending === "automatic"
      ? CLASSIFYING
      : automatic && currentWorkstream
        ? displayWorkstreamPath(currentWorkstream.id, workstreams)
        : automatic
          ? UNCLASSIFIED
          : "Workstreams chooses from your requests";

  const options = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return workstreams
      .filter((workstream) => {
        if (!takesThreads(workstream.id, workstreams)) return false;
        if (!needle) return true;
        return (
          displayWorkstreamPath(workstream.id, workstreams)
            .toLowerCase()
            .includes(needle) ||
          workstream.description.toLowerCase().includes(needle) ||
          workstream.aliases.some((a) => a.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) =>
        compareGroupNames(
          displayWorkstreamPath(a.id, workstreams),
          displayWorkstreamPath(b.id, workstreams),
        ),
      );
  }, [workstreams, search]);

  const run = async (key: string, action: () => Promise<void> | void) => {
    setError(null);
    setPending(key);
    try {
      await action();
      onClose?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't change the workstream.",
      );
    } finally {
      setPending(null);
    }
  };

  const busy = pending !== null;
  const rowClass =
    "flex w-full items-start justify-between gap-2 p-2 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none";

  return (
    <div className="flex w-80 flex-col gap-2 p-3 text-popover-foreground">
      <h4 className="text-xs font-semibold text-muted-foreground">
        Workstream
      </h4>

      <button
        type="button"
        disabled={busy || automatic}
        onClick={() => run("automatic", onSelectAutomatic)}
        aria-pressed={automatic}
        className={`${rowClass} rounded-md ${automatic ? "bg-accent/60" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium">Automatic</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {classifierResult}
          </div>
        </div>
        {automatic ? (
          <Icon
            name="Check"
            className="ml-2 size-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
        ) : null}
      </button>

      {error ? (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}

      <Input
        id={searchInputId}
        placeholder="Find a workstream"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 text-xs"
        aria-label="Search workstreams"
      />

      <div className="max-h-52 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
        {options.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground">
            No matching workstreams.
          </div>
        ) : (
          options.map((workstream) => {
            const isChosen =
              !automatic && workstream.id === currentWorkstream?.id;
            return (
              <button
                key={workstream.id}
                type="button"
                disabled={busy || isChosen}
                onClick={() =>
                  run(workstream.id, () => onSelectWorkstream(workstream.id))
                }
                aria-pressed={isChosen}
                className={`${rowClass} ${isChosen ? "bg-accent/60 font-medium" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {displayWorkstreamPath(workstream.id, workstreams)}
                  </div>
                  {workstream.aliases.length ? (
                    <div className="truncate text-[10px] text-muted-foreground">
                      Also known as {workstream.aliases.join(", ")}
                    </div>
                  ) : null}
                </div>
                {pending === workstream.id ? (
                  <Icon
                    name="Spinner"
                    className="ml-2 size-3.5 shrink-0 animate-spin"
                    aria-hidden="true"
                  />
                ) : isChosen ? (
                  <Icon
                    name="Check"
                    className="ml-2 size-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

type ThreadWorkstreamProps = {
  threadId: string;
};

export function ThreadWorkstream({ threadId }: ThreadWorkstreamProps) {
  const { server, rpc, refresh } = useSharedServerState();
  const [open, setOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);

  const workstreams = server.tree?.workstreams ?? [];
  const record = useThreadRecordSelector(
    threadId,
    (thread) => thread.assignment,
  );
  const assignment = record ?? null;
  const currentWorkstream = assignment?.workstreamId
    ? (workstreams.find((e) => e.id === assignment.workstreamId) ?? null)
    : null;
  const label = currentWorkstream
    ? displayWorkstreamPath(currentWorkstream.id, workstreams)
    : null;
  const isFork = Boolean(assignment?.inheritedFrom);
  const automatic = isAutomaticWorkstream(assignment);

  const selectWorkstream = async (workstreamId: string) => {
    await rpc.call("threadMove", { threadId, workstreamId });
    await refresh();
  };

  // Automatic hands the workstream back to Workstreams, which settles it now with
  // the turn-end call; that also lifts a workstream the user chose earlier.
  const selectAutomatic = async () => {
    setClassifying(true);
    try {
      await rpc.call("threadAutomatic", { threadId });
      await refresh();
    } finally {
      setClassifying(false);
    }
  };

  const button = (props: Partial<WorkstreamButtonProps> = {}) => (
    <WorkstreamButton
      label={label}
      isAutomatic={automatic}
      provenance={assignment?.provenance ?? null}
      isFork={isFork}
      isClassifying={classifying}
      {...props}
    />
  );

  if (record === undefined) return button({ disabled: true, isLoading: true });
  if (isFork) return button({ disabled: true });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>{button()}</div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="z-50 p-0 shadow-lg"
      >
        <WorkstreamPicker
          assignment={assignment}
          workstreams={workstreams}
          onSelectWorkstream={selectWorkstream}
          onSelectAutomatic={selectAutomatic}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
