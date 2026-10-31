import { useBbContext } from "@get-bb/plugin-sdk/app";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useGoalContext } from "./goalContext.ts";
import { usePrefs } from "./prefs.ts";
import {
  PAD_TOP,
  PHONE_QUERY,
  PINNED_PAD,
  SUBTITLE_SIZE,
  TITLE_BAR_TITLE_SIZE,
  TITLE_LINE,
  TITLE_SIZE,
  compactBlock,
  eyebrowMetrics,
  headingBackdropOpacity,
  headingHeight,
  headingOpacity,
  headingScroll,
  pinnedHeight,
  titleExitDistance,
} from "./goalHeading.ts";
import { WorkstreamIcon } from "./WorkstreamIcon.tsx";

const SCROLLER = "[data-thread-window] .thread-scrollbar";
/** BB's composer shell, which holds the recap and question cards. */
const COMPOSER = "[data-app-composer]";
/**
 * BB's sliding app surface. On a phone it translates aside to reveal the
 * sidebar and the right panel, so whatever is drawn over the thread has to
 * live inside it to travel with the pane.
 */
const INSET = '[data-sidebar="inset"]';

// The heading shares the message column's left edge and type. BB may place a
// scroll sentinel before that column, so prefer its data attribute to its position.
function messageColumn(scroller: HTMLElement): HTMLElement | null {
  const wrapper = scroller.firstElementChild;
  const column =
    wrapper?.querySelector(":scope > [data-scroll-attached]") ??
    wrapper?.firstElementChild;
  return column instanceof HTMLElement ? column : null;
}

/** Smallest title-bar gap worth drawing the heading into. */
const MIN_TITLE_BAR_WIDTH = 140;
const TITLE_BAR_GAP = 16;

/** Below this scroller width the title may wrap to a second line. */
const NARROW_PX = 560;
/**
 * Below this scroller height (a phone on its side, or a soft keyboard up) the
 * expanded heading would take too much of the timeline, so it stays compact.
 */
const SHORT_PX = 400;

type Mount = {
  scroller: HTMLElement;
  /** Parent of the heading: the column that holds the timeline messages. */
  column: HTMLElement;
  /** Body font size of the timeline, so the heading scales with the text. */
  baseFontSize: number;
  /** Zero-height sticky anchor at the top of the column. */
  root: HTMLElement;
  /** Zero-size layer over the thread pane that draws the heading text. */
  overlay: HTMLElement;
  threadId: string;
  previousScrollPaddingTop: string;
  previousScrollPaddingPriority: string;
};

function detach(mount: Mount | null): void {
  if (!mount) return;
  mount.root.remove();
  mount.overlay.remove();
  if (mount.previousScrollPaddingTop) {
    mount.scroller.style.setProperty(
      "scroll-padding-top",
      mount.previousScrollPaddingTop,
      mount.previousScrollPaddingPriority,
    );
  } else {
    mount.scroller.style.removeProperty("scroll-padding-top");
  }
}

/** Find the active thread's native message scroller as BB remounts its pane. */
function useMessageScroller(threadId: string | null): Mount | null {
  const [mount, setMount] = useState<Mount | null>(null);

  useEffect(() => {
    if (!threadId) {
      setMount(null);
      return;
    }

    let current: Mount | null = null;
    const attach = () => {
      // The composer's banners (the recap card, question cards) scroll their
      // own text with the same class; they are never the message scroller.
      const scrollers = [
        ...document.querySelectorAll<HTMLElement>(SCROLLER),
      ].filter((element) => !element.closest(COMPOSER));
      // Until the SDK exposes a pane-scoped mount point, avoid placing this
      // focused-thread heading in an ambiguous multi-pane layout.
      if (scrollers.length !== 1) {
        detach(current);
        current = null;
        setMount(null);
        return;
      }
      const scroller = scrollers[0]!;
      const column = messageColumn(scroller);
      if (!column) return;
      if (current?.column === column && current.root.parentElement === column) {
        return;
      }
      const wasAtBottom =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 24;
      const oldScrollTop = scroller.scrollTop;
      detach(current);
      setMount(null);
      const root = document.createElement("div");
      root.dataset.workstreamsStickyGoal = "";
      const columnStyle = getComputedStyle(column);
      const baseFontSize = Number.parseFloat(columnStyle.fontSize) || 14;
      // The root cancels the column's top padding so it sits exactly at the
      // scroller's top edge, and takes no height of its own: the heading is
      // drawn over the timeline from a fixed reserved gap, so collapsing and
      // expanding never reflow the messages (which would shift scroll
      // position mid-animation).
      const columnPadTop = Number.parseFloat(columnStyle.paddingTop) || 0;
      const initialHeight = headingHeight(baseFontSize, true, 1);
      root.style.marginTop = `${-columnPadTop}px`;
      root.style.marginBottom = `${initialHeight}px`;
      const overlay = document.createElement("div");
      overlay.dataset.workstreamsGoalOverlay = "";
      // Inside the sliding surface rather than the body, so the heading moves
      // with the pane. BB translates that surface to open the mobile sidebar
      // and right panel, frame by frame while a swipe is in progress, with no
      // resize or scroll event a fixed layer could follow.
      (scroller.closest<HTMLElement>(INSET) ?? document.body).append(overlay);
      const previousScrollPaddingTop =
        scroller.style.getPropertyValue("scroll-padding-top");
      const previousScrollPaddingPriority =
        scroller.style.getPropertyPriority("scroll-padding-top");
      column.prepend(root);
      const added = initialHeight - columnPadTop;
      if (wasAtBottom) scroller.scrollTop = scroller.scrollHeight;
      else scroller.scrollTop = oldScrollTop + added;
      current = {
        scroller,
        column,
        baseFontSize,
        root,
        overlay,
        threadId,
        previousScrollPaddingTop,
        previousScrollPaddingPriority,
      };
      scroller.style.scrollPaddingTop = `${initialHeight}px`;
      setMount(current);
    };

    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      detach(current);
      current = null;
      setMount(null);
    };
  }, [threadId]);

  return mount;
}

function useScrollState(scroller: HTMLElement | null): {
  fromBottom: number;
  // BB's own overflow fades appear only once content has scrolled out of view,
  // so the fade beneath the heading is on exactly when the timeline is
  // detached from its top.
  fade: boolean;
} {
  const [state, setState] = useState({ fromBottom: 0, fade: false });
  useEffect(() => {
    // A new scroller (another thread) starts expanded until it is measured.
    setState({ fromBottom: 0, fade: false });
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const range = scroller.scrollHeight - scroller.clientHeight;
        const fromBottom = Math.max(0, range - scroller.scrollTop);
        const fade = scroller.scrollTop > 1;
        setState((prev) =>
          prev.fromBottom === fromBottom && prev.fade === fade
            ? prev
            : { fromBottom, fade },
        );
      });
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [scroller]);
  return state;
}

/**
 * Where the heading text sits in each of its two places, in px from the
 * overlay's origin.
 */
type Placement = {
  /** In the timeline, at the scroller's top edge. */
  pane: { x: number; y: number; width: number };
  /** The scroller's full width, at its top edge. */
  background: { x: number; y: number; width: number };
  /** The timeline is phone-width: the title may wrap and the bar is cramped. */
  narrow: boolean;
  /** The timeline is too short to spare room for the expanded heading. */
  short: boolean;
  /** In the title bar, after the thread title; null when there is no room. */
  bar: { x: number; centerY: number; width: number } | null;
};

function measurePlacement(mount: Mount, base: number): Placement {
  // Everything is relative to the overlay's own origin. The overlay sits in
  // the same sliding surface as the pane, so these coordinates do not change
  // while the surface moves.
  const origin = mount.overlay.getBoundingClientRect();
  const scrollerRect = mount.scroller.getBoundingClientRect();
  const columnRect = mount.column.getBoundingClientRect();
  // Line the heading up with the message text. BB insets that text from the
  // column by a width that varies with the viewport, so read it from a rendered
  // prose message (they alone carry the inset); fall back to the desktop inset.
  let textLeft = columnRect.left + 32;
  let textRight = columnRect.right - 32;
  for (const message of mount.scroller.querySelectorAll<HTMLElement>(
    "[data-message-column]",
  )) {
    const rect = message.getBoundingClientRect();
    const style = getComputedStyle(message);
    const padLeft = Number.parseFloat(style.paddingLeft) || 0;
    const padRight = Number.parseFloat(style.paddingRight) || 0;
    if (rect.width > 0 && padLeft > 0) {
      textLeft = rect.left + padLeft;
      textRight = rect.right - padRight;
      break;
    }
  }
  const pane = {
    x: textLeft - origin.left,
    y: scrollerRect.top + base * PAD_TOP - origin.top,
    width: Math.max(0, textRight - textLeft),
  };

  // The title bar is the header above the thread window in the same pane. Its
  // title cluster is on the left and its actions are the next sibling of the
  // flexible region that holds the cluster.
  let bar: Placement["bar"] = null;
  const header = mount.scroller
    .closest("[data-split-pane-id]")
    ?.querySelector<HTMLElement>(":scope > header");
  const title = header?.querySelector<HTMLElement>(".bb-thread-title");
  if (header && title) {
    let cluster: HTMLElement = title;
    while (
      cluster.parentElement &&
      !cluster.parentElement.classList.contains("flex-1")
    ) {
      cluster = cluster.parentElement;
    }
    const actions = cluster.parentElement?.nextElementSibling;
    if (actions && cluster.parentElement) {
      const headerRect = header.getBoundingClientRect();
      const x = cluster.getBoundingClientRect().right + TITLE_BAR_GAP;
      const width = actions.getBoundingClientRect().left - TITLE_BAR_GAP - x;
      if (width >= MIN_TITLE_BAR_WIDTH) {
        bar = {
          x: x - origin.left,
          centerY: (headerRect.top + headerRect.bottom) / 2 - origin.top,
          width,
        };
      }
    }
  }
  return {
    pane,
    background: {
      x: scrollerRect.left - origin.left,
      y: scrollerRect.top - origin.top,
      width: scrollerRect.width,
    },
    bar,
    narrow: scrollerRect.width < NARROW_PX,
    short: scrollerRect.height < SHORT_PX,
  };
}

const samePlacement = (a: Placement | null, b: Placement): boolean =>
  !!a &&
  Math.abs(a.pane.x - b.pane.x) < 0.5 &&
  Math.abs(a.pane.y - b.pane.y) < 0.5 &&
  Math.abs(a.pane.width - b.pane.width) < 0.5 &&
  Math.abs(a.background.x - b.background.x) < 0.5 &&
  Math.abs(a.background.y - b.background.y) < 0.5 &&
  Math.abs(a.background.width - b.background.width) < 0.5 &&
  a.narrow === b.narrow &&
  a.short === b.short &&
  (a.bar === null) === (b.bar === null) &&
  (a.bar === null ||
    b.bar === null ||
    (Math.abs(a.bar.x - b.bar.x) < 0.5 &&
      Math.abs(a.bar.centerY - b.bar.centerY) < 0.5 &&
      Math.abs(a.bar.width - b.bar.width) < 0.5));

/** Keeps the heading's two resting places current as the layout moves. */
function usePlacement(mount: Mount | null, base: number): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useEffect(() => {
    if (!mount) {
      setPlacement(null);
      return;
    }
    let frame = 0;
    const header = mount.scroller
      .closest("[data-split-pane-id]")
      ?.querySelector<HTMLElement>(":scope > header");
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measurePlacement(mount, base);
        setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(mount.scroller);
    resize.observe(mount.column);
    if (header) resize.observe(header);
    // The thread title's width, and the actions beside it, change as titles
    // load and plugins add or drop header actions.
    const mutations = new MutationObserver(measure);
    if (header) {
      mutations.observe(header, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mount, base]);
  return placement;
}

// BB scrolls a fresh thread to its newest message while content loads. Hold
// the expanded heading still briefly rather than following those initial shifts.
const SETTLE_MS = 500;

function useSettled(mount: Mount | null): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!mount) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [mount]);
  return settled;
}

/**
 * A zero-height anchor in BB's message column reserves space for the heading.
 * Its plate and text share a layer above the pane, so neither can be displaced
 * by the message column's bottom edge as the timeline scrolls.
 */
export function StickyGoalHeader(): React.ReactElement | null {
  const { threadId } = useBbContext();
  const context = useGoalContext(threadId);
  const { prefs } = usePrefs();
  const fadeOnly = (prefs?.threads.headingTransition ?? "fade") === "fade";
  const mount = useMessageScroller(threadId);
  const { fromBottom, fade } = useScrollState(mount?.scroller ?? null);
  const settled = useSettled(mount);
  const base = mount?.baseFontSize ?? 14;
  const placement = usePlacement(mount, base);
  const hasEyebrow = !!context?.workstream;
  const phone = useMediaQuery(PHONE_QUERY);
  const eyebrow = hasEyebrow ? eyebrowMetrics(base, phone) : null;
  // On a phone the title may take two lines; it is measured, once placed.
  const measureRef = useRef<HTMLHeadingElement>(null);
  const [wrappedLines, setWrappedLines] = useState(1);
  const title = context?.title;
  const paneWidth = placement?.pane.width ?? 0;
  const narrow = placement?.narrow ?? false;
  useLayoutEffect(() => {
    const probe = measureRef.current;
    if (!narrow || !probe) {
      setWrappedLines(1);
      return;
    }
    const line = base * TITLE_SIZE * TITLE_LINE;
    setWrappedLines(
      Math.min(2, Math.max(1, Math.round(probe.scrollHeight / line))),
    );
  }, [narrow, title, paneWidth, base, hasEyebrow]);
  const titleLines = narrow ? wrappedLines : 1;
  const height = headingHeight(base, hasEyebrow, titleLines);
  const exitDistance = titleExitDistance(base, eyebrow, titleLines);
  const { moved, remaining, progress } = placement?.short
    ? { moved: exitDistance, remaining: 0, progress: 1 }
    : headingScroll(settled ? fromBottom : 0, exitDistance);
  const collapsed = progress === 1;
  const opacity = headingOpacity(progress);
  // When the title bar has no room, the compact copy sits in the timeline.
  const pinned = !!placement && placement.bar === null;
  const platePinnedHeight = pinnedHeight(base, eyebrow);
  // A pinned compact heading needs a solid plate; in the bar the full-size
  // plate can instead fade away without moving under the large heading.
  const plateHeight = fadeOnly
    ? pinned
      ? height * (1 - progress) + platePinnedHeight * progress
      : height
    : Math.max(
        height * (1 - progress),
        pinned ? platePinnedHeight * progress : 0,
      );
  const plateOpacity =
    fadeOnly && !pinned ? headingBackdropOpacity(progress) : 1;
  const scrollPadding =
    fadeOnly && !pinned ? height * (1 - progress) : plateHeight;
  const fadeAnchor = plateHeight;
  useLayoutEffect(() => {
    if (!mount) return;
    mount.root.className = "ws-sticky-goal-root";
    mount.root.dataset.collapsed = String(collapsed);
    // The reserved gap follows the heading height, which changes only when the
    // thread gains or loses a workstream line.
    mount.root.style.marginBottom = `${height}px`;
    mount.scroller.style.scrollPaddingTop = `${scrollPadding}px`;
    return () => {
      mount.root.className = "";
      delete mount.root.dataset.collapsed;
    };
  }, [mount, collapsed, height, scrollPadding]);

  // The heading replaces BB's own thread title in the title bar, but only
  // while it is actually drawn, so the title never shows twice.
  const showing = !!(mount && context && placement);
  useLayoutEffect(() => {
    if (!mount || !showing) return;
    const header = mount.scroller
      .closest("[data-split-pane-id]")
      ?.querySelector<HTMLElement>(":scope > header");
    header?.setAttribute("data-ws-hide-title", "");
    return () => header?.removeAttribute("data-ws-hide-title");
  }, [mount, showing]);

  useLayoutEffect(() => {
    if (!mount) return;
    mount.overlay.className = "ws-goal-overlay";
    return () => {
      mount.overlay.className = "";
    };
  }, [mount]);

  if (!mount || !context || !placement) return null;

  const inBar = placement.bar !== null;
  const eyebrowBlock = eyebrow?.expandedBlock ?? 0;
  const barEyebrowBlock = eyebrow?.compactBlock ?? 0;
  const barBlock = compactBlock(base, eyebrow);
  const paneTop = placement.pane.y - base * PAD_TOP;
  const compactSpot = placement.bar
    ? {
        x: placement.bar.x,
        y: placement.bar.centerY - barBlock / 2,
        width: placement.bar.width,
      }
    : {
        x: placement.pane.x,
        y: paneTop + base * PINNED_PAD,
        width: placement.pane.width,
      };
  const titleBlock = base * TITLE_SIZE * TITLE_LINE * titleLines;
  const workstream = (compact: boolean, width: number) =>
    context.workstream &&
    eyebrow && (
      <div
        className="ws-sticky-goal__workstream"
        style={
          {
            fontSize: eyebrow.size,
            maxWidth: compact ? width / eyebrow.compactScale : width,
            transform: `scale(${compact ? eyebrow.compactScale : 1})`,
            "--ws-hue": context.workstream.hue,
          } as React.CSSProperties
        }
      >
        <WorkstreamIcon className="size-4 text-current" />
        <span>{context.workstream.name}</span>
      </div>
    );

  // In scroll mode the copies travel together; in fade mode each stays at
  // its final position while its opacity follows the same scroll progress.
  const text = (
    <>
      <div
        className="ws-goal-overlay__clip"
        data-ws-heading="expanded"
        style={{
          transform: `translate(${placement.pane.x}px, ${paneTop}px)`,
          width: placement.pane.width,
          height,
        }}
      >
        <div
          className="ws-goal-overlay__group"
          style={{
            transform: `translateY(${base * PAD_TOP - (fadeOnly ? 0 : moved)}px)`,
            opacity: opacity.expanded,
            width: placement.pane.width,
          }}
        >
          {workstream(false, placement.pane.width)}
          <h2
            className="ws-sticky-goal__title"
            style={{
              fontSize: base * TITLE_SIZE,
              transform: `translateY(${eyebrowBlock}px)`,
              ...(narrow && titleLines > 1
                ? {
                    display: "-webkit-box",
                    whiteSpace: "normal",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 2,
                  }
                : null),
            }}
          >
            {context.title}
          </h2>
          {narrow && (
            <h2
              ref={measureRef}
              aria-hidden
              className="ws-sticky-goal__title ws-sticky-goal__probe"
              style={{
                fontSize: base * TITLE_SIZE,
                width: placement.pane.width,
              }}
            >
              {context.title}
            </h2>
          )}
          {context.subtask && (
            <div
              className="ws-sticky-goal__subtitle"
              style={{
                fontSize: base * SUBTITLE_SIZE,
                transform: `translateY(${eyebrowBlock + titleBlock}px)`,
              }}
            >
              {context.subtask}
            </div>
          )}
        </div>
      </div>
      <div
        className="ws-goal-overlay__clip"
        data-ws-heading="compact"
        aria-hidden
        style={{
          transform: `translate(${compactSpot.x}px, ${compactSpot.y}px)`,
          width: compactSpot.width,
          height: inBar
            ? Math.max(barBlock, paneTop - compactSpot.y)
            : barBlock,
        }}
      >
        <div
          className="ws-goal-overlay__group"
          style={{
            transform: `translateY(${fadeOnly ? 0 : remaining}px)`,
            opacity: opacity.compact,
            width: compactSpot.width,
          }}
        >
          {workstream(true, compactSpot.width)}
          <div
            className="ws-sticky-goal__title"
            style={{
              fontSize: base * TITLE_BAR_TITLE_SIZE,
              transform: `translateY(${barEyebrowBlock}px)`,
            }}
          >
            {context.title}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(
    <>
      <div
        className="ws-goal-background"
        style={
          {
            transform: `translate(${placement.background.x}px, ${placement.background.y}px)`,
            width: placement.background.width,
            "--ws-plate-height": `${fadeAnchor}px`,
            // Match the 1.5rem bar fade as the 4rem plate fade leaves.
            "--ws-plate-fade-scale":
              fadeOnly && !pinned ? 1 : 1 - progress * (1 - 1.5 / 4),
            "--ws-fade-below-plate": fade && plateHeight > 0 ? plateOpacity : 0,
            "--ws-fade-below-bar":
              fade && inBar
                ? fadeOnly
                  ? opacity.compact
                  : Number(collapsed)
                : 0,
          } as React.CSSProperties
        }
      >
        <div className="ws-sticky-goal" style={{ height }}>
          <div
            className="ws-sticky-goal__plate"
            style={{
              transform: `scaleY(${plateHeight / height})`,
              opacity: plateOpacity,
            }}
          />
        </div>
      </div>
      {text}
    </>,
    mount.overlay,
  );
}
