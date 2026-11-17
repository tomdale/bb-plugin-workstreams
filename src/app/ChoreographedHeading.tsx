import { useLayoutEffect, useRef, useState } from "react";
import { workstreamColorStyle } from "../domain/workstreamColor.ts";
import {
  CASCADE_REACH,
  RACK,
  choreograph,
  shadowPaint,
  shadowBackground,
  shadowTuning,
  type Choreographed,
  type Face,
  type HeadingLayout,
  type Letter,
  type Line,
} from "./headingChoreography.ts";
import {
  PAD_TOP,
  SUBTITLE_LINE,
  SUBTITLE_SIZE,
  TITLE_BAR_TITLE_SIZE,
  TITLE_LINE,
  TITLE_SIZE,
  compactBlock,
  eyebrowHeight,
  eyebrowMetrics,
  titleExitDistance,
} from "./goalHeading.ts";
import { WorkstreamIcon } from "./WorkstreamIcon.tsx";

/** Room the minimized lines' clip gives Rack focus's blur beyond the title bar's slot. */
const BLUR_HALO = 32;
/** Room below the heading its blurred and turning lines may spread into. */
const BELOW = 64;

type Eyebrow = ReturnType<typeof eyebrowMetrics>;

/** Everything the heading measures from the page, in px from the overlay's origin. */
export type ChoreographyPlacement = {
  /** The text column the expanded heading lines up with. */
  pane: { x: number; width: number };
  /** The scroller's left edge and width. */
  background: { x: number; width: number };
  /** The scroller's top edge. */
  paneTop: number;
  /** The title bar's slot for the minimized heading, and the bar's own box. */
  bar: { x: number; width: number; top: number; height: number };
};

/** How a line pivots as it scales or turns. */
const ORIGIN: Record<Choreographed, string> = {
  morph: "0 0",
  stagger: "0 0",
  flip: "50% 50%",
  rack: "0 50%",
  cascade: "0 0",
};

function transform(f: Face, dx: number, dy: number, lift = 0): string {
  let t = `translate(${(f.x + dx).toFixed(2)}px, ${(f.y + dy - lift).toFixed(2)}px)`;
  if (f.rotateX) t += ` perspective(700px) rotateX(${f.rotateX.toFixed(2)}deg)`;
  if (f.scale !== 1) t += ` scale(${f.scale.toFixed(4)})`;
  return t;
}

function faceStyle(
  f: Face,
  origin: string,
  dx: number,
  dy: number,
  lift = 0,
): React.CSSProperties {
  return {
    transform: transform(f, dx, dy, lift),
    transformOrigin: origin,
    opacity: f.opacity,
    filter: f.blur > 0.05 ? `blur(${f.blur.toFixed(2)}px)` : undefined,
    ...(f.width === null ? null : { width: f.width }),
  };
}

const wordsOf = (text: string) => text.split(" ");
const countLetters = (text: string) =>
  wordsOf(text).reduce((n, word) => n + [...word].length, 0);

/** The title as words of letters, so each letter can move on its own. */
function Letters({
  text,
  letters,
}: {
  text: string;
  letters: Letter[] | null;
}) {
  let index = 0;
  return (
    <>
      {wordsOf(text).map((word, w) => (
        <span key={w}>
          {w > 0 ? " " : null}
          <span className="ws-sticky-goal__word">
            {[...word].map((char) => {
              const letter = letters?.[index];
              const key = index++;
              return (
                <span
                  key={key}
                  className="ws-sticky-goal__letter"
                  style={
                    letter
                      ? {
                          transform: `translateY(${letter.y.toFixed(2)}px)`,
                          opacity: letter.opacity,
                        }
                      : undefined
                  }
                >
                  {char}
                </span>
              );
            })}
          </span>
        </span>
      ))}
    </>
  );
}

/**
 * The heading drawn by one of the choreographed transitions: a shadow under
 * each expanded line, the expanded lines, and the minimized lines in the title
 * bar, each placed by `choreograph` for the handoff's progress.
 */
export function ChoreographedHeading({
  kind,
  title,
  goal,
  workstream,
  placement,
  base,
  eyebrow,
  narrow,
  titleLines,
  goalLines,
  progress,
  centered,
  titleProbe,
  goalRef,
}: {
  kind: Choreographed;
  title: string;
  goal: string | null | undefined;
  workstream:
    | { name: string; color: Parameters<typeof workstreamColorStyle>[0] }
    | null
    | undefined;
  placement: ChoreographyPlacement;
  base: number;
  eyebrow: Eyebrow | null;
  /** The pane is narrow enough for the title to wrap, so its lines are counted. */
  narrow: boolean;
  titleLines: number;
  goalLines: number;
  progress: number;
  centered: boolean;
  /** Counts the expanded title's wrapped lines on a narrow pane. */
  titleProbe: (element: HTMLHeadingElement | null) => void;
  /** Reports the summary's clamped height. */
  goalRef: (element: HTMLDivElement | null) => void;
}) {
  const { pane, background, paneTop, bar } = placement;
  const wrapped = titleLines > 1;
  const origin = ORIGIN[kind];
  const cascade = kind === "cascade";
  const barFont = base * TITLE_BAR_TITLE_SIZE;

  // Centering puts each minimized line's own text on the slot's middle axis, so
  // the lines are measured at their natural width.
  const probeRef = useRef<HTMLDivElement | null>(null);
  const eyebrowRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState({ title: 0, eyebrow: 0 });
  useLayoutEffect(() => {
    if (!centered) return;
    const next = {
      title: probeRef.current?.offsetWidth ?? 0,
      eyebrow: eyebrowRef.current?.offsetWidth ?? 0,
    };
    setNatural((prev) =>
      prev.title === next.title && prev.eyebrow === next.eyebrow ? prev : next,
    );
  }, [centered, title, workstream?.name, base, bar.width]);

  // Frame: x from the pane's text edge, y from the scroller's top edge.
  const slotX = bar.x - pane.x;
  const barTopY = bar.top - paneTop;
  const barCenterY = barTopY + bar.height / 2;
  const eyebrowScale = eyebrow?.compactScale ?? 1;
  const titleWidth = centered
    ? Math.min(natural.title || bar.width, bar.width)
    : bar.width;
  const titleX = centered ? slotX + (bar.width - titleWidth) / 2 : slotX;
  const eyebrowX = centered
    ? Math.max(slotX, slotX + (bar.width - natural.eyebrow * eyebrowScale) / 2)
    : slotX;
  const block = compactBlock(base, eyebrow);
  const barY = barCenterY - block / 2;
  const eyebrowBlock = eyebrow?.expandedBlock ?? 0;
  const titleBlock = base * TITLE_SIZE * TITLE_LINE * titleLines;
  const letters = cascade ? countLetters(title) : 0;

  const layout: HeadingLayout = {
    base,
    rest: {
      eyebrow: base * PAD_TOP,
      title: base * PAD_TOP + eyebrowBlock,
      goal: base * PAD_TOP + eyebrowBlock + titleBlock,
    },
    bar: { eyebrow: barY, title: barY + (eyebrow?.compactBlock ?? 0) },
    slot: { titleX, eyebrowX, titleWidth },
    heights: {
      eyebrow: eyebrow ? eyebrowHeight(eyebrow) : 0,
      title: titleBlock,
      goal: goalLines * base * SUBTITLE_SIZE * SUBTITLE_LINE,
    },
    paneWidth: pane.width,
    exit: titleExitDistance(base, eyebrow, titleLines),
    wrapped,
    hasEyebrow: !!(workstream && eyebrow),
    hasGoal: !!goal,
    eyebrowScale,
    letters,
  };
  const pose = choreograph(kind, progress, layout, RACK);
  const tuning = shadowTuning(kind);

  // Where each clip sits: the expanded lines in the scroller's width, the
  // minimized ones in the title bar's slot with room for blur on both sides.
  const expandedClip = { x: background.x, y: paneTop };
  const halo = kind === "rack" ? BLUR_HALO : 0;
  const compactClip = { x: bar.x - halo, y: bar.top };
  const ex = pane.x - expandedClip.x;
  const cx = pane.x - compactClip.x;
  const cy = paneTop - compactClip.y;
  const reach = cascade ? CASCADE_REACH : 0;

  const workstreamLine = (
    f: Face,
    dx: number,
    dy: number,
    width: number,
    ref?: React.Ref<HTMLDivElement>,
  ) =>
    workstream && eyebrow ? (
      <div
        ref={ref}
        className="ws-sticky-goal__workstream"
        style={
          {
            fontSize: eyebrow.size,
            maxWidth: width,
            ...faceStyle(f, origin, dx, dy),
            ...workstreamColorStyle(workstream.color),
          } as React.CSSProperties
        }
      >
        <WorkstreamIcon className="size-4 text-current" />
        <span>{workstream.name}</span>
      </div>
    ) : null;

  const shadow = (line: Line) => {
    const record = pose.shadows[line];
    const paint = record ? shadowPaint(tuning, pose.progress, record) : null;
    return (
      <div
        key={line}
        className="ws-goal-shadow"
        style={
          paint
            ? {
                height: Math.ceil(paint.solid + paint.feather) + 1,
                background: shadowBackground(tuning, paint),
                opacity: paint.opacity,
              }
            : { opacity: 0 }
        }
      />
    );
  };

  return (
    <>
      <div
        className="ws-goal-background"
        data-ws-choreographed=""
        style={
          {
            transform: `translate(${background.x}px, ${paneTop}px)`,
            width: background.width,
            "--ws-fade-below-plate": 0,
            "--ws-fade-below-bar": 0,
          } as React.CSSProperties
        }
      >
        {shadow("eyebrow")}
        {shadow("title")}
        {shadow("goal")}
      </div>
      <div
        className="ws-goal-overlay__clip"
        data-ws-heading="expanded"
        style={{
          transform: `translate(${expandedClip.x}px, ${expandedClip.y}px)`,
          width: background.width,
          height: layout.rest.goal + layout.heights.goal + base * 0.65 + BELOW,
          overflow: kind === "morph" ? "visible" : undefined,
        }}
      >
        {pose.expanded.eyebrow
          ? workstreamLine(pose.expanded.eyebrow, ex, 0, pane.width)
          : null}
        <h2
          className={`ws-sticky-goal__title${cascade ? " ws-sticky-goal__title--cascade" : ""}`}
          style={{
            fontSize: base * TITLE_SIZE,
            width: pane.width,
            ...faceStyle(pose.expanded.title, origin, ex, 0, reach),
            ...(narrow && wrapped
              ? {
                  display: "-webkit-box",
                  whiteSpace: "normal",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                }
              : null),
            ...(pose.expanded.title.width === null
              ? null
              : { width: pose.expanded.title.width }),
          }}
        >
          {cascade ? (
            <Letters text={title} letters={pose.letters?.expanded ?? null} />
          ) : (
            title
          )}
        </h2>
        {goal && pose.expanded.goal ? (
          <div
            ref={goalRef}
            className="ws-sticky-goal__subtitle"
            style={{
              fontSize: base * SUBTITLE_SIZE,
              width: pane.width,
              ...faceStyle(pose.expanded.goal, origin, ex, 0),
            }}
          >
            {goal}
          </div>
        ) : null}
        {narrow ? (
          <h2
            ref={titleProbe}
            aria-hidden
            className="ws-sticky-goal__title ws-sticky-goal__probe"
            style={{ fontSize: base * TITLE_SIZE, width: pane.width }}
          >
            {title}
          </h2>
        ) : null}
      </div>
      <div
        className="ws-goal-overlay__clip"
        data-ws-heading="compact"
        aria-hidden
        style={{
          transform: `translate(${compactClip.x}px, ${compactClip.y}px)`,
          width: bar.width + halo * 2,
          height: bar.height,
        }}
      >
        {pose.compact.eyebrow
          ? workstreamLine(
              pose.compact.eyebrow,
              cx,
              cy,
              bar.width / eyebrowScale,
              eyebrowRef,
            )
          : null}
        <div
          className={`ws-sticky-goal__title${cascade ? " ws-sticky-goal__title--cascade" : ""}`}
          style={{
            fontSize: barFont,
            width: titleWidth,
            ...faceStyle(pose.compact.title, origin, cx, cy, reach),
          }}
        >
          {cascade ? (
            <Letters text={title} letters={pose.letters?.compact ?? null} />
          ) : (
            title
          )}
        </div>
        {centered ? (
          <div
            ref={probeRef}
            className="ws-sticky-goal__title ws-sticky-goal__probe"
            style={{
              fontSize: barFont,
              width: "max-content",
              maxWidth: bar.width,
            }}
          >
            {cascade ? <Letters text={title} letters={null} /> : title}
          </div>
        ) : null}
      </div>
    </>
  );
}
