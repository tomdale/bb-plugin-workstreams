/**
 * The two small sidebars a suggestion is reviewed on (`suggestionMiniatures`):
 * every workstream as its name over one tick per thread, as it is now and as
 * it would be after accepting. A workstream the change touches takes its
 * color and the threads that move are drawn as ribbons from where they are to
 * where they go; the rest is quiet gray, there for placement.
 *
 * Ribbons are measured from the laid-out ticks, since names wrap and so a
 * row's height is not known beforehand. When the two sidebars are taller than
 * the pane they scroll together with the touched rows in the middle, and the
 * rows beyond the edge are counted ("3 rows above") rather than cut in half.
 * A ribbon takes the pointer and the keyboard: hovered or focused, it shows
 * the titles of the threads it carries, and their true count.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { workstreamColorStyle } from "../../domain/workstreamColor.ts";
import type {
  MiniFlow,
  Miniature,
  MiniWorkstream,
} from "./suggestionMiniatures.ts";

/** Titles the card lists before it gives the rest as a count. */
const TITLES_SHOWN = 12;
/** Height of the "rows above" and "rows below" lines at the pane's edges. */
const NOTE_PX = 17;

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const total = (flow: MiniFlow) => flow.threads.length;
const labelOf = (to: MiniFlow["to"]) =>
  to.prefix ? `${to.prefix}: ${to.name}` : to.name;

type Ribbon = { flow: number; d: string; thin: boolean };
type Notes = { above: [number, number]; below: [number, number] };
type Geometry = {
  ribbons: Ribbon[];
  /** Each flow's vertical center in the scrolled content. */
  centers: number[];
  notes: Notes;
};

const NO_NOTES: Notes = { above: [0, 0], below: [0, 0] };

/** Everything the layout decides, measured from the drawn ticks. */
function measure(scroller: HTMLElement, flows: readonly MiniFlow[]): Geometry {
  const grid = scroller.firstElementChild as HTMLElement;
  const column = (side: string) =>
    grid.querySelector<HTMLElement>(`[data-side="${side}"]`)!;
  const g = grid.getBoundingClientRect();
  const nowBox = column("now").getBoundingClientRect();
  const afterBox = column("after").getBoundingClientRect();
  const x0 = nowBox.left - g.left;
  const x1 = nowBox.right - g.left;
  const x2 = afterBox.left - g.left;
  const x3 = afterBox.right - g.left;
  const mx = (x1 + x2) / 2;
  const span = (side: string, flow: number) => {
    const rects = [
      ...column(side).querySelectorAll<HTMLElement>(`[data-flow="${flow}"]`),
    ].map((tick) => tick.getBoundingClientRect());
    return rects.length
      ? ([
          Math.min(...rects.map((r) => r.top)) - g.top - 0.5,
          Math.max(...rects.map((r) => r.bottom)) - g.top + 0.5,
        ] as const)
      : null;
  };
  const ribbons: Ribbon[] = [];
  const centers: number[] = [];
  flows.forEach((flow) => {
    const from = span("now", flow.index);
    const to = span("after", flow.index);
    if (!from || !to) return;
    const [a1, a2] = from;
    const [b1, b2] = to;
    centers[flow.index] = (b1 + b2) / 2;
    ribbons.push({
      flow: flow.index,
      thin: total(flow) < 3,
      d: `M${x0} ${a1}H${x1}C${mx} ${a1} ${mx} ${b1} ${x2} ${b1}H${x3}V${b2}H${x2}C${mx} ${b2} ${mx} ${a2} ${x1} ${a2}H${x0}Z`,
    });
  });
  return { ribbons, centers, notes: NO_NOTES };
}

/**
 * Scrolls the touched rows to the middle when the sidebars overflow, and
 * hides each workstream that an edge would cut, returning the counts of the
 * rows hidden beyond each edge, per sidebar. A workstream goes whole, name
 * and ticks together, so no edge shows ticks without the name they belong to.
 */
function crop(scroller: HTMLElement, initial: boolean) {
  const grid = scroller.firstElementChild as HTMLElement;
  for (const group of grid.querySelectorAll<HTMLElement>(".ws-mini-group"))
    group.style.visibility = "";
  const height = scroller.clientHeight;
  if (grid.offsetHeight <= height + 1) return NO_NOTES;
  if (initial) {
    const g = grid.getBoundingClientRect();
    const hot = [
      ...grid.querySelectorAll<HTMLElement>("[data-hot-row], [data-flow]"),
    ].map((row) => row.getBoundingClientRect());
    if (hot.length) {
      const top = Math.min(...hot.map((r) => r.top)) - g.top;
      const bottom = Math.max(...hot.map((r) => r.bottom)) - g.top;
      scroller.scrollTop =
        bottom - top > height - 80 ? top - 40 : (top + bottom) / 2 - height / 2;
    }
  }
  const box = scroller.getBoundingClientRect();
  const scrolled = scroller.scrollTop > 0;
  const more = scroller.scrollTop + height < grid.offsetHeight - 1;
  const notes: Notes = { above: [0, 0], below: [0, 0] };
  (["now", "after"] as const).forEach((side, at) => {
    const column = grid.querySelector<HTMLElement>(`[data-side="${side}"]`)!;
    for (const group of column.children as Iterable<HTMLElement>) {
      const r = group.getBoundingClientRect();
      const above = scrolled && r.top < box.top + NOTE_PX;
      const below = more && r.bottom > box.bottom - NOTE_PX;
      if (!above && !below) continue;
      group.style.visibility = "hidden";
      const rows = group.querySelectorAll("[data-row]").length;
      if (above) notes.above[at]! += rows;
      else notes.below[at]! += rows;
    }
  });
  return notes;
}

function Workstream({
  node,
  flowStyles,
  sub = false,
}: {
  node: MiniWorkstream;
  flowStyles: readonly CSSProperties[];
  sub?: boolean;
}) {
  return (
    <div
      className={cn(
        "ws-mini-group",
        sub && "ws-mini-sub",
        node.hot && node.color && "ws-mini-accent",
      )}
      data-hot={node.hot ? "" : undefined}
      style={
        node.hot && node.color
          ? (workstreamColorStyle(node.color) as CSSProperties)
          : undefined
      }
    >
      <span
        className="ws-mini-name"
        data-row
        data-hot-row={node.hot ? "" : undefined}
      >
        {node.prefix ? (
          <span className="ws-mini-prefix">{node.prefix}: </span>
        ) : null}
        {node.name}
      </span>
      {node.ticks.map((tick, at) => (
        <i
          key={at}
          data-row
          data-flow={tick.flow ?? undefined}
          data-hidden={tick.hidden ? "" : undefined}
          className={cn("ws-mini-tick", tick.flow !== null && "ws-mini-accent")}
          style={
            {
              width: tick.width,
              ...(tick.flow !== null ? flowStyles[tick.flow] : null),
            } as CSSProperties
          }
        />
      ))}
      {node.subs.map((child) => (
        <Workstream key={child.key} node={child} flowStyles={flowStyles} sub />
      ))}
    </div>
  );
}

export function SuggestionMiniatures({
  model,
  summary,
  compact = false,
}: {
  model: Miniature;
  /** Narrow layout: the thread titles cover the drawing's foot, not its side. */
  compact?: boolean;
  /** The drawing in words, for a screen reader. */
  summary: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<Geometry>({
    ribbons: [],
    centers: [],
    notes: NO_NOTES,
  });
  const [active, setActive] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const flowStyles = useMemo(
    () => model.flows.map((flow) => workstreamColorStyle(flow.color)),
    [model.flows],
  );
  const hasHidden = [...model.now, ...model.after].some(function some(
    node: MiniWorkstream,
  ): boolean {
    return node.ticks.some((tick) => tick.hidden) || node.subs.some(some);
  });

  useLayoutEffect(() => {
    const box = wrap.current;
    const pane = scroller.current;
    if (!box || !pane) return;
    let first = true;
    const run = () => {
      const next = measure(pane, model.flows);
      next.notes = crop(pane, first);
      first = false;
      setGeometry(next);
      setScrollTop(pane.scrollTop);
    };
    run();
    const onScroll = () => {
      const notes = crop(pane, false);
      setGeometry((was) => ({ ...was, notes }));
      setScrollTop(pane.scrollTop);
    };
    pane.addEventListener("scroll", onScroll, { passive: true });
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(run);
    resize?.observe(box);
    void document.fonts?.ready.then(run);
    return () => {
      pane.removeEventListener("scroll", onScroll);
      resize?.disconnect();
    };
  }, [model]);

  const flow = active === null ? null : model.flows[active];
  const cardTop =
    flow && geometry.centers[flow.index] !== undefined
      ? Math.max(
          0,
          Math.min(
            geometry.centers[flow.index]! -
              scrollTop -
              (card.current?.offsetHeight ?? 0) / 2,
            (wrap.current?.clientHeight ?? 0) -
              (card.current?.offsetHeight ?? 0),
          ),
        )
      : 0;

  const stepBand = (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const bands = [
      ...(wrap.current?.querySelectorAll<SVGPathElement>("path[tabindex]") ??
        []),
    ];
    const at = bands.indexOf(event.currentTarget);
    bands[
      (at + (event.key === "ArrowDown" ? 1 : -1) + bands.length) % bands.length
    ]?.focus();
  };

  return (
    <div
      data-compact={compact ? "" : undefined}
      className="ws-mini flex min-h-0 flex-1 flex-col"
    >
      <p className="sr-only">{summary}</p>
      <div className="ws-mini-caps mb-1.5 grid h-7 shrink-0 items-center text-xs text-muted-foreground">
        <span>Now</span>
        <span className="col-start-3">After accepting</span>
      </div>
      <div ref={wrap} className="ws-mini-wrap relative min-h-0 flex-1">
        <div
          ref={scroller}
          className="ws-mini-scroll absolute inset-0 overflow-y-auto rounded-sm"
        >
          <div className="ws-mini-grid relative">
            <div data-side="now" className="min-w-0">
              {model.now.map((node) => (
                <Workstream
                  key={node.key}
                  node={node}
                  flowStyles={flowStyles}
                />
              ))}
            </div>
            <div data-side="after" className="col-start-3 min-w-0">
              {model.after.map((node) => (
                <Workstream
                  key={node.key}
                  node={node}
                  flowStyles={flowStyles}
                />
              ))}
            </div>
            <svg
              aria-hidden={geometry.ribbons.length ? undefined : true}
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
            >
              {geometry.ribbons.map((ribbon) => {
                const f = model.flows[ribbon.flow]!;
                return (
                  <path
                    key={ribbon.flow}
                    d={ribbon.d}
                    tabIndex={0}
                    role="button"
                    aria-label={`${plural(total(f), "thread")} to ${labelOf(f.to)}: ${f.threads.map((t) => t.title).join(", ")}`}
                    data-thin={ribbon.thin ? "" : undefined}
                    data-on={active === ribbon.flow ? "" : undefined}
                    className="ws-mini-ribbon ws-mini-accent"
                    style={flowStyles[ribbon.flow] as CSSProperties}
                    onMouseEnter={() => setActive(ribbon.flow)}
                    onMouseLeave={() =>
                      setActive((now) => (now === ribbon.flow ? null : now))
                    }
                    onFocus={() => setActive(ribbon.flow)}
                    onBlur={() =>
                      setActive((now) => (now === ribbon.flow ? null : now))
                    }
                    onKeyDown={stepBand}
                  />
                );
              })}
            </svg>
          </div>
        </div>
        {(
          [
            ["top", "now", geometry.notes.above[0]!, "above"],
            ["bottom", "now", geometry.notes.below[0]!, "below"],
            ["top", "after", geometry.notes.above[1]!, "above"],
            ["bottom", "after", geometry.notes.below[1]!, "below"],
          ] as const
        ).map(([edge, side, count, where]) =>
          count > 0 ? (
            <span
              key={`${edge}${side}`}
              className={cn(
                "ws-mini-note absolute h-[17px] bg-background text-[11px] leading-[17px] tabular-nums text-muted-foreground",
                edge === "top" ? "top-0" : "bottom-0",
                side === "now" ? "ws-mini-note-now" : "ws-mini-note-after",
              )}
            >
              {plural(count, "row")} {where}
            </span>
          ) : null,
        )}
        {flow ? (
          <div
            ref={card}
            role="tooltip"
            style={{ top: cardTop }}
            className="ws-mini-titles pointer-events-none absolute animate-in fade-in-0 text-xs leading-[17px] text-foreground duration-100 motion-reduce:animate-none"
          >
            <p className="m-0 mb-1 text-foreground">
              {flow.to.prefix ? (
                <span className="text-muted-foreground">
                  {flow.to.prefix}:{" "}
                </span>
              ) : null}
              {flow.to.name}
              <span className="ml-1.5 whitespace-nowrap text-muted-foreground">
                {plural(total(flow), "thread")}
              </span>
            </p>
            {flow.threads.slice(0, TITLES_SHOWN).map((thread) => (
              <p key={thread.id} className="m-0 mb-0.5 text-pretty">
                {thread.title}
              </p>
            ))}
            {flow.threads.length > TITLES_SHOWN ? (
              <p className="m-0 text-muted-foreground">
                and {flow.threads.length - TITLES_SHOWN} more
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {hasHidden || model.archived > 0 ? (
        <p className="m-0 shrink-0 pt-1.5 text-[11px] leading-4 text-muted-foreground">
          {hasHidden
            ? "Dashed ticks are snoozed threads, which the sidebar doesn't list."
            : null}
          {hasHidden && model.archived > 0 ? " " : null}
          {model.archived > 0
            ? `${plural(model.archived, "archived thread")} also ${model.archived === 1 ? "moves" : "move"} and ${model.archived === 1 ? "isn't" : "aren't"} drawn.`
            : null}
        </p>
      ) : null}
    </div>
  );
}
