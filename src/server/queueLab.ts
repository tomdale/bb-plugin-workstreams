import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const QUEUE_LAB_PORT = 38906;
const MAX_LAB_BYTES = 5 * 1024 * 1024;
const LAB_FILE = new URL(
  "../../prototypes/queue-motion/dist/queue-motion.html",
  import.meta.url,
);

/** Serves only the built lab on a separate loopback origin, never BB's authenticated API. */
export function queueLabServer(file: URL = LAB_FILE, port = QUEUE_LAB_PORT) {
  let server: Server | null = null;
  let starting: Promise<void> | null = null;
  let disposed = false;
  const load = async () => {
    const data = await readFile(file);
    if (data.length > MAX_LAB_BYTES)
      throw new Error("The queue motion lab is too large.");
    return data;
  };
  const boundPort = () => {
    const address = server?.address();
    return address && typeof address !== "string" ? address.port : port;
  };
  const start = () => {
    if (disposed)
      return Promise.reject(new Error("The queue motion lab is stopped."));
    if (server?.listening) return Promise.resolve();
    if (starting) return starting;
    const next = createServer(async (req, res) => {
      if (
        req.headers.host !== `127.0.0.1:${boundPort()}` ||
        req.url !== "/" ||
        !["GET", "HEAD"].includes(req.method ?? "")
      ) {
        res.writeHead(404).end();
        return;
      }
      try {
        const body = await load();
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'none'",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        res
          .writeHead(503, { "content-type": "text/plain; charset=utf-8" })
          .end("The built queue motion lab is unavailable.");
      }
    });
    starting = load()
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            next.once("error", reject);
            next.listen(port, "127.0.0.1", () => {
              next.removeListener("error", reject);
              server = next;
              resolve();
            });
          }),
      )
      .finally(() => {
        starting = null;
      });
    return starting;
  };
  const close = async () => {
    await starting?.catch(() => {});
    const running = server;
    server = null;
    if (running)
      await new Promise<void>((resolve) => running.close(() => resolve()));
  };
  return {
    get origin() {
      return `http://127.0.0.1:${boundPort()}`;
    },
    fingerprint: async () =>
      createHash("sha256")
        .update(await load())
        .digest("hex"),
    start,
    close,
    dispose: async () => {
      disposed = true;
      await close();
    },
  };
}

export function registerQueueLab(bb: BbPluginApi, lab = queueLabServer()) {
  let active = false;
  let activating: Promise<void> | null = null;
  const activate = () => {
    if (activating) return activating;
    activating = (async () => {
      await lab.start();
      if (active) return;
      try {
        await bb.storage.kv.set("queue-motion-lab-active", true);
        active = true;
      } catch (error) {
        await lab.close();
        throw error;
      }
    })().finally(() => {
      activating = null;
    });
    return activating;
  };
  bb.background.service("queue-motion-lab", {
    async start(signal) {
      if ((await bb.storage.kv.get("queue-motion-lab-active")) === true) {
        active = true;
        try {
          await lab.start();
        } catch (error) {
          bb.log.warn(`Queue motion lab could not start: ${String(error)}`);
        }
      }
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await lab.close();
    },
  });
  bb.http.route("GET", "/queue-motion", async (context) => {
    const host = new URL(context.req.url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost")
      return context.text(
        "Open the queue motion lab on the machine running BB.",
        403,
      );
    const environmentId = context.req.query("environment");
    if (!environmentId || !/^env_[a-zA-Z0-9]+$/.test(environmentId))
      return context.text(
        "The queue motion lab's environment is missing.",
        400,
      );
    try {
      const environment = await bb.sdk.environments.get({ environmentId });
      if (!environment.path || !environment.hostId)
        return context.text(
          "The queue motion lab's environment is unavailable.",
          409,
        );
      const windows = /^[a-zA-Z]:[\\/]|^\\\\/.test(environment.path);
      const path = (windows ? win32 : posix).join(
        environment.path,
        "prototypes/queue-motion/dist/queue-motion.html",
      );
      const source = await bb.sdk.files.read({
        hostId: environment.hostId,
        path,
        rootPath: environment.path,
      });
      if (source.sha256 !== (await lab.fingerprint()))
        return context.text(
          "This lab differs from the installed Workstreams lab. Build the installed lab before opening it here.",
          409,
        );
      await activate();
      return context.redirect(`${lab.origin}/`, 302);
    } catch {
      return context.text(
        "The queue motion lab is unavailable. Build the lab and check that its local port is free.",
        503,
      );
    }
  });
  bb.onDispose(() => lab.dispose());
}
