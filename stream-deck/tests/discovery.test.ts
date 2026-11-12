import { describe, expect, it, vi } from "vitest";
import {
  discover,
  DiscoveryError,
  serverOrigin,
  type DiscoveryIo,
} from "../src/discovery.ts";

const RUNTIME = {
  entryPath:
    "/Applications/Example BB.app/Contents/Resources/app.asar.unpacked/dist/bb-app-bridge.mjs",
  serverUrl: "http://127.0.0.1:40000",
  surface: "desktop",
};

function io(
  files: Record<string, unknown>,
  run: DiscoveryIo["run"] = async () =>
    JSON.stringify({ ok: true, token: "cli-token" }),
  env: Record<string, string> = {},
): DiscoveryIo {
  return {
    env: { PATH: "/usr/bin", ...env },
    home: "/Users/me",
    platform: "darwin",
    readJson: async (path) => files[path] ?? null,
    run,
  };
}

describe("discover", () => {
  it("reads the server from BB's config and the token from the bb CLI", async () => {
    const run = vi.fn(async () =>
      JSON.stringify({ ok: true, token: "cli-token" }),
    );
    const found = await discover(
      {},
      io(
        {
          "/Users/me/.bb/config.json": { serverUrl: "http://127.0.0.1:38886/" },
          "/Users/me/.bb/bb-app-runtime.json": RUNTIME,
        },
        run,
      ),
    );
    expect(found).toEqual({
      serverUrl: "http://127.0.0.1:38886",
      token: "cli-token",
      tokenFromSettings: false,
      app: "/Applications/Example BB.app",
    });
    expect(run).toHaveBeenCalledWith(
      "/Users/me/.bb/bin/bb",
      ["plugin", "token", "workstreams", "--json"],
      expect.objectContaining({
        BB_DATA_DIR: "/Users/me/.bb",
        BB_SERVER_URL: "http://127.0.0.1:38886",
      }),
    );
  });

  it("uses the settings over what it finds, and BB_DATA_DIR over the home directory", async () => {
    const run = vi.fn(async () => "");
    const found = await discover(
      { serverUrl: " https://bb.example.com ", token: " mine " },
      io({ "/data/bb-app-runtime.json": { ...RUNTIME, surface: "web" } }, run, {
        BB_DATA_DIR: "/data",
      }),
    );
    expect(found).toEqual({
      serverUrl: "https://bb.example.com",
      token: "mine",
      tokenFromSettings: true,
      app: null,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back to the desktop app's server when BB's config has none", async () => {
    const found = await discover(
      {},
      io({ "/Users/me/.bb/bb-app-runtime.json": RUNTIME }),
    );
    expect(found.serverUrl).toBe("http://127.0.0.1:40000");
  });

  it("says whether BB or its token is what's missing", async () => {
    await expect(discover({}, io({}))).rejects.toMatchObject({
      reason: "no-bb",
    });
    const files = { "/Users/me/.bb/bb-app-runtime.json": RUNTIME };
    for (const run of [
      async () => {
        throw new Error("ENOENT");
      },
      async () => "not json",
      async () => JSON.stringify({ ok: false }),
    ]) {
      const error = await discover({}, io(files, run)).catch((e) => e);
      expect(error).toBeInstanceOf(DiscoveryError);
      expect(error.reason).toBe("no-token");
    }
  });
});

it("accepts only http and https server URLs", () => {
  expect(serverOrigin("http://127.0.0.1:38886/")).toBe(
    "http://127.0.0.1:38886",
  );
  expect(serverOrigin("https://host/bb/")).toBe("https://host/bb");
  expect(serverOrigin("file:///etc")).toBeNull();
  expect(serverOrigin("not a url")).toBeNull();
  expect(serverOrigin("")).toBeNull();
});
