/**
 * The workstreams and groups: every workstream, nested under its group, with
 * its open threads counted. Empty workstreams hide behind Show N empty. Clicking a workstream opens its editor: name,
 * parent, description, and aliases, with Add workstream and Merge into….
 * Search narrows the tree to matching workstreams and their ancestors.
 */
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SectionHeading } from "../../primitives/SectionHeading.tsx";
import type { Workstream } from "../../../domain/workstreams.ts";
import { workstreamAncestors } from "../../../domain/workstreams.ts";
import { workstreamPath } from "../../../domain/workstream-path.ts";
import { compareGroupNames } from "../../../domain/group-name-order.ts";
import { SelectField } from "../../SelectField.tsx";
import { ghostButton } from "../controls.ts";
import {
  CreateWorkstreamDialog,
  MergeWorkstreamDialog,
} from "../WorkstreamDialogs.tsx";
import type { useWorkstreams } from "../../useWorkstreams.ts";

type Workstreams = ReturnType<typeof useWorkstreams>;

const shownPath = (id: string, workstreams: readonly Workstream[]) =>
  workstreamPath(id, workstreams);

/** Open threads per workstream, each group counting its workstreams' threads. */
function workstreamCounts(
  workstreams: readonly Workstream[],
  assignments: Readonly<Record<string, { workstreamId: string | null }>>,
  topThreadIds: Iterable<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of topThreadIds) {
    const workstream = assignments[id]?.workstreamId;
    if (!workstream) continue;
    let ancestors: string[];
    try {
      ancestors = workstreamAncestors(workstream, workstreams);
    } catch {
      continue;
    }
    for (const at of ancestors) counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  return counts;
}

type Dialogs =
  | { kind: "edit"; workstream: Workstream }
  | { kind: "create"; parentId: string | null }
  | { kind: "merge"; workstream: Workstream };

export function WorkstreamTree({
  ws,
  query,
}: {
  ws: Workstreams;
  query: string;
}) {
  const tree = ws.server.tree;
  const workstreams = tree?.workstreams ?? [];
  const [showEmpty, setShowEmpty] = useState(false);
  // The open flag is separate from the workstream, so a closing dialog keeps its
  // contents while it animates out.
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [open, setOpen] = useState(false);
  const show = (next: Dialogs) => {
    setDialog(next);
    setOpen(true);
  };

  const counts = useMemo(() => {
    const topThreadIds = [...ws.projection.rowOf.values()]
      .filter((row) => row.depth === 0)
      .map((row) => row.thread.id);
    return workstreamCounts(workstreams, tree?.assignments ?? {}, topThreadIds);
  }, [workstreams, tree?.assignments, ws.projection]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = new Set(
      workstreams
        .filter(
          (workstream) =>
            !needle ||
            [
              shownPath(workstream.id, workstreams),
              workstream.description,
              ...workstream.aliases,
            ].some((text) => text.toLowerCase().includes(needle)),
        )
        .map((workstream) => workstream.id),
    );
    if (needle)
      for (const id of [...matches])
        for (const at of safeAncestors(id, workstreams)) matches.add(at);
    const out: { workstream: Workstream; depth: number }[] = [];
    const visit = (parentId: string | null, depth: number) => {
      for (const workstream of workstreams
        .filter((e) => e.parentId === parentId)
        .sort(
          (a, b) =>
            (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
            compareGroupNames(a.name, b.name),
        )) {
        if (!matches.has(workstream.id)) continue;
        if (!needle && !showEmpty && !counts.get(workstream.id)) continue;
        out.push({ workstream, depth });
        visit(workstream.id, depth + 1);
      }
    };
    visit(null, 0);
    return out;
  }, [workstreams, counts, query, showEmpty]);
  const empty = workstreams.filter((e) => !counts.get(e.id)).length;

  return (
    <section aria-label="Workstreams" className="mt-10">
      <SectionHeading className="mb-1.5 flex items-center gap-2">
        Workstreams and groups
        <span className="flex-1" />
        {empty && !query ? (
          <button
            type="button"
            className={cn(ghostButton, "normal-case tracking-normal")}
            onClick={() => setShowEmpty(!showEmpty)}
          >
            {showEmpty ? "Hide" : "Show"} {empty} empty
          </button>
        ) : null}
        <button
          type="button"
          className={cn(ghostButton, "normal-case tracking-normal")}
          onClick={() => show({ kind: "create", parentId: null })}
        >
          New workstream…
        </button>
      </SectionHeading>
      {rows.length ? (
        <ul className="-mx-2">
          {rows.map(({ workstream, depth }) => {
            const count = counts.get(workstream.id) ?? 0;
            return (
              <li key={workstream.id}>
                <button
                  type="button"
                  onClick={() => show({ kind: "edit", workstream })}
                  className="flex w-full cursor-pointer items-baseline gap-3 rounded-md py-1 pr-2 text-left hover:bg-state-hover"
                  style={{ paddingLeft: 8 + depth * 16 }}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      !count && "text-muted-foreground/70",
                    )}
                  >
                    {workstream.name}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground/70">
                    {count || ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          {query ? "No matching workstreams." : "No workstreams yet."}
        </p>
      )}
      {dialog?.kind === "edit" ? (
        <EditWorkstreamDialog
          open={open}
          onOpenChange={setOpen}
          workstream={dialog.workstream}
          workstreams={workstreams}
          ws={ws}
          onAddWorkstream={() =>
            show({ kind: "create", parentId: dialog.workstream.id })
          }
          onMerge={() => show({ kind: "merge", workstream: dialog.workstream })}
        />
      ) : null}
      {dialog?.kind === "create" && open ? (
        <CreateWorkstreamDialog
          parentId={dialog.parentId}
          workstreams={workstreams}
          rpc={ws.rpc}
          onSuccess={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {dialog?.kind === "merge" && open ? (
        <MergeWorkstreamDialog
          workstream={dialog.workstream}
          workstreams={workstreams}
          rpc={ws.rpc}
          onSuccess={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function safeAncestors(
  id: string,
  workstreams: readonly Workstream[],
): string[] {
  try {
    return workstreamAncestors(id, workstreams);
  } catch {
    return [];
  }
}

/** Name, parent, description, and aliases, saved together. */
const AUTOMATIC_PROJECT = "__automatic__";
const projectValue = (workstream: Workstream) =>
  workstream.projectSource === "disabled"
    ? ""
    : workstream.projectSource === "learned" || !workstream.projectId
      ? AUTOMATIC_PROJECT
      : workstream.projectId;

function EditWorkstreamDialog({
  open,
  onOpenChange,
  workstream,
  workstreams,
  ws,
  onAddWorkstream,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workstream: Workstream;
  workstreams: readonly Workstream[];
  ws: Workstreams;
  onAddWorkstream: () => void;
  onMerge: () => void;
}) {
  const [name, setName] = useState(workstream.name);
  const [parentId, setParentId] = useState(workstream.parentId ?? "");
  const [description, setDescription] = useState(workstream.description);
  const [projectId, setProjectId] = useState(projectValue(workstream));
  const [aliases, setAliases] = useState(workstream.aliases.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(workstream.id);
  if (editing !== workstream.id) {
    setEditing(workstream.id);
    setName(workstream.name);
    setParentId(workstream.parentId ?? "");
    setDescription(workstream.description);
    setProjectId(projectValue(workstream));
    setAliases(workstream.aliases.join(", "));
    setError(null);
  }
  // A workstream can't move under itself or, as a group, under its own workstreams.
  const parents = workstreams.filter(
    (e) => !safeAncestors(e.id, workstreams).includes(workstream.id),
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const list = aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      if (list.some((alias) => alias.length > 80))
        throw new Error("Keep each alias to 80 characters or fewer.");
      if (name.trim() && name.trim() !== workstream.name)
        await ws.rpc.call("workstreamRename", {
          workstreamId: workstream.id,
          name: name.trim(),
        });
      if ((parentId || null) !== workstream.parentId)
        await ws.rpc.call("workstreamMove", {
          workstreamId: workstream.id,
          parentId: parentId || null,
        });
      if (
        description.trim() !== workstream.description ||
        list.join("\n") !== workstream.aliases.join("\n") ||
        projectId !== projectValue(workstream)
      )
        await ws.rpc.call("workstreamUpdate", {
          workstreamId: workstream.id,
          description: description.trim(),
          aliases: list,
          ...(projectId !== projectValue(workstream)
            ? projectId === AUTOMATIC_PROJECT
              ? { projectId: null, projectAutomatic: true }
              : { projectId: projectId || null }
            : {}),
        });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>Edit workstream</DialogTitle>
            <DialogDescription>
              {shownPath(workstream.id, workstreams)}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p
              role="alert"
              className="rounded bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <label className="block text-xs font-medium">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="mt-1 h-8 text-xs"
            />
          </label>
          <div className="text-xs font-medium">
            Group
            <SelectField
              label="Group"
              value={parentId}
              options={[
                { value: "", label: "No group" },
                ...parents.map((e) => ({
                  value: e.id,
                  label: shownPath(e.id, workstreams),
                })),
              ]}
              onChange={setParentId}
              className="mt-1 h-8 text-xs"
            />
          </div>
          <div className="text-xs font-medium">
            Project
            <SelectField
              label="Project"
              value={projectId}
              options={[
                {
                  value: AUTOMATIC_PROJECT,
                  label:
                    workstream.projectSource === "learned" &&
                    workstream.projectId
                      ? `Automatic · ${ws.projects.find((project) => project.id === workstream.projectId)?.name ?? "Unavailable project"}`
                      : "Automatic · No project",
                },
                { value: "", label: "No project" },
                ...ws.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
                ...(projectId &&
                projectId !== AUTOMATIC_PROJECT &&
                !ws.projects.some((project) => project.id === projectId)
                  ? [{ value: projectId, label: "Unavailable project" }]
                  : []),
              ]}
              onChange={setProjectId}
              className="mt-1 h-8 text-xs"
            />
          </div>
          <label className="block text-xs font-medium">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="What belongs here"
              className="mt-1 w-full rounded-md border border-input bg-transparent p-2 text-xs font-normal"
            />
          </label>
          <label className="block text-xs font-medium">
            Aliases
            <Input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="Other names, separated by commas"
              className="mt-1 h-8 text-xs"
            />
          </label>
          <DialogFooter className="items-center gap-1 sm:justify-between">
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onAddWorkstream}
              >
                Add workstream…
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onMerge}>
                Merge into…
              </Button>
            </div>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
