/**
 * Keeps every path to a provider behind the usage gate. Each primitive that
 * can spend may appear only in the files listed for it, the listed number of
 * times, and every file that holds the gate must both ask it and report to it.
 *
 * A new site fails here. Route it through `UsageGate` (`admit` before the
 * spend, `record` after, in the file that decides to spend), then list it
 * below with the reason it is accounted for.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

/** Files that decide to spend; each asks the gate and reports to it. */
const GATED: Record<string, string> = {
  "src/server/model.ts": "every Inference call, gateway and worker paths",
  "src/server/index.ts": "enhanced-response composition and debug threads",
  "src/server/recap.ts": "recap reminders and waiting checks",
};

/** `file: [occurrences, why each is accounted for]` */
type Sites = Record<string, [number, string]>;
const PRIMITIVES: { name: string; pattern: RegExp; sites: Sites }[] = [
  {
    name: "the AI Gateway host name",
    pattern: /ai-gateway\.vercel\.sh/g,
    sites: {
      "src/server/inference/gateway.ts": [
        2,
        "the completion transport, reached only through gatewayComplete(",
      ],
      "src/server/inference/presentation/gatewayModel.ts": [
        1,
        "the composition's model client, reached only through gatewayToolModel(",
      ],
    },
  },
  {
    name: "gatewayComplete(",
    pattern: /\bgatewayComplete\(/g,
    sites: {
      "src/server/inference/gateway.ts": [1, "its definition"],
      "src/server/inference/host.ts": [
        1,
        "the machine's `complete` handler, reached only through hostRpc.call(",
      ],
    },
  },
  {
    name: "gatewayToolModel(",
    pattern: /\bgatewayToolModel\(/g,
    sites: {
      "src/server/inference/presentation/gatewayModel.ts": [
        1,
        "its definition",
      ],
      "src/server/inference/presentation/host.ts": [
        1,
        "the machine's `present` handler, reached only through hostRpc.call(",
      ],
    },
  },
  {
    name: "runWorker and its import alias",
    pattern: /\b(runWorker|completeWithWorker)\b/g,
    sites: {
      "src/server/inference/worker.ts": [1, "its definition"],
      "src/server/index.ts": [
        3,
        "imported once and called once, inside Inference's `complete`, which model.ts gates",
      ],
    },
  },
  {
    name: "threads.spawn(",
    pattern: /threads\s*\.spawn\(/g,
    sites: {
      "src/server/inference/worker.ts": [
        1,
        "the worker thread runWorker starts",
      ],
      "src/server/index.ts": [1, "the debug thread, gated where it is spawned"],
    },
  },
  {
    name: "the machine RPC client",
    pattern: /hostRpc\.call\(|experimental_client\(/g,
    sites: {
      "src/server/index.ts": [
        4,
        "the client, `complete` inside Inference's `complete`, `present` inside composePresentation, and `readPullRequests`, a GitHub status read that spends no provider money",
      ],
    },
  },
  {
    name: "threads.send(",
    pattern: /threads\s*\.send\(/g,
    sites: {
      "src/server/recap.ts": [
        3,
        "a reminder and a waiting check, both gated; and sendNext, the user's own message",
      ],
      "src/server/index.ts": [
        1,
        "threadSend: the user's own message from the Workstreams page",
      ],
      "src/server/questions/store.ts": [
        1,
        "the user's answer to a question, delivered as their message",
      ],
      "src/server/postTurn/planOutcomes.ts": [
        1,
        "the user's Approve or suggested reply on a plan, delivered as their message",
      ],
    },
  },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}
const files = new Map(
  sources(join(ROOT, "src")).map((path) => [
    relative(ROOT, path),
    readFileSync(path, "utf8"),
  ]),
);

describe("paths to a provider", () => {
  it.each(PRIMITIVES)(
    "$name appears only where listed",
    ({ name, pattern, sites }) => {
      const found: Record<string, number> = {};
      for (const [file, text] of files) {
        const count = text.match(pattern)?.length ?? 0;
        if (count) found[file] = count;
      }
      const expected = Object.fromEntries(
        Object.entries(sites).map(([file, [count]]) => [file, count]),
      );
      expect(
        found,
        `${name} appears somewhere new or a different number of times. Route the new site through UsageGate (admit before it spends, record after) and list it in tests/server/usage-instrumentation.test.ts with the reason it is accounted for.`,
      ).toEqual(expected);
    },
  );

  it.each(Object.keys(GATED))("%s asks the gate and reports to it", (file) => {
    const text = files.get(file) ?? "";
    expect(text, `${file} no longer asks the spend guard`).toMatch(
      /usage(Gate)?\s*\.admit\(/,
    );
    expect(text, `${file} no longer records usage`).toMatch(
      /usage(Gate)?\s*\.record\(/,
    );
  });
});
