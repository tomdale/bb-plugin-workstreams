/**
 * The preview host: draws a candidate document with the same component and
 * stylesheet as the appended view, in a private headless Chrome, and returns
 * screenshots at fixed widths with layout diagnostics.
 *
 * The page is static markup from `renderToStaticMarkup` and contains no
 * script; its Content-Security-Policy forbids scripts and every fetch, Chrome
 * resolves no host names, and the page's network requests are failed. Fonts
 * and icons are inlined. The only code that runs in the page is the fixed
 * measurement below, sent by this host. Controls in the page do nothing.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HugeiconsIcon } from "@hugeicons/react";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import { DocumentView } from "../../../app/postTurn/DocumentView.tsx";
import type { EnhancedDocument } from "../../../domain/postTurn/document.ts";
import type { DocumentWorkstream } from "../../../domain/postTurn/message.ts";
import { untilAborted } from "./abort.ts";
import { ChromeSession } from "./chrome.ts";

export const VIEWPORTS = [
  { name: "desktop", width: 720 },
  { name: "narrow", width: 360 },
] as const;
export type ViewportName = (typeof VIEWPORTS)[number]["name"];

/** Captures stop here; a taller document is reported as cut off. */
export const MAX_CAPTURE_HEIGHT = 2_400;
const MAX_DIAGNOSTICS = 20;

export type Theme = "light" | "dark";

export type Capture = {
  viewport: ViewportName;
  width: number;
  /** The document's full rendered height, in CSS pixels. */
  height: number;
  /** The capture stopped at `MAX_CAPTURE_HEIGHT`. */
  truncated: boolean;
  /** PNG, base64. */
  png: string;
};

export type Diagnostic = {
  viewport: ViewportName;
  path: string;
  message: string;
};

export type PreviewRender = {
  captures: Capture[];
  diagnostics: Diagnostic[];
  /** Block paths drawn folded at first, whose content shows only when opened. */
  folded: string[];
};

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";

/** The full preview page for one document. */
export function previewPage(input: {
  document: EnhancedDocument;
  workstream: DocumentWorkstream | null;
  styles: string;
  theme: Theme;
}): string {
  const markup = renderToStaticMarkup(
    createElement(DocumentView, {
      document: input.document,
      workstream: input.workstream,
      copy: {
        label: "Copy",
        icon: createElement(HugeiconsIcon, {
          icon: Copy01Icon,
          size: 14,
          strokeWidth: 1.5,
          "aria-hidden": true,
        }),
      },
    }),
  );
  const styles = input.styles.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html lang="en" class="${input.theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${styles}</style></head><body><div data-bb-plugin-root="" data-bb-plugin="workstreams" style="padding:12px 16px">${markup}</div></body></html>`;
}

/** Runs in the page; reads layout only. */
const MEASURE = `(() => {
  const root = document.querySelector("[data-ws-document]");
  if (!root) return { error: "The document did not render." };
  const box = root.getBoundingClientRect();
  const issues = [];
  const pathOf = (el) =>
    el.closest("[data-doc-path]")?.getAttribute("data-doc-path") ?? "(document)";
  const add = (el, message) => issues.push({ path: pathOf(el), message });
  for (const el of root.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (el.matches("[data-doc-scroll]")) {
      if (el.scrollWidth > el.clientWidth + 1)
        add(el, "Scrolls sideways: content is " + el.scrollWidth + "px wide in a " + el.clientWidth + "px column.");
      continue;
    }
    if (el.closest("[data-doc-scroll]")) continue;
    const clips = style.overflowX === "hidden" || style.overflowX === "clip" || style.textOverflow === "ellipsis";
    if (clips && el.scrollWidth > el.clientWidth + 1)
      add(el, "Text is cut off: " + el.scrollWidth + "px of content in " + el.clientWidth + "px.");
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1))
      add(el, "Extends past the document's edge by " + Math.round(Math.max(r.right - box.right, box.left - r.left)) + "px.");
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1)
    issues.push({ path: "(document)", message: "The page is wider than the viewport." });
  const seen = new Set();
  const unique = issues.filter((issue) => {
    const key = issue.path + "\\n" + issue.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const folded = [...root.querySelectorAll("details:not([open])")].map(pathOf);
  return {
    rect: { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height },
    issues: unique,
    folded,
  };
})()`;

type Measured =
  | { error: string }
  | {
      rect: { x: number; y: number; width: number; height: number };
      issues: { path: string; message: string }[];
      folded: string[];
    };

/**
 * One Chrome, one page, reused for each preview in a composition. Closing it
 * kills Chrome and removes its profile.
 */
export class PreviewHost {
  private constructor(
    private readonly chrome: ChromeSession,
    private readonly sessionId: string,
    private readonly frameId: string,
    private readonly styles: string,
    private readonly theme: Theme,
  ) {}

  static async open(options: {
    chromePath: string;
    styles: string;
    theme: Theme;
    signal: AbortSignal;
  }): Promise<PreviewHost> {
    const chrome = await ChromeSession.launch({
      executablePath: options.chromePath,
      signal: options.signal,
    });
    try {
      const { targetId } = (await untilAborted(
        chrome.send("Target.createTarget", { url: "about:blank" }),
        options.signal,
      )) as { targetId: string };
      const { sessionId } = (await chrome.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      })) as { sessionId: string };
      // Fail every request the page makes. Inline content needs none.
      chrome.on((event) => {
        if (
          event.method === "Fetch.requestPaused" &&
          event.sessionId === sessionId
        )
          void chrome
            .send(
              "Fetch.failRequest",
              {
                requestId: event.params.requestId,
                errorReason: "BlockedByClient",
              },
              sessionId,
            )
            .catch(() => {});
      });
      await chrome.send(
        "Fetch.enable",
        { patterns: [{ urlPattern: "*" }] },
        sessionId,
      );
      await chrome.send("Page.enable", {}, sessionId);
      const tree = (await chrome.send("Page.getFrameTree", {}, sessionId)) as {
        frameTree: { frame: { id: string } };
      };
      return new PreviewHost(
        chrome,
        sessionId,
        tree.frameTree.frame.id,
        options.styles,
        options.theme,
      );
    } catch (error) {
      await chrome.close();
      throw error;
    }
  }

  private send(method: string, params: Record<string, unknown> = {}) {
    return this.chrome.send(method, params, this.sessionId);
  }

  async render(
    document: EnhancedDocument,
    workstream: DocumentWorkstream | null,
    signal: AbortSignal,
  ): Promise<PreviewRender> {
    const html = previewPage({
      document,
      workstream,
      styles: this.styles,
      theme: this.theme,
    });
    const captures: Capture[] = [];
    const diagnostics: Diagnostic[] = [];
    let folded: string[] = [];
    for (const viewport of VIEWPORTS) {
      await untilAborted(
        this.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        }),
        signal,
      );
      await untilAborted(
        this.send("Page.setDocumentContent", { frameId: this.frameId, html }),
        signal,
      );
      await untilAborted(
        this.send("Runtime.evaluate", {
          expression: "document.fonts.ready.then(() => true)",
          awaitPromise: true,
          returnByValue: true,
        }),
        signal,
      );
      const measured = (
        (await untilAborted(
          this.send("Runtime.evaluate", {
            expression: MEASURE,
            returnByValue: true,
          }),
          signal,
        )) as { result?: { value?: Measured } }
      ).result?.value;
      if (!measured || "error" in measured)
        throw new Error(
          measured?.error ?? "The preview could not be measured.",
        );
      for (const issue of measured.issues)
        diagnostics.push({ viewport: viewport.name, ...issue });
      folded = measured.folded;
      const height = Math.ceil(measured.rect.height);
      const clipHeight = Math.min(height, MAX_CAPTURE_HEIGHT);
      const shot = (await untilAborted(
        this.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: {
            x: Math.max(0, Math.floor(measured.rect.x) - 4),
            y: Math.max(0, Math.floor(measured.rect.y) - 4),
            width: Math.ceil(measured.rect.width) + 8,
            height: clipHeight + 8,
            scale: 1,
          },
        }),
        signal,
      )) as { data: string };
      captures.push({
        viewport: viewport.name,
        width: viewport.width,
        height,
        truncated: height > MAX_CAPTURE_HEIGHT,
        png: shot.data,
      });
    }
    return {
      captures,
      diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
      folded,
    };
  }

  close(): Promise<void> {
    return this.chrome.close();
  }
}
