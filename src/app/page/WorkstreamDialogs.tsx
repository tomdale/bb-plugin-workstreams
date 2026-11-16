import { useMemo, useState, type FormEvent } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
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
import type { RpcContract } from "../../server/contract.ts";
import type { Workstream } from "../../domain/topics.ts";
import { workstreamAncestors } from "../../domain/topics.ts";
import { workstreamPath } from "../../domain/topic-path.ts";
import { SelectField } from "../SelectField.tsx";

/** A dialog field's select, as tall as its inputs. */
const dialogSelectClass = "mt-1 h-8 text-xs";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

export function CreateWorkstreamDialog({
  parentId: initialParentId,
  workstreams,
  rpc,
  onSuccess,
  onClose,
}: {
  parentId: string | null;
  workstreams: readonly Workstream[];
  rpc: Rpc;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [aliasesText, setAliasesText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parentOptions = useMemo(
    () => [
      { value: "", label: "No group" },
      ...workstreams.map((e) => ({
        value: e.id,
        label: workstreamPath(e.id, workstreams),
      })),
    ],
    [workstreams],
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const aliases = aliasesText
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      if (aliases.some((alias) => alias.length > 80))
        throw new Error("Keep each alias to 80 characters or fewer.");
      await rpc.call("workstreamCreate", {
        name: name.trim(),
        description: description.trim(),
        parentId,
        aliases,
      });
      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't create the workstream.",
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>
              New workstream
            </DialogTitle>
            <DialogDescription>
              Workstreams can move threads into it right away.
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div
              role="alert"
              className="rounded bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </div>
          ) : null}

          <div>
            <label className="text-xs font-medium text-foreground">
              Name *
            </label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Workstreams, Sidebar, Billing"
              maxLength={200}
              className="mt-1 h-8 text-xs"
              aria-label="Name *"
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground">
              Group
            </label>
            <SelectField
              label="Group"
              value={parentId ?? ""}
              options={parentOptions}
              onChange={(next) => setParentId(next || null)}
              className={dialogSelectClass}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What belongs here"
              maxLength={1000}
              rows={2}
              aria-label="Description"
              className="mt-1 w-full rounded-md border border-input bg-transparent p-2 text-xs"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground">
              Aliases
            </label>
            <Input
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
              placeholder="Alternative names, separated by commas"
              className="mt-1 h-8 text-xs"
              aria-label="Aliases"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim() || busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MergeWorkstreamDialog({
  workstream,
  workstreams,
  rpc,
  onSuccess,
  onClose,
}: {
  workstream: Workstream;
  workstreams: readonly Workstream[];
  rpc: Rpc;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Exclude self and any descendants
  const invalid = useMemo(() => {
    const invalid = new Set<string>([workstream.id]);
    for (const other of workstreams) {
      try {
        const ancestors = workstreamAncestors(other.id, workstreams);
        if (ancestors.includes(workstream.id)) {
          invalid.add(other.id);
        }
      } catch {
        // Ignore cycle errors
      }
    }
    return invalid;
  }, [workstream.id, workstreams]);
  const validTargets = useMemo(
    () => workstreams.filter((e) => !invalid.has(e.id)),
    [workstreams, invalid],
  );
  const targetOptions = useMemo(
    () =>
      validTargets.map((e) => ({
        value: e.id,
        label: workstreamPath(e.id, workstreams),
      })),
    [workstreams, validTargets],
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!targetId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.call("workstreamMerge", {
        sourceWorkstreamId: workstream.id,
        targetWorkstreamId: targetId,
      });
      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't merge the workstreams.",
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>Merge workstream</DialogTitle>
            <DialogDescription>
              Merge &ldquo;{workstream.name}&rdquo; into another workstream or
              group. Its threads and workstreams move there, and &ldquo;
              {workstream.name}&rdquo; is deleted.
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div
              role="alert"
              className="rounded bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </div>
          ) : null}

          <div>
            <label className="text-xs font-medium text-foreground">
              Merge into *
            </label>
            <SelectField
              label="Merge into *"
              value={targetId}
              placeholder="Choose a workstream…"
              options={targetOptions}
              onChange={setTargetId}
              className={dialogSelectClass}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!targetId || busy}>
              {busy ? "Merging…" : "Merge"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
