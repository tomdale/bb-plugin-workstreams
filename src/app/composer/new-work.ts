/**
 * The New thread composer's state: the new thread's topic, and Quick
 * analysis's preview of it while you type. The topic decides the workstream,
 * so the composer never asks for one.
 */
import type { ComposerSelection } from "@get-bb/plugin-sdk/app";
import type { ProjectChoice } from "../../domain/projectChoice.ts";
import type { Preview } from "../../server/preview.ts";
import type { ComposedIdentity } from "../../server/composed-drafts.ts";
import type { DraftSubjectProposal } from "../../domain/topics.ts";
import { routeDelay } from "./timing.ts";
import type { WorkstreamTarget } from "./preset.ts";

/**
 * The topic the field shows: one you picked, Quick analysis's preview
 * (`automatic`), or the topic of the workstream whose ＋ opened the composer
 * (`inherited`, by `sectionId`, or by topic for a shared-topic header).
 * Previews never replace a picked or inherited topic.
 */
type IdentityChoice = {
  entityId: string | null;
  proposal: DraftSubjectProposal | null;
  label: string;
  provenance: "manual" | "automatic" | "inherited";
  sectionId?: string | null;
} | null;

type NewWorkEvent = {
  id: number;
  at: number;
  kind: "classify" | "select-identity";
  status: "pending" | "ok" | "failed" | "superseded";
  durationMs: number | null;
  input: unknown;
  output: unknown;
  error: string | null;
};

const EVENT_LIMIT = 100;

export type NewWorkState = {
  text: string;
  identity: IdentityChoice;
  selection: ComposerSelection | null;
  suppliedProjectId?: string | null;
  /** Quick analysis's latest preview of the draft. */
  decision: Preview | null;
  classifying: boolean;
  error: string | null;
  errors: number;
  events: readonly NewWorkEvent[];
};

export type NewWorkViewState = Pick<
  NewWorkState,
  "identity" | "decision" | "classifying" | "error" | "errors"
>;

/** What the server files the thread with: the topic the field shows. */
export function submittedIdentity(
  state: Pick<NewWorkState, "identity" | "decision">,
): ComposedIdentity {
  const identity = state.identity;
  if (!identity) return null;
  return {
    entityId: identity.entityId,
    proposal: identity.proposal,
    provenance: identity.provenance,
    ...(identity.sectionId ? { sectionId: identity.sectionId } : {}),
    // Quick analysis's title travels with its topic, so the server doesn't
    // ask again for the same text.
    ...(identity.provenance === "automatic"
      ? { goal: state.decision?.goal ?? null }
      : {}),
  };
}

export function submittedProject(state: NewWorkState): ProjectChoice | null {
  const projectId = state.selection?.projectId;
  return projectId
    ? {
        projectId,
        source:
          projectId === state.suppliedProjectId ? "workstreams" : "independent",
      }
    : null;
}

export type NewWorkIdentityReport = {
  text: string;
  identity: ComposedIdentity;
  projectChoice: ProjectChoice | null;
};

export type NewWorkDeps = {
  route(prompt: string, pickedProjectId: string | null): Promise<Preview>;
  cancelRoute(): void;
  reportIdentity?(report: NewWorkIdentityReport): void | Promise<unknown>;
};

export function identityDisplay(
  state: Pick<NewWorkState, "identity" | "decision">,
): {
  id: string | null;
  label: string;
  auto: boolean;
  selected: boolean;
  reason: string | null;
} {
  if (state.identity)
    return {
      id: state.identity.entityId,
      label: state.identity.label,
      auto: state.identity.provenance === "automatic",
      selected: true,
      reason:
        state.identity.provenance === "automatic"
          ? (state.decision?.reason ?? null)
          : null,
    };
  return {
    id: null,
    label: "Automatic",
    auto: true,
    selected: false,
    reason: null,
  };
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** How often a preview canceled by another view's model is retried. */
const MAX_PREVIEW_RETRIES = 3;
const RETRY_DELAY_MS = 300;

/**
 * One routing model per composer draft. The host can keep several composer
 * views alive for the same draft (a hidden kept-alive view beside the
 * visible one); a model per banner would let each cancel the others'
 * previews and leave the visible chip stale. Sharing one model keeps one
 * preview pipeline per draft and one identity everywhere it shows. The last
 * release disposes it.
 */
const routingModels = new Map<string, { model: NewWork; refs: number }>();

function reportsEqual(
  a: NewWorkIdentityReport,
  b: NewWorkIdentityReport,
): boolean {
  if (
    a.text !== b.text ||
    a.projectChoice?.projectId !== b.projectChoice?.projectId ||
    a.projectChoice?.source !== b.projectChoice?.source
  )
    return false;
  const identityA = a.identity;
  const identityB = b.identity;
  if (identityA === null || identityB === null) return identityA === identityB;
  return (
    (identityA.entityId ?? null) === (identityB.entityId ?? null) &&
    identityA.provenance === identityB.provenance &&
    (identityA.sectionId ?? null) === (identityB.sectionId ?? null) &&
    (identityA.goal ?? null) === (identityB.goal ?? null) &&
    proposalsEqual(identityA.proposal, identityB.proposal)
  );
}

function proposalsEqual(
  a: DraftSubjectProposal | null | undefined,
  b: DraftSubjectProposal | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ancestorsA = a.ancestors ?? [];
  const ancestorsB = b.ancestors ?? [];
  return (
    a.name === b.name &&
    a.description === b.description &&
    (a.parentId ?? null) === (b.parentId ?? null) &&
    ancestorsA.length === ancestorsB.length &&
    ancestorsA.every(
      (ancestor, index) =>
        ancestor.name === ancestorsB[index]!.name &&
        ancestor.description === ancestorsB[index]!.description,
    )
  );
}

export function acquireRoutingModel(key: string, create: () => NewWork) {
  const existing = routingModels.get(key);
  if (existing) {
    existing.refs++;
    return existing.model;
  }
  const model = create();
  routingModels.set(key, { model, refs: 1 });
  return model;
}

export function releaseRoutingModel(key: string, model: NewWork) {
  const entry = routingModels.get(key);
  if (!entry || entry.model !== model) return;
  entry.refs--;
  if (entry.refs === 0) {
    routingModels.delete(key);
    model.dispose();
  }
}

export class NewWork {
  private state: NewWorkState;
  private viewState: NewWorkViewState;
  private listeners = new Set<() => void>();
  private viewListeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private pending = false;
  private eventIds = 0;
  private pendingReport: NewWorkIdentityReport | undefined;
  private lastReport: NewWorkIdentityReport | undefined;
  private reportQueued = false;
  private reportingDisposed = false;

  constructor(
    private deps: NewWorkDeps,
    choice?: Pick<NewWorkState, "identity" | "decision" | "suppliedProjectId">,
  ) {
    this.state = {
      text: "",
      identity: null,
      selection: null,
      decision: null,
      classifying: false,
      error: null,
      errors: 0,
      events: [],
      ...choice,
    };
    this.viewState = this.viewSnapshotFromState();
    this.queueIdentityReport();
  }

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  viewSnapshot = () => this.viewState;
  subscribeView = (listener: () => void) => {
    this.viewListeners.add(listener);
    return () => {
      this.viewListeners.delete(listener);
    };
  };

  private viewSnapshotFromState(): NewWorkViewState {
    return {
      identity: this.state.identity,
      decision: this.state.decision,
      classifying: this.state.classifying,
      error: this.state.error,
      errors: this.state.errors,
    };
  }

  private set(patch: Partial<NewWorkState>) {
    this.state = { ...this.state, ...patch };
    const viewChanged =
      this.viewState.identity !== this.state.identity ||
      this.viewState.decision !== this.state.decision ||
      this.viewState.classifying !== this.state.classifying ||
      this.viewState.error !== this.state.error ||
      this.viewState.errors !== this.state.errors;
    if (viewChanged) this.viewState = this.viewSnapshotFromState();
    this.queueIdentityReport();
    this.listeners.forEach((listener) => listener());
    if (viewChanged) this.viewListeners.forEach((listener) => listener());
  }

  private begin(
    kind: NewWorkEvent["kind"],
    input: unknown,
  ): (
    status: Exclude<NewWorkEvent["status"], "pending">,
    result?: { output?: unknown; error?: unknown },
  ) => void {
    const id = ++this.eventIds;
    const at = Date.now();
    const event: NewWorkEvent = {
      id,
      at,
      kind,
      status: "pending",
      durationMs: null,
      input,
      output: null,
      error: null,
    };
    this.set({ events: [...this.state.events, event].slice(-EVENT_LIMIT) });
    return (status, result = {}) => {
      this.set({
        events: this.state.events.map((e) =>
          e.id === id
            ? {
                ...e,
                status,
                durationMs: Date.now() - at,
                output: result.output ?? null,
                error:
                  result.error === undefined ? null : messageOf(result.error),
              }
            : e,
        ),
      });
    };
  }

  observe(text: string) {
    const trimmed = text.trim();
    if (trimmed === this.state.text) return;
    // A native Enter can clear the draft in the same event turn. Emit the last
    // nonempty report synchronously before the empty report forgets it.
    if (!trimmed) this.flushPendingIdentityReport();
    this.set({
      text: trimmed,
      error: null,
      ...(trimmed
        ? {}
        : {
            decision: null,
            identity:
              this.state.identity?.provenance === "automatic"
                ? null
                : this.state.identity,
          }),
    });
    this.schedule();
  }

  observeSelection(selection: ComposerSelection | null) {
    if (selection === this.state.selection) return;
    this.set({
      selection,
      ...(this.state.suppliedProjectId &&
      this.state.selection?.projectId === this.state.suppliedProjectId &&
      selection?.projectId !== this.state.suppliedProjectId
        ? { suppliedProjectId: null }
        : {}),
    });
  }

  supplyProject(projectId: string) {
    this.set({ suppliedProjectId: projectId });
  }

  selectIdentity(
    choice: {
      entityId?: string | null;
      proposal?: DraftSubjectProposal | null;
      label?: string;
    } | null,
    provenance: "manual" | "automatic" = "manual",
  ) {
    const nextChoice: NonNullable<IdentityChoice> = choice
      ? {
          entityId: choice.entityId ?? null,
          proposal: choice.proposal ?? null,
          label:
            choice.label ?? (choice.entityId ? choice.entityId : "No topic"),
          provenance,
        }
      : {
          entityId: null,
          proposal: null,
          label: "No topic",
          provenance,
        };
    this.begin("select-identity", {
      from: this.state.identity,
      to: nextChoice,
      provenance,
    })("ok");
    this.set({
      identity: nextChoice,
      error: null,
    });
  }

  /** Starts the thread with the topic of the workstream whose ＋ opened it. */
  /**
   * Starts with a workstream's topic, named by its section, or directly for
   * a shared-topic header, which has no section.
   */
  selectWorkstream(target: WorkstreamTarget, label: string) {
    this.begin("select-identity", {
      from: this.state.identity,
      to: { ...target, label },
      provenance: "inherited",
    })("ok");
    this.set({
      identity: {
        entityId: target.topicId ?? null,
        proposal: null,
        label,
        provenance: "inherited",
        ...(target.sectionId ? { sectionId: target.sectionId } : {}),
      },
      error: null,
    });
  }

  selectAutomaticIdentity() {
    this.begin("select-identity", {
      from: this.state.identity,
      to: "automatic",
    })("ok");
    let identity: IdentityChoice = null;
    if (this.state.decision?.subjectId) {
      identity = {
        entityId: this.state.decision.subjectId,
        proposal: null,
        label: this.state.decision.subject ?? this.state.decision.subjectId,
        provenance: "automatic",
      };
    } else if (this.state.decision?.proposal) {
      identity = {
        entityId: null,
        proposal: this.state.decision.proposal,
        label: this.state.decision.subject ?? this.state.decision.proposal.name,
        provenance: "automatic",
      };
    }
    this.set({
      identity,
      error: null,
    });
  }

  reportError(error: unknown) {
    this.set({ error: messageOf(error), errors: this.state.errors + 1 });
  }

  dispose() {
    this.flushPendingIdentityReport();
    this.reportingDisposed = true;
    this.invalidate();
  }

  private queueIdentityReport() {
    if (!this.deps.reportIdentity || this.reportingDisposed) return;
    const report = {
      text: this.state.text,
      identity: submittedIdentity(this.state),
      projectChoice: submittedProject(this.state),
    };
    if (this.pendingReport && reportsEqual(this.pendingReport, report)) return;
    if (this.lastReport && reportsEqual(this.lastReport, report)) {
      this.pendingReport = undefined;
      return;
    }
    this.pendingReport = report;
    if (this.reportQueued) return;
    this.reportQueued = true;
    // Reporting never waits for preview debounce or an earlier RPC. The single
    // pending payload coalesces only changes made before this microtask.
    queueMicrotask(() => {
      this.reportQueued = false;
      this.flushPendingIdentityReport();
    });
  }

  private flushPendingIdentityReport() {
    const report = this.pendingReport;
    if (!report) return;
    this.pendingReport = undefined;
    this.lastReport = report;
    try {
      void Promise.resolve(this.deps.reportIdentity!(report)).catch(() => {});
    } catch {
      // The submit data or automatic classification still files the thread.
    }
  }

  private invalidate() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.generation++;
    if (this.pending) this.deps.cancelRoute();
    this.pending = false;
  }

  private schedule() {
    this.invalidate();
    const text = this.state.text;
    if (!text) {
      if (this.state.classifying) this.set({ classifying: false });
      return;
    }
    this.timer = setTimeout(() => void this.classify(), routeDelay(text));
  }

  private async classify(attempt = 0) {
    this.timer = null;
    const mine = ++this.generation;
    this.pending = true;
    this.set({ classifying: true });
    const prompt = this.state.text;
    const pickedProjectId = this.state.selection?.projectId ?? null;
    const finish = this.begin("classify", { prompt, pickedProjectId });
    try {
      const decision = await this.deps.route(prompt, pickedProjectId);
      if (mine !== this.generation) {
        finish("superseded", { output: decision });
        return;
      }
      finish("ok", { output: { decision } });

      // A picked or inherited topic stays when a preview arrives.
      let nextIdentity = this.state.identity;
      if (
        !this.state.identity ||
        this.state.identity.provenance === "automatic"
      ) {
        if (decision.subjectId) {
          nextIdentity = {
            entityId: decision.subjectId,
            proposal: null,
            label: decision.subject ?? decision.subjectId,
            provenance: "automatic",
          };
        } else if (decision.proposal) {
          nextIdentity = {
            entityId: null,
            proposal: decision.proposal,
            label: decision.subject ?? decision.proposal.name,
            provenance: "automatic",
          };
        } else {
          nextIdentity = null;
        }
      }

      this.set({ decision, identity: nextIdentity });
    } catch (error) {
      finish(mine === this.generation ? "failed" : "superseded", { error });
      if (mine === this.generation) {
        console.warn("Workstreams couldn't preview the draft:", error);
        // The server runs one in-flight preview per draft; another composer
        // view's model can abort this one's. Retry a canceled preview rather
        // than leaving the field stale.
        if (
          attempt < MAX_PREVIEW_RETRIES &&
          messageOf(error).includes("Canceled")
        ) {
          this.timer = setTimeout(
            () => void this.classify(attempt + 1),
            RETRY_DELAY_MS,
          );
          return;
        }
      }
    } finally {
      if (mine === this.generation) {
        this.pending = false;
        this.set({ classifying: false });
      }
    }
  }
}
