/**
 * A thread's start: one call names a new thread from its opening request and,
 * for a root, chooses its topic. Pure, so the server, the composer's guess,
 * its trace replays, and the eval share one prompt and parser.
 *
 * The topic choice is placement's (see placement.ts): the same rules, tree,
 * hints, and closed set of answers. The title follows the rules a turn's end
 * uses (`TITLE_RULES`), written as an -ing verb and a subject that code joins,
 * so the form is the output's shape rather than a rule the model may drop.
 * A child thread is listed under its parent's workstream and is only named.
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
  parsePlacementFields,
  placedGroup,
  placementFields,
  placementKeys,
  placementProperties,
  placementRules,
  placementSections,
  type PlacementInput,
  type PlacementOutput,
} from "./placement.ts";

/** The opening request is excerpted to this much. */
const REQUEST_CHARS = 1500;

export type StartInput = {
  readonly request: string;
  readonly project: string | null;
  /**
   * What the topic choice reads, for a root; null names a child thread only.
   * Its `requests` and `title` are ignored: the opening request is the
   * evidence, and the thread has no title yet.
   */
  readonly placement: Omit<PlacementInput, "requests" | "title"> | null;
  /** Where a child thread is listed: its parent's title and topic. */
  readonly listing?: ThreadListing | null;
};

export type StartOutput = {
  /** The opening title, or null when the request doesn't say what the work is. */
  readonly title: string | null;
  /** The chosen topic, for a root; null for a child thread. */
  readonly topic: PlacementOutput | null;
};

const placementOf = (input: StartInput): PlacementInput | null =>
  input.placement
    ? { ...input.placement, title: null, requests: [input.request] }
    : null;

export function startPrompt(input: StartInput): string {
  const placement = placementOf(input);
  const project = input.project ? redact(input.project).slice(0, 100) : null;
  const title = `- title: the title wherever threads are listed. ${TITLE_RULES}
  ${placement ? "It is read beside the topic you choose, so leave out that topic's names and products. " : ""}null when the request doesn't say what the work is (a greeting, or a bare "continue" or "yes").`;
  const sections = [
    tagged("opening_request", excerpt(redact(input.request), REQUEST_CHARS)),
    ...(placement
      ? placementSections(placement, { title: false, requests: false })
      : project
        ? [`The project the thread runs in:\n${tagged("project", project)}`]
        : []),
    !placement ? listingBlock(input.listing) : "",
  ].filter(Boolean);
  const keys = [
    '"title": {"verb": string, "subject": string}|null',
    ...(placement ? placementKeys(placement) : []),
  ];
  return `${HEADER}

You name one new agent thread from its opening request${placement ? " and file it under a topic" : ""}, for someone who switches between dozens of threads. Work has only just begun, so name what the request asks for.
${placement ? `\n${placementRules(placement)}\n` : ""}
${sections.join("\n\n")}

Return {${keys.join(", ")}}:
${[title, ...(placement ? placementFields(placement) : [])].join("\n")}`;
}

/** JSON Schema constrains topic IDs at generation as well as at parsing. */
export function startSchema(input: StartInput): Record<string, unknown> {
  const placement = placementOf(input);
  const properties: Record<string, unknown> = {
    title: titleFieldSchema,
    ...(placement ? placementProperties(placement) : {}),
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
 * The checked answer. The title drops names its listing shows: for a root,
 * the topic this answer chose. An invalid topic fails the whole answer, as a
 * placement answer does, so it never files a thread.
 */
export function parseStart(text: string, input: StartInput): StartOutput {
  const raw: unknown = JSON.parse(stripFence(text));
  const placement = placementOf(input);
  const topic = placement ? parsePlacementFields(raw, placement) : null;
  const listing = placement
    ? {
        group: topic && placedGroup(topic, placement.entities),
        parent: null,
      }
    : input.listing;
  return {
    title: composeTitle(outputSchema.parse(raw).title, listing),
    topic,
  };
}
