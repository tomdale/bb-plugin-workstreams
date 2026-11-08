import { createServer, request } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { queueLabServer, registerQueueLab } from "../../src/server/queueLab.ts";

describe("the isolated queue lab origin", () => {
  it("serves only the built lab and closes its listener", async () => {
    const dir = await mkdtemp(join(tmpdir(), "queue-lab-"));
    const path = join(dir, "lab.html");
    await writeFile(path, "<!doctype html><title>Queue lab</title>");
    const lab = queueLabServer(pathToFileURL(path), 0);
    let origin = "";
    try {
      await Promise.all([lab.start(), lab.start()]);
      origin = lab.origin;
      const response = await fetch(`${lab.origin}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Queue lab");
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect((await fetch(`${lab.origin}/other`)).status).toBe(404);
      expect((await fetch(`${lab.origin}/`, { method: "POST" })).status).toBe(
        404,
      );
      const foreignHost = await new Promise<number | undefined>(
        (resolve, reject) => {
          const req = request(
            `${lab.origin}/`,
            { headers: { host: "example.test" } },
            (res) => {
              res.resume();
              resolve(res.statusCode);
            },
          );
          req.on("error", reject);
          req.end();
        },
      );
      expect(foreignHost).toBe(404);
      await rm(path);
      expect((await fetch(`${lab.origin}/`)).status).toBe(503);
    } finally {
      await lab.close();
      await rm(dir, { recursive: true, force: true });
    }
    await expect(fetch(`${origin}/`)).rejects.toThrow();
  });

  it("redirects local requests only after the isolated listener starts and disposes it", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "workstreams" });
    const lab = queueLabServer(new URL(import.meta.url), 0);
    harness.sdk.stub("environments.get", async () => ({
      path: "/fixture",
      hostId: "host_1",
    }));
    harness.sdk.stub("files.read", async () => ({
      sha256: await lab.fingerprint(),
    }));
    registerQueueLab(bb, lab);
    const remote = await harness.behavior.fetchHttp(
      "GET",
      "https://example.test/queue-motion",
    );
    expect(remote.status).toBe(403);
    const missing = await harness.behavior.fetchHttp(
      "GET",
      "http://127.0.0.1/queue-motion",
    );
    expect(missing.status).toBe(400);
    harness.sdk.stub("files.read", async () => ({ sha256: "wrong" }));
    const mismatch = await harness.behavior.fetchHttp(
      "GET",
      "http://127.0.0.1/queue-motion?environment=env_test",
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.headers.get("location")).toBeNull();
    harness.sdk.stub("files.read", async () => ({
      sha256: await lab.fingerprint(),
    }));
    const [response, second] = await Promise.all([
      harness.behavior.fetchHttp(
        "GET",
        "http://127.0.0.1/queue-motion?environment=env_test",
      ),
      harness.behavior.fetchHttp(
        "GET",
        "http://127.0.0.1/queue-motion?environment=env_test",
      ),
    ]);
    expect(response.status).toBe(302);
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe(
      response.headers.get("location"),
    );
    expect(response.headers.get("location")).toBe(`${lab.origin}/`);
    expect(harness.sdk.callsTo("files.read").at(-1)?.[0]).toEqual({
      hostId: "host_1",
      rootPath: "/fixture",
      path: "/fixture/prototypes/queue-motion/dist/queue-motion.html",
    });
    harness.sdk.stub("environments.get", async () => ({
      path: "C:\\fixture",
      hostId: "host_1",
    }));
    const windows = await harness.behavior.fetchHttp(
      "GET",
      "http://127.0.0.1/queue-motion?environment=env_test",
    );
    expect(windows.status).toBe(302);
    expect(harness.sdk.callsTo("files.read").at(-1)?.[0]).toEqual({
      hostId: "host_1",
      rootPath: "C:\\fixture",
      path: "C:\\fixture\\prototypes\\queue-motion\\dist\\queue-motion.html",
    });
    await lab.close();
    const service = harness.behavior.runService("queue-motion-lab");
    await vi.waitFor(async () =>
      expect((await fetch(`${lab.origin}/`)).status).toBe(200),
    );
    const origin = lab.origin;
    service.controller.abort();
    await service.done;
    await harness.lifecycle.dispose();
    await expect(fetch(`${origin}/`)).rejects.toThrow();
    await expect(lab.start()).rejects.toThrow("stopped");
  });

  it("fails closed when another process holds the port", async () => {
    const other = createServer();
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const port = (other.address() as { port: number }).port;
    const lab = queueLabServer(new URL(import.meta.url), port);
    const { bb, harness } = createFakePluginHost({ pluginId: "workstreams" });
    harness.sdk.stub("environments.get", async () => ({
      path: "/fixture",
      hostId: "host_1",
    }));
    harness.sdk.stub("files.read", async () => ({
      sha256: await lab.fingerprint(),
    }));
    registerQueueLab(bb, lab);
    try {
      const response = await harness.behavior.fetchHttp(
        "GET",
        "http://127.0.0.1/queue-motion?environment=env_test",
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("location")).toBeNull();
    } finally {
      await harness.lifecycle.dispose();
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });
});
