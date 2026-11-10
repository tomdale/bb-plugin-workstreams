import { createHash, randomUUID } from "node:crypto";
import { placementRequests } from "./requests.ts";
import { z } from "zod";
import {
  categoryAction,
  categoryGenerationSchema,
  categoryCollectionKey,
  pruneCategories,
  type CategoryCollection,
  type CategoryDecision,
  type CategoryGeneration,
  type CategoryInput,
} from "../domain/categories.ts";
import { getMeta, setMeta, type Database } from "./db.ts";

const KEY = "topic_categories";
const recordSchema = z.object({
  generation: categoryGenerationSchema.nullable(),
  attempted: z.string(),
  attemptId: z.string(),
  status: z.enum(["pending", "settled"]),
  work: z.record(z.string(), z.object({ basis: z.string(), key: z.string() })),
  error: z.string().nullable(),
});
type Record = z.infer<typeof recordSchema>;

/*
 * Category state belongs to the current collection, not its thread records.
 * Reconciliation serializes calls, checks their evidence again before applying,
 * and persists attempts so unrelated events and restarts do not repeat them.
 *
 * Collections are derived once per reconcile and again only after a
 * classification call, the one await during which they can change. Every
 * decision is a function of the collections and the stored records, which
 * only this class writes, so a reconcile whose collections equal those the
 * last drain settled has nothing to do.
 */
export class Categories {
  private pending = false;
  /** The collections, serialized, that the last drain left nothing due for. */
  private settled: string | null = null;
  private running: Promise<void> | null = null;
  private controller = new AbortController();
  private requests = new Map<
    string,
    { basis: string; key: string; text: string }
  >();

  constructor(
    private readonly deps: {
      db: Database;
      /** Only leaf topics, with their visible unsnoozed roots. */
      collections: () => CategoryCollection[];
      classify: (
        input: CategoryInput,
        signal: AbortSignal,
      ) => Promise<CategoryDecision>;
      changed: (topicId: string, reason: string) => void;
      log: (message: string) => void;
    },
  ) {}

  private read(): Map<string, Record> {
    const raw = getMeta(this.deps.db, KEY);
    if (!raw) return new Map();
    try {
      const object = JSON.parse(raw) as { [key: string]: unknown };
      const records = new Map<string, Record>();
      for (const [id, value] of Object.entries(object)) {
        const parsed = recordSchema.safeParse(value);
        if (parsed.success) records.set(id, parsed.data);
      }
      return records;
    } catch {
      return new Map();
    }
  }

  private save(records: Map<string, Record>) {
    setMeta(this.deps.db, KEY, JSON.stringify(Object.fromEntries(records)));
  }

  private commit(
    records: Map<string, Record>,
    topicId: string,
    reason: string,
  ) {
    this.deps.db.transaction(() => {
      this.save(records);
      this.deps.changed(topicId, reason);
    })();
  }

  generations(): { [topicId: string]: CategoryGeneration } {
    return Object.fromEntries(
      [...this.read()].flatMap(([topicId, record]) =>
        record.generation ? [[topicId, record.generation]] : [],
      ),
    );
  }

  dispose() {
    this.controller.abort();
    this.requests.clear();
  }

  /** Dispatch precedes prompt-history persistence; retain only the in-flight text. */
  pendingRequest(threadId: string, basis: string): string | undefined {
    const request = this.requests.get(threadId);
    return request?.basis === basis ? request.text : undefined;
  }

  async requestChanged(threadId: string, text: string): Promise<void> {
    if (this.controller.signal.aborted) return;
    const request = placementRequests([text])[0];
    if (!request) return;
    const collections = this.deps.collections();
    const collection = collections.find((item) =>
      item.roots.some((root) => root.id === threadId),
    );
    if (!collection) return;
    const records = this.read();
    const previous = records.get(collection.topicId);
    if (
      categoryAction(previous?.generation ?? null, collection.roots.length) !==
      "classify"
    )
      return;
    const basis = collection.roots.find(
      (root) => root.id === threadId,
    )!.workKey;
    const key = `request:${createHash("sha256").update(request).digest("hex")}`;
    if (
      previous?.work[threadId]?.basis === basis &&
      previous.work[threadId]?.key === key
    )
      return;
    this.requests.set(threadId, { basis, key, text: request });
    records.set(collection.topicId, {
      generation: previous?.generation ?? null,
      attempted: "",
      attemptId: randomUUID(),
      status: "settled",
      error: null,
      work: { ...previous?.work, [threadId]: { basis, key } },
    });
    this.save(records);
    this.settled = null;
    return this.reconcileWith(collections);
  }

  private key(collection: CategoryCollection, record?: Record): string {
    return categoryCollectionKey({
      ...collection,
      roots: collection.roots.map((root) => ({
        ...root,
        workKey:
          record?.work[root.id]?.basis === root.workKey
            ? record.work[root.id]!.key
            : root.workKey,
      })),
    });
  }

  async reconcile(retryFailed = false): Promise<void> {
    if (this.controller.signal.aborted) return;
    const collections = this.deps.collections();
    if (
      !retryFailed &&
      !this.running &&
      this.settled === JSON.stringify(collections)
    )
      return;
    return this.reconcileWith(collections, retryFailed);
  }

  private reconcileWith(
    collections: CategoryCollection[],
    retryFailed = false,
  ): Promise<void> {
    this.synchronizeDepartures(collections);
    if (retryFailed) {
      const records = this.read();
      for (const [id, record] of records)
        if (record.error)
          records.set(id, { ...record, attempted: "", error: null });
      this.save(records);
    }
    this.pending = true;
    if (this.running) return this.running;
    this.running = this.drain(collections).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private synchronizeDepartures(current: readonly CategoryCollection[]) {
    const records = this.read();
    const collections = new Map(
      current.map((collection) => [collection.topicId, collection]),
    );
    for (const [id, record] of records) {
      const collection = collections.get(id);
      if (!collection || collection.roots.length <= 3) {
        records.delete(id);
        if (record.generation)
          this.commit(
            records,
            id,
            "Discarded categories for a collection that ended.",
          );
        else this.save(records);
      } else {
        const roots = new Map(
          collection.roots.map((root) => [root.id, root.workKey]),
        );
        const work = Object.fromEntries(
          Object.entries(record.work).filter(
            ([id, event]) => roots.get(id) === event.basis,
          ),
        );
        const pruned = record.generation
          ? pruneCategories(record.generation, collection.roots)
          : null;
        records.set(id, { ...record, work, generation: pruned });
        if (JSON.stringify(pruned) !== JSON.stringify(record.generation)) {
          records.set(id, {
            ...record,
            work,
            generation: pruned,
            attempted: "",
            attemptId: randomUUID(),
            status: "settled",
          });
          this.commit(records, id, "Removed roots that left the collection.");
        } else if (JSON.stringify(work) !== JSON.stringify(record.work))
          this.save(records);
      }
    }
    const work = new Map(
      [...this.read().values()].flatMap((record) =>
        Object.entries(record.work),
      ),
    );
    for (const [id, request] of this.requests)
      if (
        work.get(id)?.key !== request.key ||
        work.get(id)?.basis !== request.basis
      )
        this.requests.delete(id);
  }

  private async drain(initial: CategoryCollection[]) {
    let next: CategoryCollection[] | null = initial;
    while (this.pending && !this.controller.signal.aborted) {
      this.pending = false;
      const collections = next ?? this.deps.collections();
      next = null;
      const present = new Set(
        collections.map((collection) => collection.topicId),
      );
      const records = this.read();
      for (const id of records.keys()) {
        if (!present.has(id)) {
          records.delete(id);
          this.commit(records, id, "The topic no longer holds a collection.");
        }
      }
      let latest = new Map(collections.map((item) => [item.topicId, item]));
      let assessed = false;
      for (const { topicId } of collections) {
        if (this.controller.signal.aborted) return;
        const collection = latest.get(topicId);
        if (!collection) continue;
        const after = await this.update(collection);
        if (after) {
          assessed = true;
          latest = new Map(after.map((item) => [item.topicId, item]));
        }
      }
      // A collection handled before a classification call may have changed
      // during it, so only a round without calls settles the collections.
      if (assessed) this.pending = true;
      else this.settled = JSON.stringify(collections);
    }
  }

  /**
   * Brings one collection's record up to date. Returns the collections read
   * again after a classification call, or null when it made none.
   */
  private async update(
    collection: CategoryCollection,
  ): Promise<CategoryCollection[] | null> {
    const records = this.read();
    const previous = records.get(collection.topicId);
    const generation = previous?.generation ?? null;
    const action = categoryAction(generation, collection.roots.length);
    if (action === "discard") {
      if (previous) {
        records.delete(collection.topicId);
        if (generation)
          this.commit(
            records,
            collection.topicId,
            "The collection has three roots or fewer.",
          );
        else this.save(records);
      }
      return null;
    }
    if (action === "none") {
      if (previous) {
        records.delete(collection.topicId);
        this.save(records);
      }
      return null;
    }
    const current = generation
      ? pruneCategories(generation, collection.roots)
      : null;
    const key = this.key(collection, previous);
    if (previous?.attempted === key && previous.status === "settled")
      return null;
    const record: Record = {
      generation: current,
      attempted: key,
      attemptId: randomUUID(),
      status: "pending",
      work: previous?.work ?? {},
      error: null,
    };
    records.set(collection.topicId, record);
    if (generation && JSON.stringify(current) !== JSON.stringify(generation))
      this.commit(
        records,
        collection.topicId,
        "Removed roots that left the collection.",
      );
    else this.save(records);
    let collections: CategoryCollection[] | null = null;
    try {
      const answer = await this.deps.classify(
        { ...collection, current },
        this.controller.signal,
      );
      if (this.controller.signal.aborted) return null;
      collections = this.deps.collections();
      const latest = collections.find(
        (item) => item.topicId === collection.topicId,
      );
      if (
        !latest ||
        this.key(latest, this.read().get(collection.topicId)) !== key ||
        this.read().get(collection.topicId)?.attemptId !== record.attemptId
      ) {
        this.pending = true;
        return collections;
      }
      if (answer.keep) {
        const fresh = this.read();
        fresh.set(collection.topicId, { ...record, status: "settled" });
        this.save(fresh);
        return collections;
      }
      const next: CategoryGeneration = {
        id: current?.id ?? randomUUID(),
        categories: answer.categories.map((category) => ({
          ...category,
          id: category.id ?? randomUUID(),
          threadIds: [...category.threadIds].sort(),
        })),
      };
      const fresh = this.read();
      fresh.set(collection.topicId, {
        generation: next,
        attempted: key,
        attemptId: record.attemptId,
        status: "settled",
        work: record.work,
        error: null,
      });
      if (JSON.stringify(next) !== JSON.stringify(current))
        this.commit(fresh, collection.topicId, answer.reason);
      else this.save(fresh);
    } catch (error) {
      if (this.controller.signal.aborted) return null;
      const fresh = this.read();
      const message = error instanceof Error ? error.message : String(error);
      const latest = fresh.get(collection.topicId);
      if (latest?.attemptId === record.attemptId) {
        fresh.set(collection.topicId, {
          ...latest,
          status: "settled",
          error: message,
        });
        this.save(fresh);
      }
      this.deps.log(`Categorizing ${collection.label} failed: ${message}`);
    }
    return collections ?? this.deps.collections();
  }
}
