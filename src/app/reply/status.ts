/*
 * The reply's status vocabulary: every status a check or a delivery stage can
 * report, drawn as a mark, a word and a tone. Shape and word carry the meaning,
 * so no status depends on colour alone, and two different states never share a
 * word.
 */
import { CHECK } from "../recap/marks.tsx";
import type {
  ReplyComponent,
  ReplyPart,
} from "../../domain/replyComponents.ts";

export type CheckStatus = Extract<
  ReplyPart,
  { type: "checks" }
>["items"][number]["status"];
export type StageStatus = Extract<
  ReplyPart,
  { type: "delivery" }
>["stages"][number]["status"];

export type StatusShape = {
  /** The word printed beside the row, in the row's tone. */
  word: string;
  /** The stroked mark's path, in the 16-unit grid the recap card draws in. */
  path: string;
  /** A stroked ring drawn as a broken line: a state nobody has established. */
  dashed?: boolean;
  tone: string;
};

const SUCCESS = "text-(--ws-complete-text)";
const FAILURE = "text-(--ws-failure-text)";
const NEEDS_YOU = "text-(--ws-needs-you-text)";
const WAITING = "text-(--ws-waiting-text)";
const MUTED = "text-muted-foreground";

const CROSS = "M4.5 4.5 11.5 11.5 M11.5 4.5 4.5 11.5";
const DASH = "M4.5 8H11.5";
const RING = "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z";
const RING_SLASH = `${RING} M4.8 11.2 11.2 4.8`;

export const CHECK_STATUS: Record<CheckStatus, StatusShape> = {
  passed: { word: "Passed", path: CHECK, tone: SUCCESS },
  failed: { word: "Failed", path: CROSS, tone: FAILURE },
  skipped: { word: "Skipped", path: DASH, tone: MUTED },
  blocked: { word: "Blocked", path: RING_SLASH, tone: NEEDS_YOU },
  untested: { word: "Untested", path: RING, dashed: true, tone: MUTED },
};

/**
 * `not-started` is a stage nobody has reached; `blocked` is one that cannot
 * proceed, and only blocked is a warning.
 */
export const STAGE_STATUS: Record<StageStatus, StatusShape> = {
  done: { word: "Done", path: CHECK, tone: SUCCESS },
  pending: { word: "Pending", path: RING, tone: WAITING },
  blocked: { word: "Blocked", path: RING_SLASH, tone: NEEDS_YOU },
  "not-started": {
    word: "Not started",
    path: RING,
    dashed: true,
    tone: MUTED,
  },
  unknown: { word: "Unknown", path: RING, dashed: true, tone: MUTED },
};

/** A status that stops the work; a part reporting one draws its own frame in the failure tone. */
export const reportsFailure = (status: string): boolean =>
  status === "failed" || status === "blocked";

/**
 * Whether a part holds a row that failed or is blocked, including the rows of
 * a group's children, so a failure reaches the edge of whatever frames it.
 */
export function partReportsFailure(part: ReplyComponent): boolean {
  switch (part.type) {
    case "checks":
      return part.items.some((item) => reportsFailure(item.status));
    case "delivery":
      return part.stages.some((stage) => reportsFailure(stage.status));
    case "group":
      return part.children.flat().some(partReportsFailure);
    default:
      return false;
  }
}
