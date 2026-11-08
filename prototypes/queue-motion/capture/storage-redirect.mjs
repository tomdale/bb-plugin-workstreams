import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { CHROME, ROOT } from "./lib.mjs";

const bundle = `${ROOT}/out/queue-lab-server.mjs`;
fs.mkdirSync(`${ROOT}/out`, { recursive: true });
await build({
  entryPoints: [
    new URL("../../../src/server/queueLab.ts", import.meta.url).pathname,
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
});
const { queueLabServer, registerQueueLab } = await import(
  pathToFileURL(bundle).href
);
const htmlPath = `${ROOT}/dist/queue-motion.html`;
const probe = http.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const lab = queueLabServer(pathToFileURL(htmlPath), port);
let handler;
const dispose = [];
registerQueueLab(
  {
    http: {
      route(_method, _path, run) {
        handler = run;
      },
    },
    background: { service() {} },
    storage: { kv: { async set() {} } },
    sdk: {
      environments: {
        async get() {
          return { path: "/fixture", hostId: "host_test" };
        },
      },
      files: {
        async read() {
          return {
            sha256: createHash("sha256")
              .update(fs.readFileSync(htmlPath))
              .digest("hex"),
          };
        },
      },
    },
    onDispose(run) {
      dispose.push(run);
    },
  },
  lab,
);
const file =
  "/api/v1/environments/env_test/files/prototypes/queue-motion/dist/queue-motion.html";
const launch = "/api/v1/plugins/workstreams/http/queue-motion";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === file) {
    res.writeHead(200, {
      "content-type": "text/html",
      "content-security-policy": "sandbox allow-scripts",
    });
    res.end(fs.readFileSync(htmlPath));
  } else if (url.pathname === launch) {
    const response = await handler({
      req: {
        url: url.href,
        query: (name) => url.searchParams.get(name) ?? undefined,
      },
      redirect: (location, status) =>
        new Response(null, { status, headers: { location } }),
      text: (body, status) => new Response(body, { status }),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } else if (url.pathname === "/preview") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      `<button id="open">Open in external browser</button><iframe id="lab" sandbox="allow-scripts" src="${file}#v=drum&preset=natural&cap=1800"></iframe><script>window.reportedHash = ''; addEventListener('message', e => { if (e.source === document.getElementById('lab').contentWindow && e.origin === 'null' && e.data?.type === 'bb:html-preview-hash') window.reportedHash = e.data.hash }); document.getElementById('open').onclick = () => window.open(${JSON.stringify(file)} + window.reportedHash, '_blank')</script>`,
    );
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
try {
  await page.goto(`${origin}${file}#v=drum&preset=natural&cap=1800&sway=40`);
  await page.locator('input[data-k="cap"]').waitFor();
  assert.equal(new URL(page.url()).origin, lab.origin);
  assert.equal(await page.locator('input[data-k="cap"]').inputValue(), "1800");
  assert.equal(await page.locator('input[data-k="sway"]').inputValue(), "40");
  await page.locator('[data-act="save"]').click();
  await page.locator("#preset-name").fill("fast");
  await page.locator('[data-act="save"]').click();
  assert.equal(await page.locator("#save-note").textContent(), "Saved “fast”.");
  await lab.close();
  await lab.start();
  await page.reload();
  await page.locator('[data-act="p:fold"]').click();
  await page.locator('#saved-chips [data-act="u:0"]').click();
  assert.equal(await page.locator('input[data-k="cap"]').inputValue(), "1800");
  await page.locator('input[data-k="cap"]').evaluate((input) => {
    input.value = "2100";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator('[data-act="save"]').click();
  await page.locator("#preset-name").fill("fast");
  await page.locator('[data-act="save"]').click();
  assert.equal(
    await page.locator("#save-note").textContent(),
    "Replaced “fast”.",
  );
  await page.reload();
  await page.locator('#saved-chips [data-act="u:0"]').click();
  assert.equal(await page.locator('input[data-k="cap"]').inputValue(), "2100");
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.locator('[data-act="save"]').click();
  await page.locator("#preset-name").fill("denied");
  await page.locator('[data-act="save"]').click();
  assert.equal(
    await page.locator("#save-note").textContent(),
    "This browser would not store the preset.",
  );
  await page.locator('#saved-chips [data-act="ud:0"]').click();
  assert.equal(
    await page.locator("#save-note").textContent(),
    "This browser would not delete the preset.",
  );
  assert.equal(await page.locator('#saved-chips [data-act^="u:"]').count(), 1);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem;
  });
  await page.locator('#saved-chips [data-act="ud:0"]').click();
  assert.equal(
    await page.locator("#save-note").textContent(),
    "Deleted “fast”.",
  );
  await page.reload();
  assert.equal(await page.locator('#saved-chips [data-act^="u:"]').count(), 0);
  console.log(
    "ok BB-style raw link redirects, preserves hash, and saves, restores, replaces and deletes across reloads",
  );

  await page.goto(`${origin}/preview`);
  const frame = page.frameLocator("iframe");
  await frame.locator('[data-act="save"]').click();
  await frame.locator("#preset-name").fill("blocked");
  await frame.locator('[data-act="save"]').click();
  assert.equal(
    await frame.locator("#save-note").textContent(),
    "Open in external browser to save presets.",
  );
  await frame.locator('input[data-k="cap"]').evaluate((input) => {
    input.value = "2280";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => window.reportedHash.includes("cap=2280"));
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#open").click();
  const popup = await popupPromise;
  await popup.locator('input[data-k="cap"]').waitFor();
  assert.equal(new URL(popup.url()).origin, lab.origin);
  assert.equal(await popup.locator('input[data-k="cap"]').inputValue(), "2280");
  await popup.close();
  assert.equal(page.frames().length, 2);
  console.log(
    "ok sandboxed preview opens the isolated lab with its current settings",
  );
} finally {
  await browser.close();
  await Promise.all(dispose.map((run) => run()));
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(bundle, { force: true });
}
