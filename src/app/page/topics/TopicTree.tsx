/**
 * The topic tree: every topic, nested, with its open threads counted. Empty
 * topics hide behind Show N empty. Clicking a topic opens its editor: name,
 * parent, description, and aliases, with Add subtopic and Merge into….
 * Search narrows the tree to matching topics and their ancestors.
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
import type { Topic } from "../../../domain/topics.ts";
import { topicAncestors } from "../../../domain/topics.ts";
import { topicPath } from "../../../domain/topic-path.ts";
import { compareGroupNames } from "../../../domain/group-name-order.ts";
import { SelectField } from "../../SelectField.tsx";
import { ghostButton } from "../controls.ts";
import { CreateEntityDialog, MergeEntityDialog } from "../CatalogDialogs.tsx";
import type { useWorkstreams } from "../../useWorkstreams.ts";

type Workstreams = ReturnType<typeof useWorkstreams>;

const shownPath = (id: string, entities: readonly Topic[]) =>
  topicPath(id, entities).replace(/: /g, " › ");

/** Open root threads per topic, each topic counting its subtopics'. */
export function topicCounts(
  entities: readonly Topic[],
  assignments: Readonly<Record<string, { entityId: string | null }>>,
  roots: Iterable<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of roots) {
    const topic = assignments[id]?.entityId;
    if (!topic) continue;
    let ancestors: string[];
    try {
      ancestors = topicAncestors(topic, entities);
    } catch {
      continue;
    }
    for (const at of ancestors) counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  return counts;
}

type Dialogs =
  | { kind: "edit"; topic: Topic }
  | { kind: "create"; parentId: string | null }
  | { kind: "merge"; topic: Topic };

export function TopicTree({ ws, query }: { ws: Workstreams; query: string }) {
  const catalog = ws.server.catalog;
  const entities = catalog?.entities ?? [];
  const [showEmpty, setShowEmpty] = useState(false);
  // The open flag is separate from the topic, so a closing dialog keeps its
  // contents while it animates out.
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [open, setOpen] = useState(false);
  const show = (next: Dialogs) => {
    setDialog(next);
    setOpen(true);
  };

  const counts = useMemo(() => {
    const roots = [...ws.projection.rowOf.values()]
      .filter((row) => row.depth === 0)
      .map((row) => row.thread.id);
    return topicCounts(entities, catalog?.assignments ?? {}, roots);
  }, [entities, catalog?.assignments, ws.projection]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = new Set(
      entities
        .filter(
          (entity) =>
            !needle ||
            [
              shownPath(entity.id, entities),
              entity.description,
              ...entity.aliases,
            ].some((text) => text.toLowerCase().includes(needle)),
        )
        .map((entity) => entity.id),
    );
    if (needle)
      for (const id of [...matches])
        for (const at of safeAncestors(id, entities)) matches.add(at);
    const out: { topic: Topic; depth: number }[] = [];
    const visit = (parentId: string | null, depth: number) => {
      for (const topic of entities
        .filter((e) => e.parentId === parentId)
        .sort(
          (a, b) =>
            (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
            compareGroupNames(a.name, b.name),
        )) {
        if (!matches.has(topic.id)) continue;
        if (!needle && !showEmpty && !counts.get(topic.id)) continue;
        out.push({ topic, depth });
        visit(topic.id, depth + 1);
      }
    };
    visit(null, 0);
    return out;
  }, [entities, counts, query, showEmpty]);
  const empty = entities.filter((e) => !counts.get(e.id)).length;

  return (
    <section aria-label="Topics" className="mt-10">
      <h2 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Topics
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
          New topic…
        </button>
      </h2>
      {rows.length ? (
        <ul className="-mx-2">
          {rows.map(({ topic, depth }) => {
            const count = counts.get(topic.id) ?? 0;
            return (
              <li key={topic.id}>
                <button
                  type="button"
                  onClick={() => show({ kind: "edit", topic })}
                  className="flex w-full cursor-pointer items-baseline gap-3 rounded-md py-1 pr-2 text-left hover:bg-state-hover"
                  style={{ paddingLeft: 8 + depth * 16 }}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      !count && "text-muted-foreground/70",
                    )}
                  >
                    {topic.name}
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
          {query ? "No matching topics." : "No topics yet."}
        </p>
      )}
      {dialog?.kind === "edit" ? (
        <EditTopicDialog
          open={open}
          onOpenChange={setOpen}
          topic={dialog.topic}
          entities={entities}
          ws={ws}
          onAddSubtopic={() =>
            show({ kind: "create", parentId: dialog.topic.id })
          }
          onMerge={() => show({ kind: "merge", topic: dialog.topic })}
        />
      ) : null}
      {dialog?.kind === "create" && open ? (
        <CreateEntityDialog
          parentId={dialog.parentId}
          entities={entities}
          rpc={ws.rpc}
          onSuccess={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {dialog?.kind === "merge" && open ? (
        <MergeEntityDialog
          entity={dialog.topic}
          entities={entities}
          rpc={ws.rpc}
          onSuccess={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function safeAncestors(id: string, entities: readonly Topic[]): string[] {
  try {
    return topicAncestors(id, entities);
  } catch {
    return [];
  }
}

/** Name, parent, description, and aliases, saved together. */
function EditTopicDialog({
  open,
  onOpenChange,
  topic,
  entities,
  ws,
  onAddSubtopic,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: Topic;
  entities: readonly Topic[];
  ws: Workstreams;
  onAddSubtopic: () => void;
  onMerge: () => void;
}) {
  const [name, setName] = useState(topic.name);
  const [parentId, setParentId] = useState(topic.parentId ?? "");
  const [description, setDescription] = useState(topic.description);
  const [aliases, setAliases] = useState(topic.aliases.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(topic.id);
  if (editing !== topic.id) {
    setEditing(topic.id);
    setName(topic.name);
    setParentId(topic.parentId ?? "");
    setDescription(topic.description);
    setAliases(topic.aliases.join(", "));
    setError(null);
  }
  // A topic can't move under itself or its own subtopics.
  const parents = entities.filter(
    (e) => !safeAncestors(e.id, entities).includes(topic.id),
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
      if (name.trim() && name.trim() !== topic.name)
        await ws.rpc.call("catalogRename", {
          entityId: topic.id,
          name: name.trim(),
        });
      if ((parentId || null) !== topic.parentId)
        await ws.rpc.call("catalogReparent", {
          entityId: topic.id,
          parentId: parentId || null,
        });
      if (
        description.trim() !== topic.description ||
        list.join("\n") !== topic.aliases.join("\n")
      )
        await ws.rpc.call("catalogUpdateMetadata", {
          entityId: topic.id,
          description: description.trim(),
          aliases: list,
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
            <DialogTitle>Edit topic</DialogTitle>
            <DialogDescription>
              {shownPath(topic.id, entities)}
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
              className="mt-1 h-8 text-xs"
            />
          </label>
          <div className="text-xs font-medium">
            Parent
            <SelectField
              label="Parent"
              value={parentId}
              options={[
                { value: "", label: "Top level" },
                ...parents.map((e) => ({
                  value: e.id,
                  label: shownPath(e.id, entities),
                })),
              ]}
              onChange={setParentId}
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
                onClick={onAddSubtopic}
              >
                Add subtopic…
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
