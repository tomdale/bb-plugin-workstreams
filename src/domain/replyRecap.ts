/**
 * A reply block's recap card: the fields an agent writes in a `:::reply`
 * block whose opener sets `state`, turned into the same recap input the
 * recap tool takes. The server stores it through the tool's path, so the
 * docked card, the sidebar, analysis and waiting checks read one recap.
 *
 * Reading preserves full inline Markdown; extra items are dropped.
 * Only a block with no `state`, an unknown state, or no headline yields no
 * recap; the server then asks the agent for one.
 */
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  blockRecapInputSchema,
  linkSchema,
  RECAP_STATES,
  type RecapInput,
  type RecapState,
} from "./recap.ts";
import type { ReplyCard } from "./reply.ts";
import { normalizeRecapFileLinks } from "./recapFileLinks.ts";

const linkMarkdown = unified().use(remarkParse);

/** Item counts match the tool; block text is preserved without length limits. */
const LIMITS = {
  results: 3,
  review: 3,
  next: 3,
  links: 8,
  waitingOn: 8,
} as const;
/** Seconds a waiting block without a usable `timeout` waits for. */
export const DEFAULT_WAITING_TIMEOUT = 600;

export type ReplyRecapProblem = "state" | "headline" | "invalid";
type ReplyRecapResult =
  | { ok: true; input: RecapInput }
  | { ok: false; problem: ReplyRecapProblem; error: string };

const isState = (value: string): value is RecapState =>
  (RECAP_STATES as readonly string[]).includes(value);

/** `Title: message` makes a button with a title; anything else is one string. */
function nextAction(line: string) {
  const colon = line.indexOf(": ");
  const title = colon > 0 ? line.slice(0, colon).trim() : "";
  const message = colon > 0 ? line.slice(colon + 2).trim() : "";
  if (title && message) return { title, message };
  return line;
}

/** `[title](location)` or a bare location; null unless the target is usable. */
function link(line: string): { title: string; location: string } | null {
  const value = line.trim();
  let location = value.replace(/^`|`$/g, "");
  let title = location;
  const source = normalizeRecapFileLinks(value);
  const tree = linkMarkdown.parse(source);
  const paragraph = tree.children[0];
  const target =
    paragraph?.type === "paragraph" && paragraph.children.length === 1
      ? paragraph.children[0]
      : null;
  if (tree.children.length === 1 && target?.type === "link") {
    const start = target.children[0]?.position?.start.offset;
    const end = target.children.at(-1)?.position?.end.offset;
    title =
      start !== undefined && end !== undefined ? source.slice(start, end) : "";
    location = target.url;
    // Markdown destinations are URIs; stored local targets are literal paths.
    if (location.startsWith("/")) {
      try {
        location = decodeURIComponent(location);
      } catch {
        return null;
      }
    }
  }
  if (/[\r\n\u0000]/.test(location)) return null;
  const checked = linkSchema.shape.location.safeParse(location);
  if (!title || !checked.success) return null;
  if (checked.data.startsWith("https://") && /\s/.test(checked.data))
    return null;
  return { title, location: checked.data };
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
    task,
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
  const goal = card.headline?.trim() ?? "";
  if (!goal)
    return {
      ok: false,
      problem: "headline",
      error: "The block needs a `# ` headline line.",
    };
  const results = card.results
    .filter((item) => item.checked !== false)
    .slice(0, LIMITS.results)
    .map((item) => item.markdown)
    .filter(Boolean);
  const next = card.next.slice(0, LIMITS.next).map(nextAction).filter(Boolean);
  const review = card.review.slice(0, LIMITS.review).filter(Boolean);
  let input: unknown;
  if (state === "waiting")
    input = {
      state,
      goal,
      timeout: timeoutSeconds(card.timeout),
      waitingAgents: card.waitingOn
        .map(waitingAgent)
        .filter((agent) => agent !== null)
        .slice(0, LIMITS.waitingOn),
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
        .slice(0, LIMITS.links),
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
