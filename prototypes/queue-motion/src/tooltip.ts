/**
 * Tooltips for the lab's controls. Any element with a `data-help` attribute gets one: hover shows it after a
 * short pause, keyboard focus shows it at once, and Escape, a click, or a card key dismisses it until the
 * pointer or focus leaves the control. It sits wholly above or below the control, never over it, clamped to
 * the viewport, and scrolls (wheel over the control, or the tooltip itself) when the text is taller than the
 * room. It takes no pointer events, so a tooltip never covers a neighbouring control while you reach for it.
 */
import { CONTROLS, type Control } from "./controls.ts";
import { HELP, type Help } from "./help.ts";

const GAP = 8;
const MARGIN = 8;
const SHOW_DELAY = 250;
const HIDE_DELAY = 60;
/** After a tooltip closes, the next control's tooltip opens without the pause for this long, ms. */
const WARM = 400;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

/** Writes `text` into `into`, turning `code` spans (backticks) into <code>. */
export function inline(into: HTMLElement, text: string) {
  text.split("`").forEach((part, i) => {
    if (i % 2) into.append(element("code", "", part));
    else if (part) into.append(part);
  });
}

function fill(tip: HTMLElement, control: Control, help: Help) {
  const head = element("div", "tip-head");
  head.append(
    element("b", "", control.label),
    element("span", "tip-meta", `${control.kind} · ${control.meta}`),
  );
  const what = element("p", "tip-what");
  inline(what, help.what);
  const steps = element("dl", "tip-steps");
  const row = (label: string, text: string) => {
    const dt = element("dt", "", label);
    const dd = element("dd");
    inline(dd, text);
    steps.append(dt, dd);
  };
  for (const [label, text] of help.effect) row(label, text);
  row("Works with", help.needs);
  row("Tune", help.tune);
  tip.replaceChildren(head, what, steps);
  if (help.numbers.length) {
    const src = element("p", "tip-src");
    inline(src, `Numbers from ${help.numbers.join("; ")}.`);
    tip.append(src);
  }
}

export type Tooltips = {
  /** Hides the tooltip, as a click does. */
  dismiss(): void;
  /** Re-reads the anchor after the page changed: closes the tooltip if its control went away. */
  sync(): void;
};

export function installTooltips(): Tooltips {
  const tip = element("div", "tip");
  tip.id = "tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  const byId = new Map(CONTROLS.map((c) => [c.id, c]));

  let anchor: HTMLElement | null = null;
  /** A control Escape or a click dismissed; it stays quiet until the pointer or focus leaves it. */
  let quiet: HTMLElement | null = null;
  let showTimer = 0;
  let hideTimer = 0;
  let warmUntil = 0;

  const controlOf = (n: EventTarget | null) =>
    n instanceof Element ? n.closest<HTMLElement>("[data-help]") : null;
  const focusable = (c: HTMLElement) =>
    c.matches("button, input, select, summary, [tabindex]")
      ? c
      : c.querySelector<HTMLElement>("button, input, select");

  function place(c: HTMLElement) {
    const r = c.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    tip.style.maxHeight = "";
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const side =
      below >= h || (above < h && below >= above) ? "below" : "above";
    const room = Math.max(96, side === "below" ? below : above);
    tip.style.maxHeight = `${room}px`;
    const shown = Math.min(h, room);
    tip.style.left = `${Math.min(Math.max(r.left, MARGIN), Math.max(MARGIN, vw - w - MARGIN))}px`;
    tip.style.top = `${side === "below" ? r.bottom + GAP : r.top - GAP - shown}px`;
  }

  function show(c: HTMLElement) {
    const id = c.dataset.help ?? "";
    const control = byId.get(id);
    const help = HELP[id];
    if (!control || !help) {
      console.error(`no tooltip for control "${id}"`);
      return;
    }
    clearTimeout(hideTimer);
    hide();
    fill(tip, control, help);
    tip.scrollTop = 0;
    tip.hidden = false;
    place(c);
    anchor = c;
    focusable(c)?.setAttribute("aria-describedby", tip.id);
  }

  function hide() {
    if (anchor) focusable(anchor)?.removeAttribute("aria-describedby");
    anchor = null;
    tip.hidden = true;
  }

  function request(c: HTMLElement, instant: boolean) {
    if (c === quiet) return;
    quiet = null;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (c === anchor) return;
    const open = () => show(c);
    if (instant || !tip.hidden || Date.now() < warmUntil) open();
    else showTimer = window.setTimeout(open, SHOW_DELAY);
  }

  function release(c: HTMLElement) {
    clearTimeout(showTimer);
    if (quiet === c) quiet = null;
    if (c !== anchor) return;
    hideTimer = window.setTimeout(() => {
      hide();
      warmUntil = Date.now() + WARM;
    }, HIDE_DELAY);
  }

  function dismiss() {
    clearTimeout(showTimer);
    if (anchor) quiet = anchor;
    hide();
  }

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const c = controlOf(e.target);
    if (c) request(c, false);
  });
  document.addEventListener("pointerout", (e) => {
    const c = controlOf(e.target);
    if (c && controlOf(e.relatedTarget) !== c) release(c);
  });
  document.addEventListener("focusin", (e) => {
    const c = controlOf(e.target);
    if (c) request(c, true);
  });
  document.addEventListener("focusout", (e) => {
    const c = controlOf(e.target);
    if (c && controlOf(e.relatedTarget) !== c) release(c);
  });
  // A press on a control is the start of using it, so the tooltip steps aside before the focus event can reopen it.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const c = controlOf(e.target);
      if (c) quiet = c;
      clearTimeout(showTimer);
      hide();
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !tip.hidden) dismiss();
  });
  // The page does not scroll, so the wheel over a control scrolls a tooltip that is taller than its room.
  document.addEventListener(
    "wheel",
    (e) => {
      if (tip.hidden || tip.scrollHeight <= tip.clientHeight) return;
      tip.scrollTop += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
  addEventListener("resize", () => hide());
  addEventListener("blur", () => hide());

  return {
    dismiss,
    sync() {
      if (!anchor) return;
      if (!anchor.isConnected || anchor.getClientRects().length === 0) hide();
      else place(anchor);
    },
  };
}
