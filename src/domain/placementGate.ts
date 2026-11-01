/**
 * Placement's confident pick: the same closed choice placement's generative
 * call makes, asked as a typed question whose answer carries a probability.
 * One trusted answer settles a root without the generative call; anything
 * else — low confidence, an unfiled answer, a thread tree the question can't
 * hold — falls back to it.
 *
 * Two judgments stay entirely with the generative call, because a typed
 * answer can't express them and measured answers are unreliable: proposing a
 * topic that does not exist yet, and detecting a scope shift. Accepting a
 * pick therefore files an existing topic with `scopeShift: false`, which is
 * what placement does on a thread whose requests never moved its owner.
 *
 * Pure, so the server and its tests share one question and parser.
 */
import { excerpt, redact, tagged } from "./analysis.ts";
import {
  choosableTopics,
  placementIds,
  type PlacementInput,
  type PlacementOutput,
} from "./placement.ts";
import { topicAncestors } from "./topics.ts";

/**
 * A pick below this is not trusted. The eval's wrong picks sat at 0.71-0.80,
 * and its proposal-shaped cases were answered confidently wrong at 0.92-1.00,
 * so the bar sits above both: at 0.95 `openai/gpt-6-luna-decisions` admitted
 * no wrong answer on any of the eval's 24 cases.
 */
export const PLACEMENT_GATE_CONFIDENCE = 0.95;

/** Choice questions accept at most this many options. */
const OPTIONS_MAX = 255;
const DESCRIPTION_CHARS = 200;

/** An answer without which the call settles nothing. */
export const NO_TOPIC = "no-topic";

/**
 * The question placement's generative call would be asked, in the typed form a
 * decision model answers, or null when the tree can't be asked this way: the
 * pick is only meaningful when several topics could hold the thread.
 */
export function placementGateQuestion(
  input: PlacementInput,
): { state: string; questions: Record<string, unknown> } | null {
  const ids = placementIds(input.entities);
  const byId = new Map(input.entities.map((entity) => [entity.id, entity]));
  const allowed = choosableTopics(input);
  /** A topic's path from its root, which tells two same-named topics apart. */
  const owner = (id: string) =>
    topicAncestors(id, input.entities)
      .reverse()
      .map((ancestor) => byId.get(ancestor)?.name ?? "")
      .filter(Boolean)
      .join(": ");
  const criteria: Record<string, string> = {};
  for (const [id, short] of ids) {
    if (!allowed.has(id)) continue;
    const description = excerpt(
      redact(byId.get(id)?.description ?? ""),
      DESCRIPTION_CHARS,
    );
    criteria[short] = `${owner(id)}${description ? ` — ${description}` : ""}`;
  }
  // Group moves choose an existing topic inside the destination and never
  // propose, so their question has no unfiled answer.
  const unfiled = input.within ? 0 : 1;
  if (Object.keys(criteria).length + unfiled < 2) return null;
  if (Object.keys(criteria).length > OPTIONS_MAX) return null;
  if (!input.within) criteria[NO_TOPIC] = "No listed topic covers this work";

  const state = [
    input.title
      ? `The thread's generated title:\n${tagged("title", excerpt(redact(input.title), 120))}`
      : null,
    input.project
      ? `The project it runs in:\n${tagged("project", excerpt(redact(input.project), 100))}`
      : null,
    input.checkout
      ? `Its checkout:\n${tagged("checkout", excerpt(redact(input.checkout), 200))}`
      : null,
    input.within
      ? `The destination topic it was moved into:\n${tagged("group", owner(input.within))}`
      : null,
    `Its requests, oldest first:\n${input.requests
      .map((text, index) =>
        tagged(
          index === 0 ? "opening_request" : "user_request",
          excerpt(redact(text), 1200),
        ),
      )
      .join("\n")}`,
    input.hints.length
      ? `Hints:\n${input.hints.map((hint) => tagged("hint", excerpt(redact(hint), 300))).join("\n")}`
      : null,
    input.current
      ? `Its current topic${input.current.inherited ? ", from the thread it was started from" : ""}:\n${tagged("current_topic", excerpt(redact(input.current.label), 200))}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const instructions = input.within
    ? "Choose the existing topic inside the destination that this thread's work belongs to: the most specific one whose scope genuinely covers it. A topic about a different product never fits, however close its description. A tool used only as the method for otherwise unspecified work does not make the work about that tool."
    : "Choose the topic this thread's work belongs to: the most specific listed topic whose scope genuinely covers it. A topic about a different product never fits, however close its description. A tool used only as the method for otherwise unspecified work does not make the work about that tool. Choose the unfiled answer when no listed topic covers the work, including work on a distinct lasting area the list does not name.";

  return {
    state,
    questions: {
      topic: { type: "choice", instructions, criteria },
    },
  };
}

/** One typed answer: a choice and the model's probability for it. */
export type GateAnswer = {
  readonly type?: string;
  readonly choice?: string | null;
  readonly confidence?: number | null;
  readonly probabilities?: Record<string, number> | null;
};

/**
 * The topic one confident answer settles, or null to ask the generative call.
 * The answer must name a topic that can hold threads and be trusted: an
 * unfiled answer means the generative call may still propose one.
 */
export function parsePlacementGate(
  answers: Readonly<Record<string, GateAnswer>>,
  input: PlacementInput,
): { answer: PlacementOutput; confidence: number } | null {
  const topic = answers.topic;
  const choice = topic?.choice;
  if (!choice || choice === NO_TOPIC) return null;
  const confidence =
    typeof topic?.confidence === "number"
      ? topic.confidence
      : (topic?.probabilities?.[choice] ?? null);
  if (confidence === null || confidence < PLACEMENT_GATE_CONFIDENCE)
    return null;
  const allowed = choosableTopics(input);
  const id = [...placementIds(input.entities)].find(
    ([topicId, short]) => short === choice && allowed.has(topicId),
  )?.[0];
  if (!id) return null;
  return {
    answer: { subjectId: id, proposed: null, scopeShift: false },
    confidence,
  };
}
