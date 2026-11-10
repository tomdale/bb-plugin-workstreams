import {
  useLayoutEffect,
  useRef,
  type AnimationEvent,
  type CSSProperties,
} from "react";
import { Icon } from "@/components/ui/icon";
import { dotMark, type SlotMark } from "../../domain/presentation.ts";
import { colorCss, trackCss, type SpinnerStyle } from "../../domain/spinner.ts";
import { useSpinner } from "../spinner.ts";

/**
 * Heroicons' exclamation-circle (20/solid, MIT): its bang fills the
 * silhouette and stays legible at 13px, where a triangle's cutout doesn't.
 */
const FAILED_PATH =
  "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z";

/**
 * The mark in a thread row's leading slot (see `slotMarkFor`): an
 * exclamation circle for a failed turn, a spinner for work in flight (grey
 * while the agent waits on a subagent or timer), a dot for the states that
 * wait on the reader (`dotMark`), or a pencil for an unsent draft.
 */
export function StatusMark({
  mark,
  isUnread = false,
}: {
  mark: SlotMark;
  /** The dots draw solid while unread, a ring once read. */
  isUnread?: boolean;
}) {
  const aria =
    isUnread && dotMark(mark.kind) ? `${mark.label}, unread` : mark.label;
  if (dotMark(mark.kind))
    return (
      <span
        className={`ws-dot ws-dot-${mark.kind}${isUnread ? "" : " ws-dot-ring"}`}
        role="img"
        aria-label={aria}
      />
    );
  switch (mark.kind) {
    case "error":
      return (
        <span className="ws-mark ws-failed" role="img" aria-label={aria}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fillRule="evenodd" d={FAILED_PATH} clipRule="evenodd" />
          </svg>
        </span>
      );
    case "working":
      return <WorkingMark label={aria} />;
    case "waiting":
      return <WorkingMark label={aria} waiting />;
    case "draft":
      return (
        <span className="ws-mark ws-mark-draft" role="img" aria-label={aria}>
          ✎
        </span>
      );
  }
}

/**
 * Put every CSS animation for a shape on the document timeline's zero point.
 * CSS animations otherwise use the element's insertion time as their start,
 * which makes rows mounted later visibly drift out of phase. The browser owns
 * all frame scheduling; this only adjusts Web Animations API metadata.
 */
export function synchronizeSpinnerAnimations(element: HTMLElement): void {
  if (typeof element.getAnimations !== "function") return;
  const animations = element.getAnimations({ subtree: true });
  for (const animation of animations) {
    // The shape's CSS animation is the only animation in this subtree. Keeping
    // this assignment in one place also includes animations on pseudo-elements.
    animation.startTime = 0;
  }
}

/**
 * The working indicator, in the style chosen in settings unless `spinner`
 * gives one (the settings previews). Shapes read their colors from
 * `--ws-spin-primary` and `--ws-spin-track`. Unlabeled marks are decorative:
 * the caller announces the work in text. `waiting` draws it grey: the agent
 * is idle while its subagent or timer runs.
 */
export function WorkingMark({
  label,
  spinner: shown,
  waiting = false,
}: {
  label?: string;
  spinner?: SpinnerStyle;
  waiting?: boolean;
}) {
  const chosen = useSpinner();
  const spinner = shown ?? chosen;
  const markRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (markRef.current) synchronizeSpinnerAnimations(markRef.current);
  }, [spinner.shape]);
  // Moving a node in the DOM replaces its CSS animations with new ones that
  // start at the move. The sidebar reorders rows by recency, and React moves
  // them without remounting, so the mount-time sync alone would let busy rows
  // drift apart. Every replacement fires `animationstart` (pseudo-element
  // animations fire it on their host element), so resynchronize there.
  const onAnimationStart = (event: AnimationEvent<HTMLSpanElement>) =>
    synchronizeSpinnerAnimations(event.currentTarget);
  const a11y = label
    ? { role: "img", "aria-label": label, title: label }
    : { "aria-hidden": true };
  const props = {
    ref: markRef,
    onAnimationStart,
    className: `ws-mark ws-spin ws-spin-${spinner.shape}`,
    style: (waiting
      ? {
          "--ws-spin-primary": "var(--muted-foreground)",
          "--ws-spin-track":
            "color-mix(in oklab, var(--muted-foreground) 25%, transparent)",
        }
      : {
          "--ws-spin-primary": colorCss(spinner.primary),
          "--ws-spin-track": trackCss(spinner),
        }) as CSSProperties,
    ...a11y,
  };
  if (spinner.shape === "spokes" || spinner.shape === "bold-spokes")
    return (
      <span {...props}>
        <Icon name="Loading" aria-hidden className="ws-spin-icon" />
      </span>
    );
  if (spinner.shape === "dots")
    return (
      <span {...props}>
        <i />
        <i />
        <i />
      </span>
    );
  return <span {...props} />;
}
