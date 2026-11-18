import { describe, expect, it } from "vitest";
import { splitFilePatches } from "../../../src/app/question/artifact-patch.ts";

describe("splitFilePatches", () => {
  it("splits git diff output into one patch per file, keeping a preamble", () => {
    const split = splitFilePatches(
      [
        "Add the summary",
        "",
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/docs/b.md b/docs/b.md",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/docs/b.md",
        "@@ -0,0 +1 @@",
        "+hello",
      ].join("\n"),
      "Change",
    );
    expect(split.preamble).toBe("Add the summary");
    expect(split.files.map((file) => file.path)).toEqual([
      "src/a.ts",
      "docs/b.md",
    ]);
    expect(split.files[0]?.patch).toBe(
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
    expect(split.files[1]?.patch.startsWith("diff --git a/docs/b.md")).toBe(
      true,
    );
  });

  it("names a deleted file by its old side", () => {
    const split = splitFilePatches(
      "--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n",
      "Change",
    );
    expect(split.files).toEqual([
      {
        path: "gone.ts",
        patch: "--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n",
      },
    ]);
  });

  it("splits bare patches at ---/+++ pairs, not at removed lines inside hunks", () => {
    const split = splitFilePatches(
      [
        "--- a/one.ts",
        "+++ b/one.ts",
        "@@ -1,2 +1 @@",
        "--- a comment",
        " kept",
        "--- a/two.ts",
        "+++ b/two.ts",
        "@@ -1 +1 @@",
        "-x",
        "+y",
      ].join("\n"),
      "Change",
    );
    expect(split.preamble).toBeNull();
    expect(split.files.map((file) => file.path)).toEqual(["one.ts", "two.ts"]);
    expect(split.files[0]?.patch).toContain("--- a comment");
  });

  it("treats a lone hunk as one file named by the fallback path", () => {
    expect(splitFilePatches("@@ -1 +1 @@\n-a\n+b", "src/x.ts")).toEqual({
      preamble: null,
      files: [{ path: "src/x.ts", patch: "@@ -1 +1 @@\n-a\n+b\n" }],
    });
  });
});
