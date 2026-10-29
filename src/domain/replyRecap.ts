/**
 * A reply block's recap card: the fields an agent writes in a `:::reply`
 * block whose opener sets `state`, turned into the same recap input the
 * recap tool takes. The server stores it through the tool's path, so the
 * docked card, the sidebar, analysis and waiting checks read one recap.
 *
 * Reading is lenient: over-long lines are clipped and extra items dropped.
 * Only a block with no `state`, an unknown state, or no headline yields no
 * recap; the server then asks the agent for one.
 */
import {
  blockRecapInputSchema,
  clipVisible,
  RECAP_STATES,
  type RecapInput,
  type RecapState,
} from "./recap.ts";
import type { ReplyCard } from "./reply.ts";

/** Limits of the recap card, shared with the tool's schema. */
const LIMITS = {
  goal: 80,
  results: { items: 3, max: 120 },
  review: { items: 3, max: 160 },
  next: { items: 3, title: 28, message: 120 },
  links: { items: 8, title: 80 },
  waitingOn: { items: 8, task: 80 },
} as const;
/** Seconds a waiting block without a usable `timeout` waits for. */
export const DEFAULT_WAITING_TIMEOUT = 600;

export type ReplyRecapProblem = "state" | "headline" | "invalid";
export type ReplyRecapResult =
  | { ok: true; input: RecapInput }
  | { ok: false; problem: ReplyRecapProblem; error: string };

const isState = (value: string): value is RecapState =>
  (RECAP_STATES as readonly string[]).includes(value);

/** `Title: message` makes a button with a title; anything else is one string. */
function nextAction(line: string) {
  const colon = line.indexOf(": ");
  const title = colon > 0 ? line.slice(0, colon).trim() : "";
  const message = colon > 0 ? line.slice(colon + 2).trim() : "";
  if (title && message && clipVisible(title, LIMITS.next.title) === title)
    return { title, message: clipVisible(message, LIMITS.next.message) };
  return clipVisible(line, LIMITS.next.message);
}

/** `[title](location)` or a bare location; null unless the target is usable. */
function link(line: string): { title: string; location: string } | null {
  const linked = /^\[([^\]]+)\]\(<?([^)>\s]+)>?\)\s*$/.exec(line.trim());
  const location = (linked?.[2] ?? line).trim().replace(/^`|`$/g, "");
  const usable =
    location.startsWith("https://") ||
    (location.startsWith("/") && !location.startsWith("//"));
  if (!usable || /\s/.test(location)) return null;
  return {
    title: clipVisible(linked?.[1] ?? location, LIMITS.links.title),
    location,
  };
}

/** `@thread:<id> task`; null without a thread mention. */
function waitingAgent(line: string): { threadId: string; task: string } | null {
  const match = /@thread:([\w-]+)/.exec(line);
  if (!match) return null;
  const task =
    line
      .replace(match[0], "")
      .replace(/^[\s:–—-]+/, "")
      .trim() || `Agent ${match[1]}`;
  return {
    threadId: match[1]!,
    task: clipVisible(task, LIMITS.waitingOn.task),
  };
}

function timeoutSeconds(raw: string | undefined): number {
  const seconds = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(seconds) || seconds < 1) return DEFAULT_WAITING_TIMEOUT;
  return Math.min(seconds, 86400);
}

/** The recap input a reply block's card describes, or why it has none. */
export function recapInputFromCard(card: ReplyCard): ReplyRecapResult {
  const state = card.state.trim().toLowerCase();
  if (!isState(state))
    return {
      ok: false,
      problem: "state",
      error: `The block's state must be ${RECAP_STATES.join(", ")}.`,
    };
  const goal = card.headline ? clipVisible(card.headline, LIMITS.goal) : "";
  if (!goal)
    return {
      ok: false,
      problem: "headline",
      error: "The block needs a `# ` headline line.",
    };
  const results = card.results
    .slice(0, LIMITS.results.items)
    .map((item) => clipVisible(item.markdown, LIMITS.results.max))
    .filter(Boolean);
  const next = card.next
    .slice(0, LIMITS.next.items)
    .map(nextAction)
    .filter(Boolean);
  const review = card.review
    .slice(0, LIMITS.review.items)
    .map((step) => clipVisible(step, LIMITS.review.max))
    .filter(Boolean);
  let input: unknown;
  if (state === "waiting")
    input = {
      state,
      goal,
      timeout: timeoutSeconds(card.timeout),
      waitingAgents: card.waitingOn
        .map(waitingAgent)
        .filter((agent) => agent !== null)
        .slice(0, LIMITS.waitingOn.items),
    };
  else if (state === "review" && review.length)
    input = {
      state,
      goal,
      latest: results,
      review,
      links: card.links
        .map(link)
        .filter((item) => item !== null)
        .slice(0, LIMITS.links.items),
      next,
    };
  // A review block with no steps reads as complete: there is nothing to review.
  else input = { state: "complete", goal, latest: results, next };
  const parsed = blockRecapInputSchema.safeParse(input);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : {
        ok: false,
        problem: "invalid",
        error:
          parsed.error.issues[0]?.message ?? "The block's card is invalid.",
      };
}
