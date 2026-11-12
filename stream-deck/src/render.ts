/**
 * Draws keys and the dial's touch strip as SVG. Stream Deck rasterizes SVG
 * itself without a browser's text layout, so text is measured here with
 * approximate glyph widths and broken into lines by hand.
 */
import type {
  StreamDeckMark,
  StreamDeckSnapshot,
  StreamDeckThread,
} from "../../src/domain/streamDeck.ts";

/** What a key shows when it has no thread to draw. */
export type Notice =
  | "connecting"
  | "offline"
  | "no-bb"
  | "no-token"
  | "refused"
  | "missing"
  | "outdated";

const NOTICE_TEXT: Record<Notice, string> = {
  connecting: "Connecting to BB",
  offline: "Can't reach BB",
  "no-bb": "BB isn't installed",
  "no-token": "Can't get BB's token",
  refused: "BB refused the token",
  missing: "Workstreams not found in BB",
  outdated: "Update this Stream Deck plugin",
};

/** The sidebar's mark colors, as they read on a black key. */
export const MARK_COLOR: Record<StreamDeckMark, string> = {
  "needs-you": "#f5a524",
  review: "#4c9aff",
  done: "#3fb950",
  error: "#f85149",
};

// One family: Stream Deck's SVG renderer may not read a fallback list.
const FONT = "Helvetica Neue";
const KEY = 144;
const PAD = 10;
const READ_TITLE = "#c4c8ce";
const DIM = "#8a9099";

/**
 * Helvetica Neue's advance widths in hundredths of an em, measured at regular
 * weight; semibold runs about 6% wider. Characters not listed count as an
 * average letter, or a full em from the CJK ranges up.
 */
const GLYPHS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,:;'!|()[]-\u2026&";
const WIDTHS = [
  56, 56, 56, 56, 56, 56, 56, 56, 56, 56, 54, 59, 54, 59, 54, 30, 57, 56, 22,
  22, 52, 22, 85, 56, 57, 59, 59, 33, 50, 32, 56, 50, 76, 52, 50, 48, 65, 69,
  72, 70, 61, 57, 76, 72, 26, 52, 67, 56, 87, 72, 76, 65, 76, 69, 65, 57, 72,
  61, 93, 61, 65, 61, 28, 28, 28, 28, 28, 28, 26, 22, 26, 26, 26, 26, 39, 100,
  63,
];
const WIDTH = new Map([...GLYPHS].map((char, i) => [char, WIDTHS[i]! / 100]));

function charWidth(char: string): number {
  return WIDTH.get(char) ?? (char.codePointAt(0)! >= 0x2e80 ? 1 : 0.56);
}

export function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const char of text) em += charWidth(char);
  return em * size * (bold ? 1.06 : 1);
}

/** `text` cut short with an ellipsis so that it fits `width`. */
function ellipsize(text: string, size: number, width: number, bold: boolean) {
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, size, bold) > width)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** `text`, or as much of it as fits `width` with an ellipsis. */
function clip(text: string, size: number, width: number, bold: boolean) {
  return textWidth(text, size, bold) <= width
    ? text
    : ellipsize(text, size, width, bold);
}

/**
 * Breaks `text` into at most `maxLines` lines of `width`, ending the last
 * line with an ellipsis when the text runs past it. A word too long for a
 * line is split across lines.
 */
export function wrap(
  text: string,
  size: number,
  width: number,
  maxLines: number,
  bold = false,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const fits = (candidate: string) => textWidth(candidate, size, bold) <= width;
  for (let word of words) {
    while (!fits(word) && word.length > 1) {
      // Split an overlong word at the widest prefix that fits a line.
      if (line) lines.push(line);
      line = "";
      let cut = word.length - 1;
      while (cut > 1 && !fits(word.slice(0, cut))) cut--;
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(
    `${kept[maxLines - 1]} ${lines[maxLines]}`,
    size,
    width,
    bold,
  );
  return kept;
}

function escape(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

type TextOptions = {
  x: number;
  y: number;
  size: number;
  fill: string;
  weight?: number;
  anchor?: "start" | "middle" | "end";
};

function text(value: string, options: TextOptions): string {
  return `<text x="${options.x}" y="${options.y}" font-family="${FONT}" font-size="${options.size}" font-weight="${options.weight ?? 400}" fill="${options.fill}" text-anchor="${options.anchor ?? "start"}">${escape(value)}</text>`;
}

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#000000"/>${body}</svg>`;
}

/** An SVG as the data URL `setImage` and pixmap feedback accept. */
export function dataUrl(image: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(image).toString("base64")}`;
}

/** The area after the owner in "Owner: Area", as the sidebar names it. */
export function workstreamArea(name: string): string {
  const at = name.indexOf(":");
  const area = at > 0 ? name.slice(at + 1).trim() : "";
  return area || name;
}

/**
 * A workstream's name for `width`: whole when it fits, else its area alone,
 * cut short if even that is too long.
 */
function workstreamLabel(name: string, size: number, width: number): string {
  return textWidth(name, size, true) <= width
    ? name
    : clip(workstreamArea(name), size, width, true);
}

/**
 * A mark as the sidebar draws it: a dot that is solid while the thread is
 * unread and a ring once read.
 */
function mark(thread: StreamDeckThread, cx: number, cy: number, r: number) {
  if (!thread.mark) return "";
  const color = MARK_COLOR[thread.mark];
  return thread.unread
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r - 1.25}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
}

/** Title sizes a key tries, largest first; most titles take the first. */
const TITLE_SIZES = [22, 19, 17];

/**
 * The title's lines at the largest size that fits `height` without cutting
 * a word in two or the title short, else at the smallest size, cut short.
 * Keys in a row mostly share the first size, so they read as one list.
 */
function fitTitle(title: string, width: number, height: number, bold: boolean) {
  const words = title.trim().split(/\s+/).join(" ");
  for (const size of TITLE_SIZES) {
    const lineHeight = Math.round(size * 1.16);
    const maxLines = Math.max(1, Math.floor(height / lineHeight));
    const lines = wrap(title, size, width, maxLines, bold);
    const whole = lines.join(" ") === words;
    if (whole || size === TITLE_SIZES[TITLE_SIZES.length - 1])
      return { size, lineHeight, lines };
  }
  throw new Error("unreachable");
}

/**
 * One Up Next thread on a key: its mark and workstream across the top, its
 * title below, bold while unread. The title starts at the same height on
 * every key, with or without the top line, so a row of keys reads as a list.
 */
export function threadKey(thread: StreamDeckThread): string {
  let body = mark(thread, PAD + 6, 21, 6.5);
  if (thread.workstream) {
    const x = thread.mark ? PAD + 19 : PAD;
    body += text(workstreamLabel(thread.workstream.name, 15, KEY - x - PAD), {
      x,
      y: 26,
      size: 15,
      fill: thread.workstream.color,
      weight: 600,
    });
  }
  const top = 40;
  const { size, lineHeight, lines } = fitTitle(
    thread.title,
    KEY - PAD * 2,
    KEY - top - PAD,
    thread.unread,
  );
  lines.forEach((line, i) => {
    body += text(line, {
      x: PAD,
      y: top + size + i * lineHeight - Math.round(size * 0.12),
      size,
      fill: thread.unread ? "#ffffff" : READ_TITLE,
      weight: thread.unread ? 600 : 400,
    });
  });
  return svg(KEY, KEY, body);
}

/** A key with no Up Next thread at its position: a short dim rule. */
export function emptyKey(): string {
  return svg(
    KEY,
    KEY,
    `<rect x="60" y="71" width="24" height="2" rx="1" fill="#3a3f46"/>`,
  );
}

/** A key that can't show Up Next yet, saying why in a few words. */
export function noticeKey(notice: Notice): string {
  const lines = wrap(NOTICE_TEXT[notice], 19, KEY - PAD * 2, 4);
  const lineHeight = 23;
  const top = KEY / 2 - (lines.length * lineHeight) / 2 + 16;
  return svg(
    KEY,
    KEY,
    lines
      .map((line, i) =>
        text(line, {
          x: KEY / 2,
          y: top + i * lineHeight,
          size: 19,
          fill: DIM,
          anchor: "middle",
        }),
      )
      .join(""),
  );
}

/** Every thread a key or the dial can show: the rows, then Show more's. */
export function upNextThreads(
  snapshot: StreamDeckSnapshot,
): readonly StreamDeckThread[] {
  return [...snapshot.rows, ...snapshot.more];
}

/** How many Up Next threads are unread or wait on the user. */
export function waitingCount(snapshot: StreamDeckSnapshot): number {
  return upNextThreads(snapshot).filter(
    (thread) => thread.unread || thread.onYou,
  ).length;
}

/**
 * The Next key: how many Up Next threads are unread or wait on you, amber
 * when one is blocked on you, over the words "Up Next". A dash stands in for
 * the count until the first snapshot arrives.
 */
export function nextKey(snapshot: StreamDeckSnapshot | null): string {
  const count = snapshot ? waitingCount(snapshot) : 0;
  const blocked =
    snapshot !== null && upNextThreads(snapshot).some((thread) => thread.onYou);
  const fill =
    count === 0 ? "#4a4f57" : blocked ? MARK_COLOR["needs-you"] : "#ffffff";
  return svg(
    KEY,
    KEY,
    text(snapshot ? String(count) : "–", {
      x: KEY / 2,
      y: 88,
      size: 66,
      fill,
      weight: 700,
      anchor: "middle",
    }) +
      text("Up Next", {
        x: KEY / 2,
        y: 124,
        size: 20,
        fill: DIM,
        weight: 600,
        anchor: "middle",
      }),
  );
}

const DIAL_W = 200;
const DIAL_H = 100;
const DIAL_PAD = 12;

/**
 * The dial's touch strip: the thread at `index` with its full workstream
 * name, and a dot per Up Next thread along the bottom marking where it is.
 */
export function dialStrip(
  threads: readonly StreamDeckThread[],
  index: number,
): string {
  const thread = threads[index];
  if (!thread)
    return svg(
      DIAL_W,
      DIAL_H,
      text("Nothing up next", {
        x: DIAL_W / 2,
        y: 56,
        size: 18,
        fill: DIM,
        anchor: "middle",
      }),
    );
  let body = mark(thread, DIAL_PAD + 5, 17, 6);
  const x = thread.mark ? DIAL_PAD + 17 : DIAL_PAD;
  if (thread.workstream)
    body += text(
      workstreamLabel(thread.workstream.name, 15, DIAL_W - x - DIAL_PAD),
      {
        x,
        y: 22,
        size: 15,
        fill: thread.workstream.color,
        weight: 600,
      },
    );
  const lines = wrap(thread.title, 19, DIAL_W - DIAL_PAD * 2, 2, thread.unread);
  lines.forEach((line, i) => {
    body += text(line, {
      x: DIAL_PAD,
      y: 46 + i * 22,
      size: 19,
      fill: thread.unread ? "#ffffff" : READ_TITLE,
      weight: thread.unread ? 600 : 400,
    });
  });
  const shown = Math.min(threads.length, 12);
  const start = Math.min(
    Math.max(0, index - Math.floor(shown / 2)),
    threads.length - shown,
  );
  const gap = 11;
  const left = DIAL_W / 2 - ((shown - 1) * gap) / 2;
  for (let i = 0; i < shown; i++)
    body += `<circle cx="${left + i * gap}" cy="91" r="${start + i === index ? 3 : 2.25}" fill="${start + i === index ? "#ffffff" : "#4a4f57"}"/>`;
  return svg(DIAL_W, DIAL_H, body);
}

/** The dial's touch strip while it can't show Up Next. */
export function dialNotice(notice: Notice): string {
  return svg(
    DIAL_W,
    DIAL_H,
    text(NOTICE_TEXT[notice], {
      x: DIAL_W / 2,
      y: 56,
      size: 18,
      fill: DIM,
      anchor: "middle",
    }),
  );
}
