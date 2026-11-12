/**
 * Workstreams server entry. Organizes BB threads into workstreams (native
 * sections), records every change in the journal, and reconciles with changes
 * made elsewhere.
 */
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerCli } from "./cli.ts";
import type { ThreadListing } from "../domain/analysis.ts";
import { topicPath } from "../domain/topic-path.ts";
import { displayTitle, listActiveThreads, listSections } from "./inventory.ts";
import { registerAgentInstructions } from "./agents.ts";
import { Analyzer } from "./analyzer.ts";
import { RecapArchive } from "./archive.ts";
import { Organizer } from "./organizer.ts";
import { Categories } from "./categories.ts";
import { categoryEvidence } from "./categoryEvidence.ts";
import { topicDivisionEvidence } from "./topicDivisionEvidence.ts";
import { TopicMigration } from "./topicMigration.ts";
import { buildForest } from "../domain/tree.ts";
import { Placement } from "./placement.ts";
import { isSubstantiveRequest } from "./requests.ts";
import { withoutSubagentDeliveries } from "./requestProvenance.ts";
import { Suggestions } from "./suggestions.ts";
import { linkSuggestionTraces } from "./suggestionTrace.ts";
import { ProjectAssociations } from "./projectAssociations.ts";
import type { ProjectChoice } from "../domain/projectChoice.ts";
import { workstreamProjectConflict } from "../domain/topicProject.ts";
import { Reclassification } from "./reclassification.ts";
import { sectionMembers } from "./cleanup.ts";
import { ComposerPreview, type Preview } from "./preview.ts";
import { TopicStore, topicBasis } from "./topics.ts";
import { TopicColors } from "./topicColors.ts";
import { ComposedDrafts, type ComposedIdentity } from "./composed-drafts.ts";
import {
  topicAncestors,
  takesThreads,
  type TopicAssignment,
} from "../domain/topics.ts";
import { assignmentEvidence, threadEvidence } from "./evidence.ts";
import { rpcContract, projectChoiceSchema } from "./contract.ts";
import { hostContract } from "./inference/contract.ts";
import { openDatabase } from "./db.ts";
import { Journal } from "./journal.ts";
import { Inference } from "./model.ts";
import { QuickAnalysis, type OpeningThread } from "./quick.ts";
import { agentReport, reportedStatus } from "../domain/recap.ts";
import { loadOrder, saveOrder } from "./order.ts";
import { loadSpinner, saveSpinner } from "./spinner.ts";
import { UserError, WorkstreamService } from "./service.ts";
import type { RetitleBasis } from "../domain/titles.ts";
import { TraceStore } from "./trace.ts";
import { AgentRecaps } from "./recap.ts";
import { ChangeFeed } from "./changes.ts";
import type { StateSlice } from "../domain/changes.ts";
import { registerQuestionTool } from "./questions/tool.ts";
import { QuestionStore } from "./questions/store.ts";
import {
  loadRecapPrefs,
  recapToolSince,
  saveRecapPrefs,
} from "./recapPrefs.ts";
import {
  ThreadSnoozes,
  loadSnoozePrefs,
  saveSnoozePrefs,
  type StoredSnoozes,
} from "./snooze.ts";
import { isSnoozed, MAX_SNOOZE_MS } from "../domain/snooze.ts";
import { wakesOnEvents, type WakeEvent } from "../domain/wake.ts";
import { workView } from "../domain/status.ts";
import { SnoozeWaker } from "./snoozeWake.ts";
import { loadPrefs, savePrefs, seedPrefs } from "./prefs.ts";
import { gatewayModel, type ModelChoice } from "../domain/prefs.ts";
import { runWorker as completeWithWorker } from "./inference/worker.ts";
import { registerQueueLab } from "./queueLab.ts";
import { registerStreamDeck, type StreamDeck } from "./streamDeck.ts";

export { rpcContract } from "./contract.ts";

const RECONCILE_EVERY_MS = 60_000;
const RECONCILE_DEBOUNCE_MS = 1_500;

export default async function plugin(bb: BbPluginApi) {
  registerQueueLab(bb);
  const db = openDatabase(bb);
  seedPrefs(db);
  const journal = new Journal(db);
  // Set once everything Up Next reads from exists; it reads again on changes.
  let streamDeck: StreamDeck | null = null;
  const changes = new ChangeFeed((signal) => {
    bb.realtime.publish("changed", signal);
    streamDeck?.changed();
  });
  bb.onDispose(() => changes.dispose());
  const notify = changes.notify;
  const SNOOZES = { slices: ["snoozes"], threadIds: [] } as const;
  const ORDER = { slices: ["order"], threadIds: [] } as const;
  const snoozes = new ThreadSnoozes(db);
  const service = new WorkstreamService(
    () => bb.sdk,
    db,
    journal,
    notify,
    Date.now,
    () => loadPrefs(db).threads.autoTitle,
    () => triggerOrganizer(10),
  );
  const markUnread = async (threadIds: readonly string[]) => {
    for (const threadId of threadIds)
      await bb.sdk.threads
        .markUnread({ threadId })
        .catch((error: unknown) =>
          bb.log.warn(`Marking ${threadId} unread failed: ${String(error)}`),
        );
  };
  /** Ends snoozes a wake event ended; the threads return marked unread. */
  const wakeOnEvent = async (
    set: { id: string; at: number }[],
    event: WakeEvent,
  ) => {
    const woke = snoozes.clearSet(set);
    if (!woke.length) return;
    bb.log.info(`Woke ${woke.length} snoozed thread(s): ${event}`);
    notify(SNOOZES);
    await markUnread(woke);
  };
  // Set below, once analysis and recaps exist.
  let waker: SnoozeWaker | null = null;
  const checkWakeEvents = () =>
    waker
      ?.check()
      .catch((error: unknown) =>
        bb.log.warn(`Checking snooze wake events failed: ${String(error)}`),
      );
  /**
   * Drops snoozes that ended, against the reconciler's fresh thread list,
   * then checks wake events. A thread whose wake time came returns marked
   * unread.
   */
  const sweepSnoozes = async () => {
    // Before the first reconcile there's no inventory to judge against, and
    // every snooze would look like one on a thread that's gone.
    if (service.reconciledAt() === null) return;
    const { ended, timed } = snoozes.sweep(service.threads(), Date.now());
    if (ended.length) {
      notify(SNOOZES);
      await markUnread(timed);
    }
    await checkWakeEvents();
  };
  /** Whether any snooze waits on wake events, so turn ends are worth a look. */
  const awaitingEvents = () => Object.values(snoozes.all()).some(wakesOnEvents);

  // Set once the organizer exists; earlier triggers have nothing to start.
  let organizer: Organizer | null = null;
  const triggerOrganizer = (debounceMs = 50, inventorySince?: number) => {
    organizer?.trigger(debounceMs, inventorySince);
  };

  const currentPrefs = () => loadPrefs(db);
  const hostRpc = bb.hosts.experimental_client({ contract: hostContract });
  const analysisHost = async (): Promise<string> => {
    const connected = (await bb.sdk.hosts.list()).filter(
      (host) => host.status === "connected",
    );
    const { hostId } = currentPrefs().advanced;
    const host = hostId.trim()
      ? connected.find((h) => h.id === hostId.trim())
      : connected.length === 1
        ? connected[0]
        : undefined;
    if (!host)
      throw new Error(
        "No analysis machine: set Workstreams' Analysis machine ID to a connected machine with Pi and AI Gateway.",
      );
    return host.id;
  };
  const completeWorker = async (
    prompt: string,
    choice: ModelChoice,
    signal?: AbortSignal,
    context?: { threadId?: string },
  ) => {
    let projectId: string | undefined;
    let environmentId: string | undefined;
    if (context?.threadId) {
      const subject = await bb.sdk.threads.get({
        threadId: context.threadId,
        signal,
      });
      projectId = subject.projectId;
      environmentId = subject.environmentId ?? undefined;
    }
    if (!projectId) {
      const homeProjectId = currentPrefs().newWork.homeProjectId;
      const projects = await bb.sdk.projects.list();
      projectId =
        (homeProjectId &&
        projects.some((project) => project.id === homeProjectId)
          ? homeProjectId
          : undefined) ?? projects[0]?.id;
    }
    if (!projectId)
      throw new Error("No project is available for a Workstreams worker.");
    return completeWithWorker(
      bb.sdk,
      prompt,
      choice,
      projectId,
      environmentId,
      signal,
    );
  };
  const traces = new TraceStore(db);
  const inference = new Inference({
    complete: async (prompt, choice, signal, maxTokens, context) => {
      const direct = gatewayModel(choice);
      if (direct !== null)
        return hostRpc.call(
          "complete",
          {
            prompt,
            model: direct,
            ...(maxTokens ? { maxTokens } : {}),
            ...(context?.outputSchema
              ? { outputSchema: context.outputSchema }
              : {}),
            ...(choice.reasoningLevel
              ? { reasoningLevel: choice.reasoningLevel }
              : {}),
            ...(choice.kind === "provider"
              ? {
                  ...(choice.serviceTier
                    ? { serviceTier: choice.serviceTier }
                    : {}),
                }
              : {}),
          },
          { hostId: await analysisHost(), timeoutMs: 95_000, signal },
        );
      return completeWorker(prompt, choice, signal, context);
    },
    evaluate: async ({ state, questions, model }, signal) =>
      hostRpc.call(
        "evaluate",
        { state, questions, model },
        { hostId: await analysisHost(), timeoutMs: 25_000, signal },
      ),
    traces,
    record: async () => currentPrefs().advanced.debugRecord,
    log: (message) => bb.log.warn(message),
  });
  // Retention also applies while recording is off and nothing new arrives.
  traces.prune({ force: true });
  /**
   * Gives a thread its goal as its title, when the retitle policy and the
   * `autoTitle` preference allow it (`service.retitle`), and records the
   * outcome on the call's trace.
   */
  const applyGoal = async (
    threadId: string,
    goal: string,
    revision: number,
    traceId: string | null | undefined,
    basis: RetitleBasis,
  ): Promise<void> => {
    try {
      const { entry, skipped } = await service.retitle(
        threadId,
        goal,
        revision,
        basis,
      );
      if (entry) inference.link(traceId, { kind: "entry", ref: entry.id });
      inference.annotate(traceId, {
        title: entry ? "applied" : `not applied: ${skipped}`,
      });
    } catch (error) {
      bb.log.warn(`Retitling ${threadId} failed: ${String(error)}`);
    }
  };
  const topics = new TopicStore(db);
  const topicColors = new TopicColors(db);
  const catalogWithColors = () => {
    const catalog = topics.state();
    return {
      ...catalog,
      colors: topicColors.snapshot(catalog.entities, catalog.groups),
    };
  };
  const topicMigration = new TopicMigration({ db, topics, journal });
  const projectAssociations = new ProjectAssociations({
    db,
    sdk: () => bb.sdk,
    topics,
    journal,
    exclusive: (task) => service.exclusive(task),
    // Topics' projects, and the project suggestions views list.
    onChange: () => {
      notify({ slices: ["catalog", "suggestions"] });
      triggerOrganizer(50);
    },
  });
  bb.onDispose(() => projectAssociations.dispose());
  const learnProjects = () => {
    void projectAssociations
      .reconcile()
      .catch((error: unknown) =>
        bb.log.warn(`Learning project associations failed: ${String(error)}`),
      );
  };
  const projectName = async (projectId: string): Promise<string | null> =>
    (await bb.sdk.projects.list()).find((p) => p.id === projectId)?.name ??
    null;
  /**
   * The project a debug thread starts in: the one chosen for debug threads,
   * else the home project new work starts in, else the only project there is.
   * The thread's agent reads the prompts and code the brief asks about, so a
   * project holding that source is the point of the setting.
   */
  const debugProject = async (): Promise<string> => {
    const projects = await bb.sdk.projects.list();
    const prefs = currentPrefs();
    const debugProjectId = prefs.advanced.debugProjectId.trim();
    for (const id of [debugProjectId, prefs.newWork.homeProjectId.trim()])
      if (id && projects.some((project) => project.id === id)) return id;
    if (projects.length === 1 && projects[0]) return projects[0].id;
    throw new UserError(
      debugProjectId
        ? "That project isn't one BB knows. Choose another debug threads project in Settings → Workstreams → Advanced."
        : "Choose a debug threads project in Settings → Workstreams → Advanced, so a debug thread knows where to start.",
    );
  };
  /**
   * A topic one of the analyses chose, applied under the source priority;
   * the organizer then files the thread by it.
   */
  const applyTopic = (
    threadId: string,
    answer: Parameters<TopicStore["applyAnalysis"]>[1],
    kind: "full" | "quick",
    basis: string | null,
    traceId: string | null,
  ) => {
    try {
      const revision = topics.revision();
      const changed = topics.applyAnalysis(threadId, answer, kind, basis);
      inference.annotate(traceId, {
        topic: changed ? "applied" : "not applied: the thread keeps its topic",
      });
      if (changed || topics.revision() !== revision) {
        notify({ slices: ["catalog"], threadIds: [threadId] });
        triggerOrganizer();
      }
    } catch (error) {
      bb.log.warn(`Applying a topic to ${threadId} failed: ${String(error)}`);
    }
  };
  const placement = new Placement({
    sdk: () => bb.sdk,
    db,
    inference,
    model: async () => currentPrefs().analysis.placementModel,
    // With the gate on, a confident typed answer settles the topic without
    // the placement call; anything else falls back to that call.
    gate: () =>
      currentPrefs().analysis.placementGate
        ? currentPrefs().analysis.placementGateModel
        : null,
    topics,
    project: projectName,
    // Only a new request re-places a thread: topic edits and model changes
    // leave settled topics alone.
    basisOf: (requests, project) => topicBasis({ requests, project }),
    apply: (threadId, answer, basis, traceId) =>
      applyTopic(threadId, answer, "full", basis, traceId),
    log: (message) => bb.log.warn(message),
  });
  /**
   * Where a thread is listed, for naming it beside that: its root's topic
   * path, and its parent's title when it is a child.
   */
  const listingOf = (thread: {
    id: string;
    parentThreadId?: string | null;
  }): ThreadListing => {
    const byId = new Map(service.threads().map((t) => [t.id, t]));
    const parentId =
      thread.parentThreadId ?? byId.get(thread.id)?.parentThreadId ?? null;
    let root = thread.id;
    const seen = new Set([thread.id]);
    for (
      let at = parentId;
      at && !seen.has(at);
      at = byId.get(at)?.parentThreadId ?? null
    ) {
      seen.add(at);
      root = at;
    }
    const entityId = topics.assignment(root).entityId;
    const parent = parentId ? byId.get(parentId) : undefined;
    return {
      group: entityId ? topicPath(entityId, topics.list()) : null,
      parent: parent ? displayTitle(parent) : null,
    };
  };
  // Set below; the analyzer reads recaps only once events start.
  let recaps: AgentRecaps;
  const analyzer = new Analyzer({
    sdk: () => bb.sdk,
    db,
    model: async () => currentPrefs().analysis.fullModel,
    inference,
    report: (threadId) => {
      const recap = recaps.get(threadId)?.recap;
      return recap
        ? { report: agentReport(recap), status: reportedStatus(recap) }
        : null;
    },
    topics: {
      entities: () => topics.list(),
      assignment: (threadId) => topics.assignment(threadId),
      project: projectName,
      apply: (threadId, answer, basis, traceId) =>
        applyTopic(threadId, answer, "full", basis, traceId),
    },
    placement,
    listing: listingOf,
    onChange: (threadId) =>
      notify({ slices: ["analysis"], threadIds: [threadId] }),
    onResult: (threadId, result) => {
      // A finished analysis can change whether the thread counts as done,
      // and settle how a snoozed thread's turn ended.
      triggerOrganizer();
      if (awaitingEvents()) void checkWakeEvents();
      if (result.goal)
        void applyGoal(
          threadId,
          result.goal,
          result.revision,
          result.traceId,
          "analysis",
        );
    },
    log: (message) => bb.log.warn(message),
    info: (message) => bb.log.info(message),
  });
  const quick = new QuickAnalysis({
    sdk: () => bb.sdk,
    db,
    inference,
    model: async () => currentPrefs().analysis.quickModel,
    enabled: () => currentPrefs().threads.autoTitle,
    analyzed: (threadId) => analyzer.get(threadId) !== undefined,
    apply: (threadId, goal, revision, traceId) =>
      applyGoal(threadId, goal, revision, traceId, "opening"),
    listing: listingOf,
    log: (message) => bb.log.warn(message),
  });
  bb.onDispose(() => quick.dispose());
  bb.onDispose(() => analyzer.dispose());
  bb.onDispose(() => placement.dispose());
  recaps = new AgentRecaps({
    bb,
    db,
    prefs: () => loadRecapPrefs(db),
    since: () => recapToolSince(db),
    onChange: (threadId) => {
      notify({ slices: ["recaps"], threadIds: [threadId] });
      // A reported or cleared recap can change whether the thread is done.
      triggerOrganizer(200);
      if (awaitingEvents()) void checkWakeEvents();
    },
  });
  recapToolSince(db);
  recaps.register();
  bb.onDispose(() => recaps.dispose());
  waker = new SnoozeWaker({
    db,
    snoozes,
    prefs: () => loadSnoozePrefs(db),
    threads: () => service.threads(),
    inventoryAt: () => service.reconciledAt(),
    workOf: () => {
      const analyzed = analyzer.all();
      const reported = recaps.all();
      return (thread) => {
        const work = workView(thread, analyzed[thread.id], reported[thread.id]);
        return work.kind === "current" ? work.analysis.state : null;
      };
    },
    pullRequest: async (environmentId) => {
      try {
        const result = await bb.sdk.environments.pullRequest({
          environmentId,
        });
        if (result.outcome === "available") return result.pullRequest.attention;
        return result.outcome === "absent" ? null : undefined;
      } catch {
        return undefined;
      }
    },
    wake: wakeOnEvent,
    now: Date.now,
  });
  const archives = new RecapArchive({
    sdk: () => bb.sdk,
    recaps,
    analyzer,
    onChange: notify,
  });
  const questions = new QuestionStore(db, bb);
  registerQuestionTool(bb, questions);
  registerAgentInstructions(bb, recaps);
  const categories: Categories = new Categories({
    db,
    collections: () => {
      const entities = topics.list();
      const analysis = analyzer.all();
      const snoozed = snoozes.all();
      const now = Date.now();
      const roots = buildForest(service.threads())
        .roots.map((root) => root.thread)
        .filter(
          (root) =>
            !root.isHidden &&
            !root.isArchived &&
            !isSnoozed(snoozed[root.id], now),
        );
      const assignments = topics.assignmentsOf(roots.map((root) => root.id));
      return entities
        .filter(
          (topic) =>
            takesThreads(topic.id, entities) &&
            topicAncestors(topic.id, entities).length <= 2,
        )
        .map((topic) => ({
          topicId: topic.id,
          label: topicPath(topic.id, entities),
          roots: roots
            .filter((root) => assignments.get(root.id)?.entityId === topic.id)
            .map((root) => ({
              id: root.id,
              title: root.title,
              work: analysis[root.id]?.threadGoal ?? "",
              workKey: analysis[root.id]?.requestsKey ?? "",
            })),
        }));
    },
    classify: async (input, signal) =>
      (
        await inference.run(
          "categories",
          await categoryEvidence(bb.sdk, input, signal, (id, basis) =>
            categories.pendingRequest(id, basis),
          ),
          {
            model: currentPrefs().organize.tidyModel,
            label: input.label,
            signal,
            links: input.roots.map((root) => ({
              kind: "thread" as const,
              ref: root.id,
            })),
          },
        )
      ).value,
    changed: (topicId, reason) => {
      const label = topics.getById(topicId)
        ? topicPath(topicId, topics.list())
        : topicId;
      const current = categories.generations()[topicId];
      const titles = new Map(
        service.threads().map((thread) => [thread.id, thread.title]),
      );
      journal.add({
        action: "categories",
        source: "auto",
        rationale: reason,
        threads: [],
        workstreams: [...topics.groups()]
          .filter(([, id]) => id === topicId)
          .map(([id]) => ({ id, name: label })),
        undo: null,
        detail: `${label}\n${current ? current.categories.map((category) => `${category.name}: ${category.threadIds.map((id) => titles.get(id) ?? id).join(", ")}`).join("\n") : "No active categories"}`,
      });
      notify({ slices: ["catalog"] });
    },
    log: (message) => bb.log.warn(message),
  });
  bb.onDispose(() => categories.dispose());
  const organizerInstance = new Organizer({
    sdk: () => bb.sdk,
    db,
    service,
    topics,
    analyzer,
    recap: (threadId) => recaps.get(threadId)?.recap,
    members: (sectionId) => sectionMembers(bb.sdk, sectionId),
    journal,
    // A pass writes its layout and status; the organization view re-reads its
    // own state for a change that names no threads.
    onChange: () => notify({ slices: ["catalog"] }),
    onPass: (rebuild) => {
      void categories
        .reconcile(rebuild)
        .catch((error) =>
          bb.log.warn(`Categorizing collections failed: ${String(error)}`),
        );
      if (rebuild) suggestions.check();
      else suggestions.checkIfChanged();
      learnProjects();
    },
  });
  organizer = organizerInstance;
  bb.onDispose(() => organizerInstance.dispose());
  const suggestions = new Suggestions({
    db,
    inference,
    topics,
    journal,
    model: async () => currentPrefs().organize.tidyModel,
    enabled: () => currentPrefs().organize.suggestions,
    roots: () =>
      buildForest(service.threads())
        .roots.map((root) => root.thread)
        .filter((thread) => !thread.isHidden && !thread.isArchived),
    checkout: (threadId) => placement.checkoutOf(threadId),
    coordination: () => placement.coordinationWorkspaces(),
    splitThreads: (topicId) =>
      topicDivisionEvidence(bb.sdk, topics, topicId, (id) =>
        placement.checkoutOf(id),
      ),
    // Suggestion views re-read their lists for a change that names no threads.
    onChange: (topicsChanged) => {
      notify({
        slices: topicsChanged ? ["suggestions", "catalog"] : ["suggestions"],
      });
      if (topicsChanged) triggerOrganizer(10);
    },
    log: (message) => bb.log.warn(message),
  });
  bb.onDispose(() => suggestions.dispose());
  // Suggestions stored before they kept their call get the one behind them, so
  // the debug UI works on what is already waiting.
  const linked = linkSuggestionTraces(db, traces);
  if (linked) bb.log.info(`Linked ${linked} suggestion(s) to their model call`);
  const reclassification = new Reclassification({
    db,
    sdk: () => bb.sdk,
    topics,
    analyzer,
    onChange: (row) => {
      try {
        journal.add({
          action: "batch",
          source: "user",
          rationale: "Applied reviewed topic repair",
          threads: [{ id: row.threadId, name: row.title }],
          workstreams: [],
          undo: null,
          detail: `${row.from ?? "Unfiled"} → ${row.to ?? "Unfiled"}`,
        });
        inference.annotate(row.traceId, {
          topic: "applied from reviewed preview",
        });
      } finally {
        notify();
        triggerOrganizer();
      }
    },
  });
  const previewer = new ComposerPreview({
    sdk: () => bb.sdk,
    topics,
    inference,
    model: async () => currentPrefs().analysis.quickModel,
  });
  // The topic the New thread composer showed, for threads a plain Enter
  // creates without the composer's submit data.
  const drafts = new ComposedDrafts();
  const journaledStarts = new Set<string>();
  /**
   * Gives a composed thread the topic its composer showed: one you picked,
   * the topic of the workstream whose ＋ opened it, or Quick analysis's
   * preview, whose goal also titles it.
   */
  const fileComposedIdentity = (
    thread: OpeningThread,
    identity: ComposedIdentity,
  ) => {
    if (!identity) return;
    const threadId = thread.id;
    // A thread never joins a workstream whose project differs from its own,
    // whatever the composer sent; placement files it from its request instead.
    const destination = identity.sectionId
      ? topics.groups().get(identity.sectionId)
      : (identity.entityId ?? identity.proposal?.parentId);
    const conflicting = !!workstreamProjectConflict(
      destination,
      topics.list(),
      thread.projectId,
    );
    if (conflicting)
      bb.log.warn(
        `Composed thread ${threadId} not filed: its project differs from its workstream's.`,
      );
    if (conflicting && identity.provenance !== "automatic") return;
    if (identity.provenance === "inherited") {
      const topicId = identity.sectionId
        ? topics.groups().get(identity.sectionId)
        : identity.entityId;
      if (topicId && topics.inheritTopic(threadId, topicId)) {
        notify({ slices: ["catalog"], threadIds: [threadId] });
        triggerOrganizer(10);
      } else if (topicId) placement.hintStart(threadId, topicId, "workstream");
      return;
    }
    if (identity.provenance === "manual") {
      const entity = identity.proposal
        ? topics.rememberProposal(identity.proposal)
        : identity.entityId
          ? topics.getById(identity.entityId)
          : null;
      // A picked topic merged or deleted since, or one that has gained
      // subtopics, leaves the thread to placement rather than failing.
      if (identity.entityId && !entity) {
        bb.log.warn(`Composed thread ${threadId} names an unknown topic.`);
        return;
      }
      try {
        topics.assign(threadId, entity?.id ?? null, { provenance: "manual" });
      } catch (error) {
        bb.log.warn(`Composed thread ${threadId}: ${String(error)}`);
        if (entity) placement.hintStart(threadId, entity.id, "picked");
        return;
      }
      notify({ slices: ["catalog"], threadIds: [threadId] });
      triggerOrganizer(10);
      return;
    }
    // Quick analysis already ran on this text in the composer: its topic
    // files the thread until placement settles it, and its title names it.
    if (!conflicting && (identity.entityId || identity.proposal))
      applyTopic(
        threadId,
        {
          subjectId: identity.entityId ?? null,
          proposed: identity.proposal ?? null,
        },
        "quick",
        null,
        null,
      );
    if (identity.goal)
      quick.onDispatch(
        { thread, attempt: "start-turn", origin: "app", input: { text: "" } },
        identity.goal,
      );
  };
  /** The thread a new root was started from, when it was. */
  const startedFrom = (ctx: {
    thread: { sourceThreadId?: string | null };
    senderThreadId: string | null;
  }): string | null => ctx.thread.sourceThreadId ?? ctx.senderThreadId ?? null;
  // A new root gets its first topic here: inherited from the thread
  // or workstream it was started from, the one its composer showed, or Quick
  // analysis's from its first request. The hook itself always proceeds.
  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    const correction = await recaps.onDispatch(ctx);
    if (correction) return correction;
    // Sending a snoozed thread a message means you're back on it.
    if (
      ctx.initiator === "user" &&
      ctx.senderThreadId === null &&
      ctx.queuedMessages.length === 0 &&
      snoozes.clear(ctx.thread.id)
    )
      notify(SNOOZES);
    // A thread's first message has an origin; follow-ups, steers, and retries
    // don't. Queued re-attempts of a first message still count.
    const fresh =
      ctx.origin !== null &&
      ctx.attempt === "start-turn" &&
      Date.now() - ctx.thread.createdAt < 10 * 60_000;
    const substantive =
      isSubstantiveRequest(ctx.input.text) &&
      (await withoutSubagentDeliveries(bb.sdk, ctx.thread.id, [ctx.input.text]))
        .length > 0;
    if (substantive)
      void categories
        .requestChanged(ctx.thread.id, ctx.input.text)
        .catch((error) =>
          bb.log.warn(
            `Scheduling category assessment failed: ${String(error)}`,
          ),
        );
    if (!fresh) {
      // A newer request needs placement from the turn's complete context.
      if (substantive) placement.cancelFirstRequest(ctx.thread.id);
      quick.onDispatch(ctx);
      return { action: "proceed" };
    }
    const ours = ctx.experimental_submission?.pluginId === bb.pluginId;
    const data = ours
      ? (ctx.experimental_submission!.data as {
          identity?: ComposedIdentity;
          projectChoice?: unknown;
          draftKey?: unknown;
        } | null)
      : null;
    // Started by a person in BB's New thread view.
    const composed =
      ctx.origin === "app" &&
      ctx.initiator === "user" &&
      ctx.senderThreadId === null &&
      !ctx.parentThreadId;
    let identity: ComposedIdentity | undefined;
    let projectChoice: ProjectChoice | null | undefined;
    if (ours) {
      drafts.consume(ctx.input.text);
      identity = data?.identity;
      const parsed = projectChoiceSchema.safeParse(data?.projectChoice);
      if (parsed.success)
        projectChoice =
          typeof data?.draftKey === "string" && data.draftKey.length <= 500
            ? projectAssociations.draftChoice(data.draftKey, parsed.data)
            : parsed.data;
    } else if (composed) {
      const draft = drafts.claim(
        ctx.thread.id,
        ctx.input.text,
        ctx.thread.projectId,
      );
      identity = draft?.identity;
      projectChoice = draft?.projectChoice;
    }
    // Passes re-run on drains, restarts and retries; journal a start once.
    const journal = composed && !journaledStarts.has(ctx.thread.id);
    if (journal) {
      journaledStarts.add(ctx.thread.id);
      if (journaledStarts.size > 200)
        journaledStarts.delete(journaledStarts.values().next().value!);
    }
    const from = ctx.parentThreadId ? null : startedFrom(ctx);
    const independentRoot =
      !ctx.parentThreadId &&
      !from &&
      ctx.initiator === "user" &&
      ctx.senderThreadId === null;
    projectAssociations.recordChoice(
      ctx.thread,
      projectChoice ??
        (independentRoot && ctx.origin === "cli"
          ? { projectId: ctx.thread.projectId, source: "independent" }
          : null),
      independentRoot,
    );
    // Only a composer's own Quick analysis replaces the call made here.
    const preset = identity?.provenance === "automatic" && identity.goal;
    if (!preset) quick.onDispatch(ctx);
    setTimeout(() => {
      try {
        if (journal)
          service.recordCreated(ctx.thread.id, null, "user", {
            title: ctx.thread.title || "New thread",
            rationale: "Started from New thread",
          });
        else service.seeThread(ctx.thread.id, null, ctx.parentThreadId ?? null);
        if (!ctx.parentThreadId) {
          if (from && topics.inherit(ctx.thread.id, from))
            notify({ slices: ["catalog"], threadIds: [ctx.thread.id] });
          else if (from) {
            const source = topics.assignment(from).entityId;
            if (source) placement.hintStart(ctx.thread.id, source, "thread");
          }
          if (identity) fileComposedIdentity(ctx.thread, identity);
          void placement.onFirstRequest(ctx.thread, ctx.input.text);
        }
        triggerOrganizer(10);
      } catch (error: unknown) {
        bb.log.warn(`Filing a new thread failed: ${String(error)}`);
      }
    }, 0);
    return { action: "proceed" };
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reconcileSoon = (delay = RECONCILE_DEBOUNCE_MS) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const since = organizer?.revision();
      service
        .reconcile()
        .then(() => {
          analyzer.catchUp(service.threads());
          quick.sweep(service.threads());
          void sweepSnoozes();
          projectAssociations.observeActive(service.threads());
          learnProjects();
          triggerOrganizer(50, since);
        })
        .catch((error: unknown) =>
          bb.log.warn(`Reconcile failed: ${String(error)}`),
        );
    }, delay);
  };
  const interval = setInterval(() => {
    reconcileSoon(0);
    traces.prune();
  }, RECONCILE_EVERY_MS);
  bb.onDispose(() => {
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  });
  reconcileSoon(0);

  for (const event of [
    "thread.created",
    "thread.archived",
    "thread.unarchived",
    "thread.deleted",
  ] as const)
    bb.events.on(event, ({ thread }) => {
      // Hidden threads are never seen, organized, or in the client snapshot,
      // and subagent runs create and archive them constantly.
      if (thread.visibility === "hidden") return;
      // The thread joins or leaves the seen threads that scope these slices.
      notify({
        slices: ["analysis", "recaps", "catalog"],
        threadIds: [thread.id],
      });
      reconcileSoon();
      triggerOrganizer();
    });
  bb.events.on("thread.created", ({ thread }) => {
    if (thread.visibility === "hidden" || thread.archivedAt !== null) return;
    service.seeThread(
      thread.id,
      thread.sectionId ?? null,
      thread.parentThreadId ?? null,
      thread.title ?? thread.titleFallback ?? undefined,
      true,
    );
    // A fork starts with the topic of the thread it was forked from, even
    // before it is sent a message.
    if (
      !thread.parentThreadId &&
      thread.sourceThreadId &&
      topics.inherit(thread.id, thread.sourceThreadId)
    ) {
      notify({ slices: ["catalog"], threadIds: [thread.id] });
      triggerOrganizer();
    }
  });
  bb.events.on("thread.archived", ({ thread }) => {
    recaps.onArchived(thread.id);
    if (thread.pinnedAt !== null)
      void bb.sdk.threads
        .unpin({ threadId: thread.id })
        .catch((error: unknown) =>
          bb.log.warn(`Unpinning archived thread failed: ${String(error)}`),
        );
    if (snoozes.clear(thread.id)) notify(SNOOZES);
  });
  bb.events.on("interaction.pending", ({ thread, interaction }) => {
    void waker
      ?.onInteraction({
        id: thread.id,
        parentThreadId: thread.parentThreadId ?? null,
      })
      .catch((error: unknown) =>
        bb.log.warn(`Waking on a question failed: ${String(error)}`),
      );
    if (
      interaction.origin?.kind === "plugin" &&
      interaction.origin.pluginId === bb.pluginId &&
      interaction.origin.rendererId === "ask-user-question"
    )
      questions.attach(thread.id, interaction.id);
    return recaps.onInteractionPending(thread.id, interaction);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    snoozes.clear(thread.id);
    analyzer.forget(thread.id);
    quick.forget(thread.id);
    placement.forget(thread.id);
    recaps.forget(thread.id);
    service.forget(thread.id);
    topics.forget(thread.id);
    projectAssociations.forget(thread.id);
  });
  bb.events.on("thread.failed", ({ thread }) => {
    waker?.onFailed(thread.id);
    if (awaitingEvents()) reconcileSoon();
  });
  /**
   * Whether a thread's status can change a pass: only the organizer's roots
   * count, and a thread whose parent is hidden or archived is one.
   */
  const organizedRoot = (thread: {
    visibility: string;
    parentThreadId?: string | null;
  }) =>
    thread.visibility !== "hidden" &&
    (!thread.parentThreadId ||
      !service.threads().some((t) => t.id === thread.parentThreadId));
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    if (awaitingEvents()) reconcileSoon();
    if (thread.visibility === "hidden") return;
    analyzer.onIdle(thread, lastAssistantText);
    if (organizedRoot(thread)) triggerOrganizer(200);
    return recaps.onIdle(thread.id);
  });
  bb.events.on("thread.active", ({ thread }) => {
    waker?.onActive(thread.id);
    analyzer.onActive(thread.id);
    if (organizedRoot(thread)) triggerOrganizer(200);
    // Covers a thread whose first request this run didn't see dispatched.
    void quick.onRunning(thread);
  });

  const userFacing = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof UserError) throw new Error(error.message);
      throw error;
    }
  };

  // One routing preview per composer draft: a newer request aborts the one
  // before it, except an identical one, which shares the in-flight result —
  // several composer views can show the same draft and ask together.
  const previews = new Map<
    string,
    {
      prompt: string;
      pickedProjectId: string | null | undefined;
      controller: AbortController;
      result: Promise<Preview>;
    }
  >();
  const cancelPreview = (draftKey: string) => {
    const running = previews.get(draftKey);
    previews.delete(draftKey);
    running?.controller.abort(new UserError("Canceled: the draft changed."));
    return running !== undefined;
  };

  /**
   * Hands a thread's topic back to Workstreams ("Automatic") and settles it
   * now with Full analysis.
   */
  const reclassifyTask = async (input: {
    threadId: string;
  }): Promise<{ assignment: TopicAssignment }> => {
    await service.reconcile();
    const rootId = topics.findRootThread(input.threadId);
    const current = topics.assignment(rootId);
    // Whatever it is now becomes Workstreams' own, to settle afresh.
    topics.assign(rootId, current.entityId, {
      provenance: "full",
      evidence: null,
    });
    notify();
    await analyzer.analyzeNow(rootId);
    triggerOrganizer();
    return { assignment: topics.assignment(input.threadId) };
  };

  /** The slices of the client snapshot (`state`), each read on its own. */
  const readSlice = {
    analysis: () => ({ analysis: analyzer.all() }),
    recaps: () => ({
      recaps: recaps.visible(),
      dismissedRecaps: recaps.visibleDismissedIds(),
    }),
    order: () => ({ order: loadOrder(db) }),
    snoozes: () => ({
      snoozes: snoozes.all(),
      snoozePrefs: loadSnoozePrefs(db),
    }),
    catalog: () => {
      const entities = topics.list();
      const groups = Object.fromEntries(topics.groups());
      return {
        catalog: {
          entities,
          groups,
          assignments: topics.visibleAssignments(),
          revision: topics.revision(),
          colors: topicColors.snapshot(entities, groups),
          layout: organizerInstance.layout(),
          categories: categories.generations(),
        },
      };
    },
    suggestions: () => ({ pendingSuggestions: suggestions.pendingCount() }),
  } satisfies Record<StateSlice, () => object>;

  bb.rpc.register(rpcContract, {
    preview: ({ prompt, pickedProjectId, draftKey }) =>
      userFacing(async () => {
        const routed = async (signal?: AbortSignal): Promise<Preview> => {
          const prefs = currentPrefs();
          if (!prefs.newWork.suggestions)
            return {
              id: randomUUID(),
              confidence: "low",
              reason: "Suggestions are turned off.",
              subject: null,
              traceId: null,
            };
          const debug = prefs.advanced.debugUi && prefs.advanced.debugComposer;
          const notes: string[] = [];
          const started = Date.now();
          const decision = await previewer.preview(prompt, {
            pickedProjectId,
            signal,
            ...(debug ? { explain: (note: string) => notes.push(note) } : {}),
          });
          return debug
            ? {
                ...decision,
                explanation: { notes, durationMs: Date.now() - started },
              }
            : decision;
        };
        if (!draftKey) return routed();
        const running = previews.get(draftKey);
        if (
          running &&
          running.prompt === prompt &&
          running.pickedProjectId === pickedProjectId
        )
          return running.result;
        cancelPreview(draftKey);
        const controller = new AbortController();
        const result = routed(controller.signal).finally(() => {
          if (previews.get(draftKey)?.controller === controller)
            previews.delete(draftKey);
        });
        previews.set(draftKey, { prompt, pickedProjectId, controller, result });
        return result;
      }),
    previewCancel: async ({ draftKey }) => ({
      canceled: cancelPreview(draftKey),
    }),
    draftIdentity: async ({ draftKey, text, identity, projectChoice }) => {
      const choice = projectAssociations.draftChoice(draftKey, projectChoice);
      const started = drafts.report(draftKey, text, identity, choice);
      if (!started) return { filed: false };
      try {
        const thread = await bb.sdk.threads.get({ threadId: started.threadId });
        projectAssociations.recordChoice(thread, choice);
        learnProjects();
        if (!thread.parentThreadId) fileComposedIdentity(thread, identity);
        triggerOrganizer(10);
      } catch (error: unknown) {
        bb.log.warn(`Filing a composed thread failed: ${String(error)}`);
      }
      return { filed: true };
    },
    recap_get: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      const stored = recaps.get(threadId);
      const { capped, corrections } = recaps.capped(threadId);
      const recap = stored?.recap ?? null;
      // Inline Markdown can contain file links even without artifact links.
      // Visible recaps need the workspace root to resolve those destinations.
      const environment =
        recap && !stored?.dismissed && thread.environmentId
          ? await bb.sdk.environments
              .get({ environmentId: thread.environmentId })
              .catch(() => null)
          : null;
      return {
        recap,
        dismissed: stored?.dismissed ?? false,
        waitingCancelled: stored?.waitingCancelled ?? false,
        capped: capped && thread.status === "idle",
        corrections,
        assignment: topics.assignment(threadId),
        files: thread.environmentId
          ? {
              environmentId: thread.environmentId,
              root: environment?.path ?? null,
              hostId: environment?.hostId ?? null,
            }
          : null,
      };
    },
    question_at: ({ threadId, interactionId }) =>
      questions.atInteraction(threadId, interactionId),
    question_pending: ({ threadId }) => questions.pending(threadId),
    question_answer: async ({ threadId, id, value, dismiss }) => {
      await questions.answer(threadId, id, value, dismiss);
      return { ok: true as const };
    },
    question_recover: async ({ threadId, id, value, dismiss }) => {
      await questions.recover(threadId, id, value, dismiss);
      return { ok: true as const };
    },
    reportClient: async ({ messageBlocks }) => {
      recaps.reportClient({ messageBlocks });
      return { ok: true as const };
    },
    recap_dismiss: ({ threadId, recapId }) =>
      userFacing(async () => {
        recaps.dismiss(threadId, recapId);
        return { ok: true as const };
      }),
    recap_restore: ({ threadId, recapId }) =>
      userFacing(async () => {
        recaps.restore(threadId, recapId);
        return { ok: true as const };
      }),
    recap_send: ({ threadId, recapId, action }) =>
      userFacing(async () => {
        await recaps.sendNext(threadId, recapId, action);
        return { ok: true as const };
      }),
    recap_agents: async ({ threadIds }) => {
      const threads = await Promise.all(
        threadIds.map((threadId) =>
          bb.sdk.threads.get({ threadId }).catch(() => null),
        ),
      );
      return {
        agents: threads.flatMap((thread) =>
          thread
            ? [
                {
                  threadId: thread.id,
                  projectId: thread.projectId,
                  title:
                    thread.title ??
                    thread.titleFallback ??
                    `Thread ${thread.id.slice(-6)}`,
                  status: thread.status,
                  runtimeStatus: thread.runtime?.displayStatus ?? thread.status,
                  hasPendingInteraction: Boolean(
                    (thread as { hasPendingInteraction?: boolean })
                      .hasPendingInteraction,
                  ),
                  isArchived: thread.archivedAt !== null,
                },
              ]
            : [],
        ),
      };
    },
    reclassificationPreview: async ({ threadIds }) =>
      reclassification.preview(threadIds),
    reclassificationApply: async ({ planId }) => reclassification.apply(planId),
    topicMigrationPreview: (input) => topicMigration.preview(input ?? {}),
    topicMigrationApply: ({ planId }) =>
      userFacing(async () => {
        const result = await service.exclusive(async () =>
          topicMigration.apply(planId),
        );
        triggerOrganizer(0);
        notify();
        return result;
      }),
    topicMigrationBackup: ({ backupId }) => topicMigration.backup(backupId),
    catalog: async () => ({
      ...catalogWithColors(),
      categories: categories.generations(),
      layout: organizerInstance.layout(),
    }),
    catalogCreate: ({ name, description, parentId, aliases }) =>
      userFacing(async () => {
        const entity = topics.create(
          name,
          description ?? "",
          parentId ?? null,
          aliases ?? [],
        );
        organizerInstance.trigger();
        notify();
        return { entity };
      }),
    catalogRename: ({ entityId, name }) =>
      userFacing(async () => {
        const entity = topics.rename(entityId, name);
        organizerInstance.trigger();
        notify();
        return { entity };
      }),
    catalogReparent: ({ entityId, parentId }) =>
      userFacing(async () => {
        const entity = topics.reparent(entityId, parentId);
        organizerInstance.trigger();
        notify();
        return { entity };
      }),
    projectSuggestions: async () => ({
      suggestions: projectAssociations.state(),
    }),
    projectSuggestionDecide: ({ id, decision }) =>
      userFacing(async () => ({
        entry: await projectAssociations.decide(id, decision),
      })),
    catalogUpdateMetadata: ({
      entityId,
      description,
      aliases,
      projectId,
      projectAutomatic,
    }) =>
      userFacing(async () => {
        const projects = projectId ? await bb.sdk.projects.list({}) : undefined;
        if (projectId && !projects!.some((project) => project.id === projectId))
          throw new Error("Choose an existing BB project.");
        const entity = projectAssociations.updateMetadata(
          entityId,
          {
            description,
            aliases,
            projectId,
            projectAutomatic,
          },
          projects,
        );
        organizerInstance.trigger();
        notify();
        return { entity };
      }),
    catalogMerge: ({ sourceEntityId, targetEntityId }) =>
      userFacing(async () => {
        const target = topics.merge(sourceEntityId, targetEntityId);
        organizerInstance.trigger();
        notify();
        return { target };
      }),
    taskMove: ({ threadId, entityId }) =>
      userFacing(async () => {
        await service.reconcile();
        if (topics.findRootThread(threadId) !== threadId)
          throw new Error("Move the root thread; its delegates follow it.");
        const definition = topics.definitionKey();
        const preview = await analyzer.previewTopic(threadId, {
          within: entityId,
        });
        const live = await bb.sdk.threads.get({ threadId });
        const project = await projectName(live.projectId);
        if (
          definition !== topics.definitionKey() ||
          threadEvidence(live) !== preview.evidence ||
          assignmentEvidence(topics.assignment(threadId)) !==
            preview.assignmentKey ||
          project !== preview.projectHint
        )
          throw new Error(
            "The thread or topics changed while choosing its topic. Drop it again.",
          );
        const chosen = preview.answer.subjectId;
        const entities = topics.list();
        if (
          !chosen ||
          !takesThreads(chosen, entities) ||
          !topicAncestors(chosen, entities).includes(entityId)
        )
          throw new Error(
            "No topic was chosen within the destination. The thread has not moved.",
          );
        const assignment = topics.assign(threadId, chosen, {
          provenance: "manual",
        });
        journal.add({
          action: "batch",
          source: "user",
          rationale: "Moved thread to chosen workstream",
          threads: [{ id: threadId, name: preview.title }],
          workstreams: [],
          undo: null,
          detail: `${preview.from ?? "Unfiled"} → ${assignment.label}`,
        });
        inference.annotate(preview.traceId, {
          topic: "applied within the user's destination group",
          application: "applied",
        });
        organizerInstance.trigger();
        notify();
        return { assignment };
      }),
    taskAssign: ({ threadId, entityId }) =>
      userFacing(async () => {
        await service.reconcile();
        const assignment = topics.assign(threadId, entityId, {
          provenance: "manual",
        });
        organizerInstance.trigger();
        notify();
        return { assignment };
      }),
    taskReclassify: ({ threadId }) =>
      userFacing(async () => reclassifyTask({ threadId })),
    state: async () => ({
      changes: changes.stamp(),
      ...readSlice.analysis(),
      ...readSlice.recaps(),
      ...readSlice.order(),
      ...readSlice.snoozes(),
      ...readSlice.catalog(),
      ...readSlice.suggestions(),
    }),
    stateSlices: async ({ slices }) =>
      Object.assign(
        { changes: changes.stamp() },
        ...[...new Set(slices)].map((slice) => readSlice[slice]()),
      ),
    setSnoozePrefs: ({ patch }) =>
      userFacing(async () => {
        const prefs = saveSnoozePrefs(db, patch);
        notify(SNOOZES);
        return { prefs };
      }),
    snooze: ({ threadIds, until, events }) =>
      userFacing(async () => {
        const now = Date.now();
        if (until !== null && until <= now)
          throw new UserError("Pick a time in the future.");
        if (until !== null && until > now + MAX_SNOOZE_MS)
          throw new UserError("Pick a time in the next year.");
        // A batch comes from a sidebar row, which can list a thread that was
        // archived or deleted a moment ago; that one is left out.
        const threads = await Promise.all(
          [...new Set(threadIds)].map((threadId) =>
            bb.sdk.threads.get({ threadId }).catch(() => null),
          ),
        );
        const stored: StoredSnoozes = {};
        for (const thread of threads)
          if (thread && thread.archivedAt === null)
            stored[thread.id] = {
              until,
              ...(until !== null && events ? { events: true } : {}),
              attentionAt: thread.latestAttentionAt ?? thread.updatedAt,
              at: now,
            };
        if (!Object.keys(stored).length)
          throw new UserError("Only active threads can be snoozed.");
        snoozes.set(stored);
        notify(SNOOZES);
        // Records each new snooze's pull request state right away, so a
        // change soon after counts.
        void checkWakeEvents();
        return { snoozes: stored };
      }),
    unsnooze: async ({ threadIds }) => {
      const woke = snoozes.clearAll(threadIds);
      if (woke.length) notify(SNOOZES);
      return { woke };
    },
    reorder: async (change) => {
      const order = saveOrder(db, change);
      notify(ORDER);
      return { order };
    },
    prefs: async () => ({ prefs: currentPrefs() }),
    setPrefs: async ({ patch }) => {
      const prefs = savePrefs(db, patch);
      if (patch.organize) triggerOrganizer(0);
      bb.realtime.publish("prefs", { prefs });
      notify();
      return { prefs };
    },
    machines: async () => ({
      machines: (await bb.sdk.hosts.list())
        .filter((host) => host.status === "connected")
        .map(({ id, name }) => ({ id, name })),
    }),
    recapPrefs: async () => ({ prefs: loadRecapPrefs(db) }),
    setRecapPrefs: async ({ patch }) => {
      const prefs = saveRecapPrefs(db, patch);
      recaps.prefsChanged();
      bb.realtime.publish("recapPrefs", { prefs });
      // Corrections and the card follow at once; the tool follows each
      // session's next start.
      notify();
      return { prefs };
    },
    spinner: async () => ({ spinner: loadSpinner(db) }),
    setSpinner: async ({ spinner }) => {
      const saved = saveSpinner(db, spinner);
      bb.realtime.publish("spinner", { spinner: saved });
      return { spinner: saved };
    },
    archiveStatus: ({ threadId }) => archives.status(threadId),
    archive: ({ threadId, recapId }) =>
      userFacing(() => archives.archive(threadId, recapId)),
    threadSend: async ({ threadId, text }) => {
      await bb.sdk.threads.send({
        threadId,
        mode: "queue-if-active",
        input: [{ type: "text", text, mentions: [] }],
      });
      return { ok: true as const };
    },
    threadArchive: async ({ threadId }) => {
      await bb.sdk.threads.archive({ threadId });
      return { ok: true as const };
    },
    threadUnarchive: async ({ threadId }) => {
      await bb.sdk.threads.unarchive({ threadId });
      return { ok: true as const };
    },
    streamDeckViewing: async ({ threadId }) => {
      streamDeck?.view(threadId);
      return { ok: true as const };
    },
    recapFiles: async ({ threadIds }) => {
      const read = await Promise.all(
        threadIds.map(async (threadId) => {
          const thread = await bb.sdk.threads
            .get({ threadId })
            .catch(() => null);
          if (!thread?.environmentId) return null;
          const environment = await bb.sdk.environments
            .get({ environmentId: thread.environmentId })
            .catch(() => null);
          return [
            threadId,
            {
              environmentId: thread.environmentId,
              root: environment?.path ?? null,
              hostId: environment?.hostId ?? null,
            },
          ] as const;
        }),
      );
      return {
        files: Object.fromEntries(read.filter((entry) => entry !== null)),
      };
    },
    suggestions: async () => ({ state: suggestions.state() }),
    suggestionsRun: () =>
      userFacing(async () => {
        await suggestions.run({ manual: true });
        return { state: suggestions.state() };
      }),
    suggestionsDecide: ({ ids, decision }) =>
      userFacing(async () => {
        const result = await suggestions.decide(ids, decision);
        return { ...result, state: suggestions.state() };
      }),
    suggestionsReopen: ({ id, entryId }) =>
      userFacing(async () => {
        if (entryId) await service.undo(entryId);
        suggestions.reopen(id);
        return { state: suggestions.state() };
      }),
    organization: async (input) => {
      if (input?.action === "rebuild") {
        const state = await organizerInstance.rebuild();
        return { state };
      }
      return { state: organizerInstance.state() };
    },
    threadActivity: async ({ threadId }) => {
      const entries = journal.list({
        threadId,
        external: true,
        limit: 200,
      });
      return {
        entries,
        traces: traces.list({
          link: { kind: "thread", ref: threadId },
          kinds: ["quick-analysis", "full-analysis", "placement"],
          limit: 200,
        }),
      };
    },
    journal: async (input) => {
      const entries = journal.list({
        limit: input?.limit,
        before: input?.before,
        external: input?.external,
      });
      const linked = traces.idsFor(
        "entry",
        entries.map((e) => e.id),
      );
      return {
        entries: entries.map((e) => ({
          ...e,
          traceIds: linked.get(e.id) ?? [],
        })),
      };
    },
    undo: ({ entryId }) =>
      userFacing(async () => {
        const entry = await service.undo(entryId);
        return { entry };
      }),
    refresh: async () => {
      const changed = await service.reconcile();
      await sweepSnoozes();
      return { changed };
    },
    traces: async (input) => ({ traces: traces.list(input) }),
    trace: async ({ id }) => ({ trace: traces.get(id) }),
    traceReplay: ({ id }) =>
      userFacing(async () => ({ trace: await inference.replay(id) })),
    traceClear: async () => ({ removed: traces.clear() }),
    /**
     * Starts the thread a debug brief was written for. It runs in Workstreams'
     * own project, where its agent can read the prompts and code the brief is
     * about, and starts a turn at once: the brief is the request.
     */
    debugThread: ({ title, message }) =>
      userFacing(async () => {
        const projectId = await debugProject();
        const thread = await bb.sdk.threads.spawn({
          projectId,
          environment: { type: "project-default" },
          title,
          prompt: message,
        });
        return { threadId: thread.id };
      }),
  });

  streamDeck = registerStreamDeck(bb, async () => {
    const [threads, sections] = await Promise.all([
      listActiveThreads(bb.sdk),
      listSections(bb.sdk),
    ]);
    const groups = Object.fromEntries(topics.groups());
    return {
      threads,
      sections,
      analysis: analyzer.all(),
      recaps: recaps.all(),
      order: loadOrder(db),
      snoozes: snoozes.all(),
      upNext: currentPrefs().upNext,
      groups,
      colors: topicColors.snapshot(topics.list(), groups),
      now: Date.now(),
    };
  });

  // Clients that stayed connected while the plugin restarted hold the old
  // process's snapshot; this signal's new epoch has them read all of it.
  notify();

  registerCli(bb, {
    topicMigration,
    arrangement: {
      load: () => loadOrder(db),
      setPrioritized: (ids) => {
        saveOrder(db, { kind: "prioritized", ids });
        notify(ORDER);
      },
    },
    service,
    journal,
    analyzer,
    recaps,
    organizer: organizerInstance,
    reclassification,
    traces,
    topics,
    currentPrefs,
    notify,
    reclassifyTask,
    suggestions,
  });
}
