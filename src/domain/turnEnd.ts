/**
 * A turn's end: one call describes the thread (title, goal, digest, and the
 * turn's status when the agent didn't report it) and, after a new request to a
 * thread with no parent, chooses its workstream. Pure, so the server, its trace
 * replays, and the eval share one prompt and parser.
 *
 * The description is the turn-end call's own (see analysis.ts); the workstream
 * choice is workstreamChoice.ts's, asked only when `choice` is supplied. The
 * digest is this call's own memory: it reads the digest it settled last time
 * and returns a revised one, so a single later request refines what the thread
 * is about instead of replacing it.
 */
import {
  descriptionParts,
  descriptionSchema,
  HEADER,
  parseDescriptionFields,
  stripFence,
  type DescriptionInput,
  type DescriptionOutput,
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

export type TurnEndInput = DescriptionInput & {
  /**
   * What the workstream choice reads, or null when the thread's workstream
   * needs no decision: a child thread, a workstream you set, or no new request
   * since it was last settled. Its requests, title, and digest are already in
   * the prompt.
   */
  readonly choice: WorkstreamChoiceInput | null;
};

export type TurnEndOutput = DescriptionOutput & {
  /** The workstream the thread belongs to now; null when none was asked or valid. */
  readonly workstream: WorkstreamChoiceOutput | null;
  /** Why the answer's workstream was refused, when it was. */
  readonly workstreamError?: string;
};

export function turnEndPrompt(input: TurnEndInput): string {
  const { sections, keys, fields } = descriptionParts(input);
  const choice = input.choice;
  return `${HEADER}

You describe one agent thread for someone who switches between dozens of them${choice ? ", and decide which workstream it belongs in now" : ""}.
${
  choice
    ? `
${choiceRules(choice)} The thread usually still belongs in its current workstream: keep it unless the requests show its work belongs elsewhere.
`
    : ""
}
${[
  ...sections,
  ...(choice
    ? choiceSections(choice, {
        title: false,
        requests: false,
        digest: false,
      })
    : []),
].join("\n\n")}

Return {${[...keys, ...(choice ? choiceKeys(choice) : [])].join(", ")}}:
${[...fields, ...(choice ? choiceFields(choice) : [])].join("\n")}`;
}

export function turnEndSchema(input: TurnEndInput): Record<string, unknown> {
  const base = descriptionSchema(input) as {
    properties: Record<string, unknown>;
  };
  const properties = {
    ...base.properties,
    ...(input.choice ? choiceProperties(input.choice) : {}),
  };
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

/**
 * The checked answer. An invalid workstream is refused on its own
 * (`topicError`), so it never moves the thread or clears a valid workstream,
 * and the turn's description still stands. A new title drops names its listing
 * shows: the workstream this answer chose when it chose one.
 */
export function parseTurnEnd(text: string, input: TurnEndInput): TurnEndOutput {
  const raw: unknown = JSON.parse(stripFence(text));
  const choice = input.choice;
  let workstream: WorkstreamChoiceOutput | null = null;
  let workstreamError: string | undefined;
  if (choice)
    try {
      workstream = parseChoiceFields(raw, choice);
    } catch (error) {
      workstreamError = `Invalid workstream: ${error instanceof Error ? error.message : String(error)}`;
    }
  const group = workstream && chosenPath(workstream, choice!.workstreams);
  const listing = group
    ? { workstream: group, parent: input.listing?.parent ?? null }
    : input.listing;
  return {
    ...parseDescriptionFields(raw, { ...input, listing }),
    workstream,
    ...(workstreamError ? { workstreamError } : {}),
  };
}
