/**
 * The New thread composer's preview of a draft: the workstream the thread's
 * start would give it (see `domain/start.ts`), or a workstream the draft
 * mentions. It changes nothing, and it never sends the draft anywhere: the
 * composer creates the thread. Its title shows only in the composer's debug
 * disclosure. It runs on its own fast model so it can answer while you type;
 * the thread's start call asks the new-thread model again after send.
 */
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ModelChoice } from "../domain/prefs.ts";
import type { DraftWorkstreamProposal } from "../domain/workstreams.ts";
import { workstreamPath } from "../domain/workstream-path.ts";
import type { WorkstreamStore } from "./workstreams.ts";
import type { Inference } from "./model.ts";
import type { WorkstreamChoice } from "./workstreamChoice.ts";
import { UserError } from "./service.ts";

type Sdk = BbPluginApi["sdk"];

/** What a new thread from the draft would start with. */
export type Preview = {
  id: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  /** The workstream's label, for display. */
  subject: string | null;
  workstreamId?: string | null;
  proposal?: DraftWorkstreamProposal | null;
  /** The title the thread would start with. */
  title?: string | null;
  /** The debug trace of the model call behind it, if any. */
  traceId: string | null;
  /**
   * How the preview was reached, step by step, and how long it took.
   * Present only for the composer's debug disclosure.
   */
  explanation?: { notes: string[]; durationMs: number };
};

export class ComposerPreview {
  constructor(
    private readonly deps: {
      sdk: () => Sdk;
      workstreamStore: WorkstreamStore;
      workstreamChoice: Pick<WorkstreamChoice, "draft">;
      inference: Inference;
      /** The model that guesses a draft's workstream as you write. */
      model: () => Promise<ModelChoice>;
    },
  ) {}

  /**
   * The draft's preview: the workstream of a section it mentions, or the
   * start call's title and workstream.
   */
  async preview(
    prompt: string,
    options: {
      pickedProjectId?: string | null;
      explain?: (note: string) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<Preview> {
    const text = prompt.trim();
    if (!text) throw new UserError("Describe the work first.");
    const explain = options.explain ?? (() => {});
    const mentioned = this.mentionedWorkstream(text, explain);
    if (mentioned) return mentioned;
    const projects = await this.deps.sdk().projects.list();
    const project = options.pickedProjectId
      ? (projects.find((p) => p.id === options.pickedProjectId)?.name ?? null)
      : null;
    const choice = this.deps.workstreamChoice.draft(project);
    // The start call, not the workstream-only choice: writing a title first
    // makes a fast model choose the workstream more accurately, so the title
    // is asked even though the composer doesn't show it.
    const { value, traceId } = await this.deps.inference.run(
      "start",
      { request: text, project, choice },
      {
        model: await this.deps.model(),
        signal: options.signal,
        label: text.replace(/\s+/g, " "),
      },
    );
    const workstream = value.workstream;
    const label = workstream?.workstreamId
      ? workstreamPath(
          workstream.workstreamId,
          this.deps.workstreamStore.list(),
        )
      : (workstream?.proposed?.name ?? null);
    explain(
      label
        ? `The start call chose the workstream "${label}".`
        : "The start call found no clear workstream.",
    );
    return {
      id: randomUUID(),
      confidence: label ? "medium" : "low",
      reason: label
        ? "Suggested from the draft."
        : "No workstream is supported by this draft.",
      subject: label,
      workstreamId: workstream?.workstreamId ?? null,
      proposal: workstream?.proposed ?? null,
      title: value.title,
      traceId,
    };
  }

  /** The workstream of the section the draft mentions with `@section:<id>`. */
  private mentionedWorkstream(
    text: string,
    explain: (note: string) => void,
  ): Preview | null {
    const sectionId = /@section:([A-Za-z0-9_-]+)/.exec(text)?.[1];
    const workstreamId = sectionId
      ? this.deps.workstreamStore.sectionBindings().get(sectionId)
      : undefined;
    if (!workstreamId) return null;
    const label = workstreamPath(
      workstreamId,
      this.deps.workstreamStore.list(),
    );
    explain(
      `The draft mentions the workstream for "${label}", so no model was asked.`,
    );
    return {
      id: randomUUID(),
      confidence: "high",
      reason: "The draft mentions this workstream.",
      subject: label,
      workstreamId: workstreamId,
      traceId: null,
    };
  }
}
