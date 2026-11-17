/**
 * A thread's start: one call names a new thread from its opening request and,
 * for a thread with no parent, chooses its workstream. Pure, so the server, the
 * composer's guess, its trace replays, and the eval share one prompt and
 * parser.
 *
 * The workstream choice is workstreamChoice.ts's: the same rules, tree, hints,
 * and closed set of answers. The title follows the rules a turn's end uses
 * (`TITLE_RULES`), written as an -ing verb and a subject that code joins, so
 * the form is the output's shape rather than a rule the model may drop. A child
 * thread is listed under its parent's workstream and is only named.
 */
import { z } from "zod";
import {
  composeTitle,
  excerpt,
  HEADER,
  listingBlock,
  redact,
  stripFence,
  tagged,
  TITLE_RULES,
  titleFieldSchema,
  titlePartsSchema,
  type ThreadListing,
} from "./analysis.ts";
import {
  parseChoiceFields,
  chosenPath,
  choiceFields,
  choiceKeys,
  choiceProperties,
  choiceRules,
  choiceSections,
  type WorkstreamChoiceInput,
  type WorkstreamChoiceOutput,
} from "./workstreamChoice.ts";

/** The opening request is excerpted to this much. */
const REQUEST_CHARS = 1500;

export type StartInput = {
  readonly request: string;
  readonly project: string | null;
  /**
   * What the workstream choice reads, for a thread with no parent; null names a
   * child thread only. Its `requests` and `title` are ignored: the opening
   * request is the evidence, and the thread has no title yet.
   */
  readonly choice: Omit<WorkstreamChoiceInput, "requests" | "title"> | null;
  /** Where a child thread is listed: its parent's title and workstream. */
  readonly listing?: ThreadListing | null;
};

export type StartOutput = {
  /** The opening title, or null when the request doesn't say what the work is. */
  readonly title: string | null;
  /**
   * The chosen workstream, for a thread with no parent; null for a child thread
   * or an invalid one.
   */
  readonly workstream: WorkstreamChoiceOutput | null;
  /** Why the answer's workstream was refused, when it was. */
  readonly workstreamError?: string;
};

const placementOf = (input: StartInput): WorkstreamChoiceInput | null =>
  input.choice
    ? { ...input.choice, title: null, requests: [input.request] }
    : null;

export function startPrompt(input: StartInput): string {
  const choice = placementOf(input);
  const project = input.project ? redact(input.project).slice(0, 100) : null;
  const title = `- title: the title wherever threads are listed. ${TITLE_RULES}
  ${choice ? "It is read beside the workstream you choose, so leave out that workstream's names and products. " : ""}null when the request doesn't say what the work is (a greeting, or a bare "continue" or "yes").`;
  const sections = [
    tagged("opening_request", excerpt(redact(input.request), REQUEST_CHARS)),
    ...(choice
      ? choiceSections(choice, { title: false, requests: false })
      : project
        ? [`The project the thread runs in:\n${tagged("project", project)}`]
        : []),
    !choice ? listingBlock(input.listing) : "",
  ].filter(Boolean);
  const keys = [
    '"title": {"verb": string, "subject": string}|null',
    ...(choice ? choiceKeys(choice) : []),
  ];
  return `${HEADER}

You name one new agent thread from its opening request${choice ? " and choose its workstream" : ""}, for someone who switches between dozens of threads. Work has only just begun, so name what the request asks for.
${choice ? `\n${choiceRules(choice)}\n` : ""}
${sections.join("\n\n")}

Return {${keys.join(", ")}}:
${[title, ...(choice ? choiceFields(choice) : [])].join("\n")}`;
}

/** JSON Schema constrains workstream IDs at generation as well as at parsing. */
export function startSchema(input: StartInput): Record<string, unknown> {
  const choice = placementOf(input);
  const properties: Record<string, unknown> = {
    title: titleFieldSchema,
    ...(choice ? choiceProperties(choice) : {}),
  };
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

const outputSchema = z.object({
  title: titlePartsSchema.optional().default(null),
});

/**
 * The checked answer. The title drops names its listing shows: for a thread
 * with no parent, the workstream this answer chose. An invalid workstream is
 * refused on its own (`topicError`), so it never moves a thread and the title
 * still stands.
 */
export function parseStart(text: string, input: StartInput): StartOutput {
  const raw: unknown = JSON.parse(stripFence(text));
  const choice = placementOf(input);
  let workstream: WorkstreamChoiceOutput | null = null;
  let workstreamError: string | undefined;
  if (choice)
    try {
      workstream = parseChoiceFields(raw, choice);
    } catch (error) {
      workstreamError = `Invalid workstream: ${error instanceof Error ? error.message : String(error)}`;
    }
  const listing = choice
    ? {
        workstream: workstream && chosenPath(workstream, choice.workstreams),
        parent: null,
      }
    : input.listing;
  return {
    title: composeTitle(outputSchema.parse(raw).title, listing),
    workstream,
    ...(workstreamError ? { workstreamError } : {}),
  };
}
