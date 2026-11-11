/**
 * A turn's end: one call describes the thread (title, goal, digest, and the
 * turn's status when the agent didn't report it) and, after a new request to
 * a root, decides its topic. Pure, so the server, its trace replays, and the
 * eval share one prompt and parser.
 *
 * The description is Full analysis's (see analysis.ts); the topic choice is
 * placement's (see placement.ts), asked only when `placement` is supplied.
 * The digest is this call's own memory: it reads the digest it settled last
 * time and returns a revised one, so a single later request refines what the
 * thread is about instead of replacing it.
 */
import {
  fullAnalysisParts,
  fullAnalysisSchema,
  HEADER,
  parseFullAnalysisFields,
  stripFence,
  type FullAnalysisInput,
  type FullAnalysisOutput,
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

export type TurnEndInput = FullAnalysisInput & {
  /**
   * What the topic choice reads, or null when the thread's topic needs no
   * decision: a child thread, a topic you set, or no new request since it was
   * last settled. Its requests, title, and digest are already in the prompt.
   */
  readonly placement: PlacementInput | null;
};

export type TurnEndOutput = FullAnalysisOutput & {
  /** The topic the thread belongs to now; null when none was asked or valid. */
  readonly topic: PlacementOutput | null;
  /** Why the answer's topic was refused, when it was. */
  readonly topicError?: string;
};

export function turnEndPrompt(input: TurnEndInput): string {
  const { sections, keys, fields } = fullAnalysisParts(input);
  const placement = input.placement;
  return `${HEADER}

You describe one agent thread for someone who switches between dozens of them${placement ? ", and decide which topic it belongs under now" : ""}.
${
  placement
    ? `
${placementRules(placement)} The thread usually still belongs under its current topic: keep it unless the requests show its work belongs elsewhere.
`
    : ""
}
${[
  ...sections,
  ...(placement
    ? placementSections(placement, {
        title: false,
        requests: false,
        digest: false,
      })
    : []),
].join("\n\n")}

Return {${[...keys, ...(placement ? placementKeys(placement) : [])].join(", ")}}:
${[...fields, ...(placement ? placementFields(placement) : [])].join("\n")}`;
}

export function turnEndSchema(input: TurnEndInput): Record<string, unknown> {
  const base = fullAnalysisSchema(input) as {
    properties: Record<string, unknown>;
  };
  const properties = {
    ...base.properties,
    ...(input.placement ? placementProperties(input.placement) : {}),
  };
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

/**
 * The checked answer. An invalid topic is refused on its own (`topicError`),
 * so it never files the thread or clears a valid assignment, and the turn's
 * description still stands. A new title drops names its listing shows: the
 * topic this answer chose when it chose one.
 */
export function parseTurnEnd(text: string, input: TurnEndInput): TurnEndOutput {
  const raw: unknown = JSON.parse(stripFence(text));
  const placement = input.placement;
  let topic: PlacementOutput | null = null;
  let topicError: string | undefined;
  if (placement)
    try {
      topic = parsePlacementFields(raw, placement);
    } catch (error) {
      topicError = `Invalid topic: ${error instanceof Error ? error.message : String(error)}`;
    }
  const group = topic && placedGroup(topic, placement!.entities);
  const listing = group
    ? { group, parent: input.listing?.parent ?? null }
    : input.listing;
  return {
    ...parseFullAnalysisFields(raw, { ...input, listing }),
    topic,
    ...(topicError ? { topicError } : {}),
  };
}
