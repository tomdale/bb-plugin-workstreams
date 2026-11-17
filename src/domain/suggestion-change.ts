/**
 * What accepting an organizing suggestion would change, as review shows it:
 * a list of moves, each one path becoming another. Pure, so the server and
 * tests share one definition.
 *
 * A thread move goes from the workstream holding its threads (null for Other) to
 * the workstream that would hold them, and lists them. A workstream move (merge, move
 * under, rename, adopt into a new parent) goes from the workstream's own path to
 * the path it would have, or for a merge to the workstream it folds into; the
 * threads that come along are counted, not listed, except a merged workstream's
 * own threads. A workstream a suggestion creates on its own has no `from`.
 *
 * `changeDelta` states the same change as data, for drawing the sidebar after.
 */
import type { Split, TidyEdit } from "./tidy.ts";
import { assertWorkstreamLevels, workstreamAncestors } from "./workstreams.ts";

type PathPart = {
  readonly name: string;
  /** Accepting the suggestion creates this workstream. */
  readonly created: boolean;
};

/** Workstream names from the top level down; empty for the top level. */
export type WorkstreamPlace = readonly PathPart[];

export type ChangeMove = {
  /** Null for Other threads, or for a workstream that doesn't exist yet. */
  readonly from: WorkstreamPlace | null;
  readonly to: WorkstreamPlace;
  /** The threads making this move. */
  readonly threads: readonly { readonly id: string; readonly title: string }[];
  /** Further visible threads that move along with a moved workstream. */
  readonly carried: number;
};

/**
 * `split` partitions a workstream's threads into new workstreams in a group; `file` moves the
 * threads a workstream holds beside its workstreams in a group into them.
 */
type ChangeOp =
  | "move-thread"
  | "split"
  | "repair"
  | "merge"
  | "move-workstream"
  | "rename"
  | "group";

export type SuggestionChange = {
  readonly op: ChangeOp;
  readonly moves: readonly ChangeMove[];
};

export type ChangeContext = {
  readonly workstreams: readonly {
    id: string;
    name: string;
    parentId: string | null;
    aliases?: readonly string[];
  }[];
  /**
   * Each top-level thread's workstream, archived ones included; null for Other.
   * A suggestion can name any of them.
   */
  readonly threadWorkstream: Readonly<Record<string, string | null>>;
  readonly title: (threadId: string) => string;
  /**
   * Whether a thread shows in the sidebar. The threads a merge or workstream
   * move lists and counts are only these, since review describes what the user
   * sees move; archived threads move too. Every thread, when absent.
   */
  readonly visible?: (threadId: string) => boolean;
  /**
   * Workstreams that waiting suggestions of the same tidy pass would create, by
   * lowercased name, so `new:` references read as their eventual paths.
   */
  readonly creates?: ReadonlyMap<
    string,
    { name: string; parent: string | null }
  >;
};

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * Accepting a suggestion as data: the workstreams it creates, renames, moves or
 * removes, and the threads it moves elsewhere, all by id. A client applies it
 * to the workstreams and thread workstreams it already holds (`applyDelta`) to
 * see the tree after accepting, so the server never needs to know how the
 * client lays the sidebar out.
 */
export type ChangeDelta = {
  /**
   * Workstreams the change creates, renames or moves, each as it would be
   * after. A workstream the change creates has no id yet, so its id here starts
   * with `new:` and stands for it within this delta only.
   */
  readonly workstreams: readonly DeltaWorkstream[];
  /** Workstreams that no longer exist, such as a merged workstream. */
  readonly removed: readonly string[];
  /**
   * Threads whose workstream changes, archived and hidden ones included; null for
   * Other. Only the threads a client draws matter to it.
   */
  readonly assignments: readonly {
    readonly threadId: string;
    readonly workstreamId: string | null;
  }[];
  /**
   * Every top-level thread in the sidebar's population (not archived or hidden)
   * that was, before the change, in a workstream it touches, with its title:
   * where a thread is moving from, a workstream that is renamed or merged, or a
   * workstream threads arrive in. The client reads only the workstreams of the
   * threads its sidebar lists, so this is how it learns of the snoozed ones a
   * change acts on.
   */
  readonly held: readonly {
    readonly threadId: string;
    readonly workstreamId: string;
    readonly title: string;
  }[];
  /**
   * How many of the threads in `assignments` are archived or hidden. Their
   * number is all a drawing says of them: a workstream can hold hundreds.
   */
  readonly archived: number;
  /**
   * The workstreams the change touches: the ones it changes, removes or moves
   * threads into or out of. A drawing shows each, even one whose threads are
   * all archived and so unknown to the client.
   */
  readonly touched: readonly string[];
};

export type DeltaWorkstream = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
};

/** The id a delta gives a workstream the change creates. */
export const newWorkstreamId = (parentId: string | null, name: string) =>
  `new:${parentId ?? ""}/${normalize(name)}`;

/**
 * What accepting `body` would change, as data, or null when a workstream or thread
 * it names no longer exists, it still needs a workstream another suggestion
 * creates, or the result would break the two-level limit. It follows what the
 * workstream store does for each kind of change, which a test holds it to.
 */
export function changeDelta(
  body: TidyEdit | Split,
  context: ChangeContext,
): ChangeDelta | null {
  try {
    return delta(body, context);
  } catch {
    return null;
  }
}

function delta(body: TidyEdit | Split, context: ChangeContext): ChangeDelta {
  const before = new Map(
    context.workstreams.map((t) => [
      t.id,
      { id: t.id, name: t.name, parentId: t.parentId },
    ]),
  );
  const workstreams = new Map<string, DeltaWorkstream>(before);
  const placed = new Map(Object.entries(context.threadWorkstream));
  const workstream = (ref: string | null) => {
    if (ref === null) return null;
    const found = workstreams.get(ref);
    if (!found) throw new Error("That workstream is gone.");
    return found;
  };
  const edit = (id: string, change: Partial<DeltaWorkstream>) =>
    workstreams.set(id, { ...workstream(id)!, ...change });
  const childrenOf = (id: string) =>
    [...workstreams.values()].filter((t) => t.parentId === id);
  const file = (threadId: string, to: string | null) => {
    if (!placed.has(threadId)) throw new Error("That thread is gone.");
    placed.set(threadId, to);
  };

  if ("workstreams" in body) {
    const parent = workstream(body.workstreamId)!;
    for (const group of body.workstreams) {
      // A workstream with no threads is not created.
      if (group.threadIds.length === 0) continue;
      const aliasesOf = (id: string) =>
        context.workstreams.find((t) => t.id === id)?.aliases ?? [];
      const existing = childrenOf(parent.id).find(
        (child) =>
          normalize(child.name) === normalize(group.name) ||
          aliasesOf(child.id).some(
            (alias) => normalize(alias) === normalize(group.name),
          ),
      );
      const id = existing?.id ?? newWorkstreamId(parent.id, group.name);
      if (!existing)
        workstreams.set(id, {
          id,
          name: group.name.trim(),
          parentId: parent.id,
        });
      for (const threadId of group.threadIds) file(threadId, id);
    }
  } else {
    switch (body.op) {
      case "move-thread":
        workstream(body.workstream);
        file(body.thread, body.workstream);
        break;
      case "rename":
        edit(body.workstream, { name: body.name.trim() });
        break;
      case "move-workstream":
        workstream(body.parent);
        edit(body.workstream, {
          parentId: body.parent,
          ...(body.name === undefined ? {} : { name: body.name.trim() }),
        });
        break;
      case "group": {
        workstream(body.parent);
        const id = newWorkstreamId(body.parent, body.name);
        workstreams.set(id, {
          id,
          name: body.name.trim(),
          parentId: body.parent,
        });
        for (const child of body.children) edit(child, { parentId: id });
        break;
      }
      case "merge": {
        const into = workstream(body.into)!;
        const from = workstream(body.from)!;
        // A target inside the source takes the source's place first.
        if (
          workstreamAncestors(into.id, [...workstreams.values()]).includes(
            from.id,
          )
        )
          edit(into.id, { parentId: from.parentId });
        // The merged workstream's threads and workstreams in a group join the target's; a
        // a workstream whose name matches one of the target's own workstreams merges into it.
        const fold = (source: string, target: string) => {
          for (const [threadId, at] of placed)
            if (at === source) placed.set(threadId, target);
          for (const child of childrenOf(source)) {
            if (child.id === target) continue;
            const twin = childrenOf(target).find(
              (other) =>
                other.id !== child.id &&
                normalize(other.name) === normalize(child.name),
            );
            if (twin) fold(child.id, twin.id);
            else edit(child.id, { parentId: target });
          }
          workstreams.delete(source);
        };
        fold(from.id, into.id);
        break;
      }
    }
  }
  assertWorkstreamLevels([...workstreams.values()]);
  const changed = [...workstreams.values()].filter((t) => {
    const was = before.get(t.id);
    return !was || was.name !== t.name || was.parentId !== t.parentId;
  });
  const removed = [...before.keys()].filter((id) => !workstreams.has(id));
  const assignments = [...placed]
    .filter(([threadId, to]) => context.threadWorkstream[threadId] !== to)
    .map(([threadId, workstreamId]) => ({ threadId, workstreamId }));
  const touched = new Set([
    ...changed.map((t) => t.id),
    ...removed,
    ...assignments.flatMap(({ threadId, workstreamId }) => [
      context.threadWorkstream[threadId] ?? null,
      workstreamId,
    ]),
  ]);
  return {
    workstreams: changed,
    removed,
    assignments,
    held: Object.entries(context.threadWorkstream)
      .filter(
        (entry): entry is [string, string] =>
          entry[1] !== null &&
          touched.has(entry[1]) &&
          (context.visible?.(entry[0]) ?? true),
      )
      .map(([threadId, workstreamId]) => ({
        threadId,
        workstreamId,
        title: context.title(threadId),
      })),
    archived: assignments.filter(
      ({ threadId }) => !(context.visible?.(threadId) ?? true),
    ).length,
    touched: [...touched].filter((id): id is string => id !== null),
  };
}

/**
 * The workstreams and thread workstreams after accepting: `delta` applied to
 * `workstreams` and to `placed`, each thread's workstream id (null for Other).
 */
export function applyDelta(
  workstreams: readonly DeltaWorkstream[],
  placed: Readonly<Record<string, string | null>>,
  change: ChangeDelta,
): { workstreams: DeltaWorkstream[]; placed: Record<string, string | null> } {
  const next = new Map(workstreams.map((t) => [t.id, t]));
  for (const id of change.removed) next.delete(id);
  for (const t of change.workstreams) next.set(t.id, t);
  const after = { ...placed };
  for (const { threadId, workstreamId } of change.assignments)
    after[threadId] = workstreamId;
  return { workstreams: [...next.values()], placed: after };
}

/**
 * The moves accepting `body` would make, or null when a workstream or thread it
 * names no longer exists; the suggestion's problem then says why.
 */
export function suggestionChange(
  body: TidyEdit | Split,
  context: ChangeContext,
): SuggestionChange | null {
  try {
    return describe(body, context);
  } catch {
    return null;
  }
}

function describe(
  body: TidyEdit | Split,
  context: ChangeContext,
): SuggestionChange {
  const { workstreams, threadWorkstream } = context;
  const byId = new Map(
    workstreams.map((workstream) => [workstream.id, workstream]),
  );

  /** A workstream's path; `new:` references name a workstream the pass creates. */
  const place = (ref: string | null, depth = 0): WorkstreamPlace => {
    if (ref === null) return [];
    if (!ref.startsWith("new:"))
      return workstreamAncestors(ref, workstreams)
        .reverse()
        .map((at) => ({ name: byId.get(at)!.name, created: false }));
    if (depth > 10) throw new Error("Workstream references loop.");
    const name = ref.slice(4).trim();
    const create = context.creates?.get(normalize(name));
    return [
      ...(create ? place(create.parent, depth + 1) : []),
      { name: create?.name ?? name, created: true },
    ];
  };
  const thread = (id: string) => {
    if (!(id in threadWorkstream)) throw new Error("That thread is gone.");
    return { id, title: context.title(id) };
  };
  /** Visible threads in a workstream or any workstream below it. */
  const shown = Object.entries(threadWorkstream).filter(
    ([id]) => context.visible?.(id) ?? true,
  );
  const within = (ref: string) =>
    shown
      .filter(
        ([, workstream]) =>
          workstream !== null &&
          byId.has(workstream) &&
          workstreamAncestors(workstream, workstreams).includes(ref),
      )
      .map(([id]) => thread(id));
  const carry = (threads: ReturnType<typeof thread>[]) => ({
    carried: threads.length,
  });
  /** A workstream moving from its own path to `to`, with its threads counted. */
  const workstreamMove = (ref: string, to: WorkstreamPlace): ChangeMove => ({
    from: place(ref),
    to,
    threads: [],
    ...carry(within(ref)),
  });
  const under = (parent: WorkstreamPlace, ref: string): WorkstreamPlace => [
    ...parent,
    place(ref).at(-1)!,
  ];

  if ("workstreams" in body) {
    const group = place(body.workstreamId);
    const children = workstreams.filter(
      (t) => t.parentId === body.workstreamId,
    );
    const exists = (name: string) =>
      children.some(
        (child) =>
          normalize(child.name) === normalize(name) ||
          (child.aliases ?? []).some(
            (alias) => normalize(alias) === normalize(name),
          ),
      );
    return {
      op: body.repair ? "repair" : "split",
      moves: body.workstreams.flatMap((workstream) => {
        const to = [
          ...group,
          { name: workstream.name, created: !exists(workstream.name) },
        ];
        // A thread that left the workstream since moves from where it is now,
        // and a gone one drops out; the suggestion's problem says so.
        const moves = new Map<string | null, ChangeMove>();
        for (const id of workstream.threadIds) {
          if (!(id in threadWorkstream)) continue;
          const workstream = threadWorkstream[id] ?? null;
          const move = moves.get(workstream);
          moves.set(workstream, {
            from: move?.from ?? (workstream ? place(workstream) : null),
            to,
            threads: [...(move?.threads ?? []), thread(id)],
            carried: 0,
          });
        }
        return moves.size
          ? [...moves.values()]
          : [{ from: group, to, threads: [], carried: 0 }];
      }),
    };
  }

  switch (body.op) {
    case "move-thread": {
      const from = thread(body.thread);
      const workstream = threadWorkstream[body.thread];
      return {
        op: "move-thread",
        moves: [
          {
            from: workstream ? place(workstream) : null,
            to: place(body.workstream),
            threads: [from],
            carried: 0,
          },
        ],
      };
    }
    case "merge": {
      const into = place(body.into);
      return {
        op: "merge",
        moves: [
          {
            from: place(body.from),
            to: into,
            threads: shown
              .filter(([, workstream]) => workstream === body.from)
              .map(([id]) => thread(id)),
            carried: 0,
          },
          ...workstreams
            .filter((t) => t.parentId === body.from)
            .map((t) => workstreamMove(t.id, under(into, t.id))),
        ],
      };
    }
    case "move-workstream": {
      const to = under(place(body.parent), body.workstream);
      return {
        op: "move-workstream",
        moves: [
          workstreamMove(
            body.workstream,
            body.name === undefined
              ? to
              : [...to.slice(0, -1), { ...to.at(-1)!, name: body.name }],
          ),
        ],
      };
    }
    case "rename": {
      const own = place(body.workstream);
      return {
        op: "rename",
        moves: [
          workstreamMove(body.workstream, [
            ...own.slice(0, -1),
            { ...own.at(-1)!, name: body.name },
          ]),
        ],
      };
    }
    case "group": {
      const created = [
        ...place(body.parent),
        { name: body.name, created: true },
      ];
      return {
        op: "group",
        moves: body.children.length
          ? body.children.map((child) =>
              workstreamMove(child, under(created, child)),
            )
          : [{ from: null, to: created, threads: [], carried: 0 }],
      };
    }
  }
}

const placeText = (place: WorkstreamPlace) =>
  place.length === 0
    ? "Top level"
    : place
        .map((part) => `${part.name}${part.created ? " (new)" : ""}`)
        .join(" › ");

/**
 * Plain lines for the CLI: each move as "from → to", its threads indented
 * below it.
 */
export function changeLines(change: SuggestionChange): string[] {
  return change.moves.flatMap((move) => [
    `${
      move.from
        ? `${placeText(move.from)} → `
        : move.threads.length
          ? "No workstream → "
          : ""
    }${placeText(move.to)}${move.carried ? ` (with ${move.carried} ${move.carried === 1 ? "thread" : "threads"})` : ""}`,
    ...move.threads.map((t) => `  “${t.title}”`),
  ]);
}

const leaf = (place: WorkstreamPlace) => place.at(-1)?.name ?? "the top level";
const list = (names: readonly string[]) => names.join(" and ");

/**
 * Names in a headline, which is one line: two read as themselves, and three
 * or more as their count. The drawing beside a headline shows every one of
 * them, and a list of five only wraps.
 */
const namedOrCounted = (all: readonly string[], noun: string) =>
  all.length > 2 ? `${all.length} ${noun}` : list(all);

/** Whether accepting moves any visible thread, by itself or with its group. */
export function movesThreads(change: SuggestionChange): boolean {
  return change.moves.some((m) => m.threads.length > 0 || m.carried > 0);
}

/**
 * What a suggestion does, as verb, subject, and destination: "Split
 * Automations into PR Upkeep and Design", "Move “Fix CI” to Evals", "Move
 * Workforest under bb". The destination is always named, so a list of
 * headlines reads as a list of changes; a spread of three or more
 * destinations is their count, as the drawing shows each one.
 */
export function changeHeadline(change: SuggestionChange): string {
  const [first] = change.moves;
  if (!first) return "Change groups";
  const threads = change.moves.flatMap((m) => m.threads);
  const group = leaf(first.to.slice(0, -1));
  const destinations = [...new Set(change.moves.map((m) => leaf(m.to)))];
  // A suggestion whose threads are gone since names no count.
  const count = threads.length ? `${threads.length} ` : "";
  switch (change.op) {
    case "move-thread":
    case "split":
    case "repair":
      if (change.op === "split" && destinations.length > 1)
        return `Split ${group} into ${namedOrCounted(destinations, "workstreams")}`;
      if (destinations.length > 1)
        return `Move ${count}${group} ${threads.length === 1 ? "thread" : "threads"} into ${namedOrCounted(destinations, "workstreams")}`;
      return threads.length === 1
        ? `Move “${threads[0]!.title}” to ${destinations[0]}`
        : `Move ${count}threads to ${destinations[0]}`;
    case "merge":
      return `Merge ${leaf(first.from ?? [])} into ${leaf(first.to)}`;
    case "move-workstream": {
      const name = leaf(first.from ?? first.to);
      const as = name === leaf(first.to) ? "" : ` as ${leaf(first.to)}`;
      return first.to.length > 1
        ? `Move ${name} into ${group}${as}`
        : `Move ${name} out of its group${as}`;
    }
    case "rename":
      return `Rename ${leaf(first.from ?? [])} to ${leaf(first.to)}`;
    case "group":
      return first.from
        ? `Group ${namedOrCounted(
            change.moves.map((m) => leaf(m.to)),
            "workstreams",
          )} under a new ${group}`
        : `Create ${leaf(first.to)}${first.to.length > 1 ? ` in ${group}` : ""}`;
  }
}
