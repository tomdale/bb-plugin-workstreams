import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  engines: Record<string, string>;
  devDependencies: Record<string, string>;
};

it("loads on upstream bb: engines ask only for what the non-fork features need", () => {
  // The fork's message-block slot is feature-detected at load, not required.
  expect(pkg.engines).toEqual({ bb: ">=0.44", bbPluginSdk: ">=0.6.5" });
});

it("builds against a published SDK, not a fork build", () => {
  const sdk = pkg.devDependencies["@get-bb/plugin-sdk"]!;
  expect(sdk).toMatch(/^\d+\.\d+\.\d+$/);
  // 0.6.100 and up exist only as tomdale/bb fork builds today.
  const [, minor, patch] = sdk.split(".").map(Number);
  expect(minor === 6 && patch! >= 100).toBe(false);
});
