import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PreviewHost,
  previewPage,
  VIEWPORTS,
  type Theme,
} from "../../../src/server/inference/presentation/preview.ts";
import { findChrome } from "../../../src/server/inference/presentation/chrome.ts";
import { CORRECTION, DEPLOYED_CHANGE } from "../../fixtures/postTurn.ts";
import type { EnhancedDocument } from "../../../src/domain/postTurn/document.ts";
import { previewStyles } from "./preview-styles.ts";

const chromePath = findChrome();
/** Set to a directory to keep the captures for inspection. */
const keep = process.env.WS_PREVIEW_CAPTURES;

function pngSize(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("preview page", () => {
  it("is static markup with no script and a policy that blocks fetches", () => {
    const html = previewPage({
      document: DEPLOYED_CHANGE,
      topic: { name: "Snooze", color: null },
      styles: "body{}</style><script>alert(1)</script>",
      theme: "light",
    });
    // The stylesheet cannot close its own element and start a script.
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html).not.toMatch(/<\/style><script/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain(">Snooze</span>");
  });

  it("renders document text as text, never as markup", () => {
    const html = previewPage({
      document: {
        version: 1,
        blocks: [
          {
            type: "paragraph",
            text: [{ code: "<img src=x onerror=alert(1)>" }],
          },
        ],
      },
      topic: null,
      styles: "",
      theme: "light",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe.skipIf(!chromePath)("preview host", () => {
  let styles = "";
  const hosts: PreviewHost[] = [];
  beforeAll(async () => {
    styles = await previewStyles();
  }, 60_000);
  afterAll(async () => {
    await Promise.all(hosts.map((host) => host.close()));
  });
  const open = async (theme: Theme = "light") => {
    const host = await PreviewHost.open({
      chromePath: chromePath!,
      styles,
      theme,
      signal: AbortSignal.timeout(20_000),
    });
    hosts.push(host);
    return host;
  };
  const render = (
    host: PreviewHost,
    document: EnhancedDocument,
    name: string,
  ) =>
    host
      .render(
        document,
        { name: "Workstreams › Snooze", color: { hue: 25, level: 0 } },
        AbortSignal.timeout(20_000),
      )
      .then((result) => {
        if (keep) {
          mkdirSync(keep, { recursive: true });
          for (const capture of result.captures)
            writeFileSync(
              join(keep, `${name}-${capture.viewport}.png`),
              Buffer.from(capture.png, "base64"),
            );
        }
        return result;
      });

  it("captures each fixed width and reports what each capture covers", async () => {
    const host = await open();
    const result = await render(host, DEPLOYED_CHANGE, "deployed-light");
    expect(result.captures.map((c) => [c.viewport, c.width])).toEqual(
      VIEWPORTS.map((v) => [v.name, v.width]),
    );
    for (const capture of result.captures) {
      const size = pngSize(capture.png);
      expect(size.width).toBeLessThanOrEqual(capture.width);
      expect(size.width).toBeGreaterThan(capture.width / 2);
      expect(capture.truncated).toBe(false);
    }
    const [desktop, narrow] = result.captures;
    // The narrow column wraps the same content onto more lines.
    expect(narrow!.height).toBeGreaterThan(desktop!.height);
    // The passing checks are drawn folded; the text form carries the rows.
    expect(result.folded).toEqual(["blocks[0].blocks[3]"]);
    expect(result.diagnostics).toEqual([]);
  }, 60_000);

  it("reuses one page across previews, in the dark theme too", async () => {
    const host = await open("dark");
    const first = await render(host, CORRECTION, "correction-dark");
    const second = await render(host, DEPLOYED_CHANGE, "deployed-dark");
    expect(first.captures).toHaveLength(2);
    expect(second.folded).toEqual(["blocks[0].blocks[3]"]);
  }, 60_000);

  it("reports a table that scrolls sideways at the narrow width", async () => {
    const host = await open();
    const wide: EnhancedDocument = {
      version: 1,
      blocks: [
        {
          type: "table",
          columns: ["Path", "Before", "After", "Change", "Owner", "Notes"],
          rows: [
            [
              [{ code: "src/server/inference/presentation/preview.ts" }],
              1200,
              1350,
              150,
              "Preview",
              [{ code: "renderToStaticMarkup(createElement(DocumentView))" }],
            ],
          ],
        },
      ],
    };
    const result = await render(host, wide, "wide-table");
    expect(
      result.diagnostics.some(
        (d) =>
          d.viewport === "narrow" &&
          d.path === "blocks[0]" &&
          d.message.startsWith("Scrolls sideways"),
      ),
    ).toBe(true);
  }, 60_000);

  it("stops at the signal", async () => {
    const host = await open();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      host.render(DEPLOYED_CHANGE, null, controller.signal),
    ).rejects.toThrow("cancelled");
  }, 60_000);
});
