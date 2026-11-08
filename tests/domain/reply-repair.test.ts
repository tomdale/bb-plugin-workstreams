import { describe, expect, it } from "vitest";
import { parse, type Reply } from "../../src/domain/reply.ts";
import { compileComponents } from "../../src/domain/replyCompile.ts";
import type { ReplyComponent } from "../../src/domain/replyComponents.ts";
import { formatComponent } from "../../src/domain/replyFormat.ts";
import { blockInput } from "./replyFixtures.ts";

/** The single component a statement compiles to; fails the test otherwise. */
function one(source: string): ReplyComponent {
  const items = compileComponents(source);
  if (items.length !== 1) throw new Error(`expected one, got ${items.length}`);
  const [item] = items;
  if (!item!.ok) throw new Error(item!.error);
  return item!.component;
}
function read(message: string): Reply {
  const result = parse(blockInput(message));
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const checks = (items: string, extra = "") =>
  one(`checks(title: "T", scope: "S", ${extra}items: [${items}])`);
const status = (word: string) =>
  (checks(`{name: "N", status: ${word}}`) as { items: { status: string }[] })
    .items[0]!.status;
const stage = (word: string) =>
  (
    one(
      `delivery(title: "T", scope: "S", stages: [{name: "N", status: ${word}}])`,
    ) as { stages: { status: string }[] }
  ).stages[0]!.status;

describe("liberal component input", () => {
  describe("strings", () => {
    it("reads single, backtick, and curly quotes", () => {
      expect(one("text(body: 'single')")).toEqual({
        type: "text",
        body: "single",
      });
      expect(one("text(body: `tick`)")).toMatchObject({ body: "tick" });
      expect(one("text(body: \u201ccurly\u201d)")).toMatchObject({
        body: "curly",
      });
      expect(one("text(body: 'it's here')")).toMatchObject({
        body: "it's here",
      });
    });

    it("keeps unescaped inner quotes as text", () => {
      expect(one('text(body: "He said "hi" to me")')).toMatchObject({
        body: 'He said "hi" to me',
      });
    });

    it("lets a double-quoted string span lines", () => {
      expect(one('text(body: "line one\nline two")')).toMatchObject({
        body: "line one\nline two",
      });
    });

    it("keeps unknown escapes literally", () => {
      expect(one('text(body: "a \\d+ b \\* c \\\' d")')).toMatchObject({
        body: "a \\d+ b \\* c ' d",
      });
    });

    it('dedents an indented """ block', () => {
      const source = [
        "details(",
        '  title: "T",',
        '  body: """',
        "      First line",
        "",
        "        indented more",
        '    """,',
        ")",
      ].join("\n");
      expect(one(source)).toMatchObject({
        body: "First line\n\n  indented more",
      });
      expect(one('details(title: "T", body: """one\n   two""")')).toMatchObject(
        { body: "one\ntwo" },
      );
      expect(one("details(title: 'T', body: '''a\nb''')")).toMatchObject({
        body: "a\nb",
      });
    });

    it("still round-trips text whose every line is indented", () => {
      const component: ReplyComponent = {
        type: "details",
        title: "T",
        body: "    code line\n    another",
      };
      expect(one(formatComponent(component))).toEqual(component);
    });
  });

  describe("unquoted text", () => {
    it("reads unquoted text up to the next field", () => {
      expect(
        one("change(title: Fix the bug, before: It crashed, after: It works)"),
      ).toEqual({
        type: "change",
        title: "Fix the bug",
        before: "It crashed",
        after: "It works",
      });
    });

    it("keeps commas, apostrophes, punctuation, and symbols in unquoted text", () => {
      expect(one("text(body: Tom's fix, finally, works.)")).toMatchObject({
        body: "Tom's fix, finally, works.",
      });
      expect(one("text(body: see src/app.ts and README.md)")).toMatchObject({
        body: "see src/app.ts and README.md",
      });
      expect(one("text(body: ✓ shipped)")).toMatchObject({
        body: "✓ shipped",
      });
      expect(one("text(body: **bold** text, then more)")).toMatchObject({
        body: "**bold** text, then more",
      });
      expect(one("text(body: Fix (the) bug)")).toMatchObject({
        body: "Fix (the) bug",
      });
      expect(one("text(body: 1901 passed, 1 skipped)")).toMatchObject({
        body: "1901 passed, 1 skipped",
      });
    });

    it("reads a single bare word, number, or boolean as text", () => {
      expect(one("text(body: hello)")).toMatchObject({ body: "hello" });
      expect(one("text(body: 3)")).toMatchObject({ body: "3" });
      expect(one("text(body: true)")).toMatchObject({ body: "true" });
    });

    it("joins a list of text into paragraphs", () => {
      expect(one('text(body: ["One.", "Two."])')).toMatchObject({
        body: "One.\n\nTwo.",
      });
    });
  });

  describe("punctuation", () => {
    it("accepts trailing, doubled, and leading commas", () => {
      expect(one('text(, body: "a",,)')).toMatchObject({ body: "a" });
      expect(
        one('sequence(title: "T", steps: [{title: "a"},, {title: "b"},])'),
      ).toMatchObject({ steps: [{ title: "a" }, { title: "b" }] });
    });

    it("accepts missing commas between fields and list entries", () => {
      expect(one('change(title: "T" before: "B"\n after: "A")')).toMatchObject({
        title: "T",
        before: "B",
        after: "A",
      });
      expect(
        one('sequence(title: "T", steps: [{title: "a"} {title: "b"}])'),
      ).toMatchObject({ steps: [{ title: "a" }, { title: "b" }] });
    });

    it("accepts = for : and semicolons for commas", () => {
      expect(one('change(title = "T"; before = "B"; after = "A")')).toEqual({
        type: "change",
        title: "T",
        before: "B",
        after: "A",
      });
    });

    it("accepts quoted argument names", () => {
      expect(one('text("body": "a")')).toMatchObject({ body: "a" });
    });

    it("reads several components on one line, separated or not", () => {
      const items = compileComponents(
        'text(body: "a"); text(body: "b") text(body: "c")',
      );
      expect(items.map((i) => i.ok && i.component)).toEqual([
        { type: "text", body: "a" },
        { type: "text", body: "b" },
        { type: "text", body: "c" },
      ]);
    });

    it("skips // comments", () => {
      expect(
        compileComponents('// overview\ntext(body: "a") // trailing\n'),
      ).toEqual([{ ok: true, component: { type: "text", body: "a" } }]);
    });

    it("reads a call written with a space before its parenthesis", () => {
      expect(one('text (body: "a")')).toMatchObject({ body: "a" });
    });
  });

  describe("names", () => {
    it("matches component names regardless of case, synonyms, and small misspellings", () => {
      expect(one('Text(body: "a")')).toMatchObject({ type: "text" });
      expect(
        one(
          'CHECKS(title: "T", scope: "S", items: [{name: "N", status: passed}])',
        ),
      ).toMatchObject({ type: "checks" });
      expect(one('prose(body: "a")')).toMatchObject({ type: "text" });
      expect(one('chnge(title: "T", before: "B", after: "A")')).toMatchObject({
        type: "change",
      });
    });

    it("matches field names regardless of case and separators", () => {
      expect(
        checks(
          '{name: "N", status: passed}',
          "test_totals: {Passed: 1, FAILED: 0, skipped: 0}, ",
        ),
      ).toMatchObject({ testTotals: { passed: 1, failed: 0, skipped: 0 } });
    });

    it("maps unambiguous misspellings and synonyms onto fields", () => {
      expect(one('change(titel: "T", befor: "B", after: "A")')).toMatchObject({
        title: "T",
        before: "B",
      });
      expect(
        one('sequence(title: "T", steps: [{name: "a", description: "d"}])'),
      ).toMatchObject({ steps: [{ title: "a", detail: "d" }] });
      expect(
        checks(
          '{title: "N", state: ok, evidence: [{text: "log", url: "https://x.dev/log"}]}',
          "totals: {pass: 3, fail: 0, skip: 1}, ",
        ),
      ).toMatchObject({
        testTotals: { passed: 3, failed: 0, skipped: 1 },
        items: [
          {
            name: "N",
            status: "passed",
            evidence: [{ label: "log", location: "https://x.dev/log" }],
          },
        ],
      });
    });

    it("does not let a synonym take a field the writer named outright", () => {
      expect(
        one('sequence(title: "T", steps: [{name: "x", title: "a"}])'),
      ).toMatchObject({ steps: [{ title: "a" }] });
    });

    it("drops unknown fields and a type field", () => {
      expect(
        one('text(type: "text", id: 7, body: "a", flavor: "mint")'),
      ).toEqual({ type: "text", body: "a" });
    });

    it("explains a dropped field when the component still fails", () => {
      const [item] = compileComponents('text(contnt_body: "a")');
      expect(item).toMatchObject({
        ok: false,
        error: expect.stringContaining('text has no field "contnt_body"'),
      });
    });

    it("accepts a repeated field only when both values agree", () => {
      expect(one('text(body: "a", body: "a")')).toMatchObject({ body: "a" });
      const [item] = compileComponents('text(body: "a", body: "b")');
      expect(item).toMatchObject({
        ok: false,
        error: expect.stringContaining('repeats "body"'),
      });
    });
  });

  describe("positional arguments", () => {
    it("fills required fields in order", () => {
      expect(one('text("hello")')).toEqual({ type: "text", body: "hello" });
      expect(one('change("T", "B", "A", "U")')).toEqual({
        type: "change",
        title: "T",
        before: "B",
        after: "A",
        unchanged: "U",
      });
      expect(one('recommendation("Ship it", "It works")')).toMatchObject({
        choice: "Ship it",
        reason: "It works",
      });
    });

    it("places each positional value in the first field it fits", () => {
      expect(
        one(
          'checks("T", "S", {passed: 2, failed: 0, skipped: 0}, [{name: "N", status: passed}])',
        ),
      ).toMatchObject({
        title: "T",
        scope: "S",
        testTotals: { passed: 2 },
        items: [{ name: "N" }],
      });
      expect(
        one('checks(title: "T", scope: "S", items: [{"N", passed}])'),
      ).toMatchObject({ items: [{ name: "N", status: "passed" }] });
    });

    it("spreads a call written around one object", () => {
      expect(one('change({title: "T", before: "B", after: "A"})')).toEqual({
        type: "change",
        title: "T",
        before: "B",
        after: "A",
      });
    });
  });

  describe("enum words", () => {
    it("matches check statuses regardless of case and through synonyms", () => {
      expect(status("Passed")).toBe("passed");
      expect(status("PASS")).toBe("passed");
      expect(status("ok")).toBe("passed");
      expect(status("done")).toBe("passed");
      expect(status('"✅"')).toBe("passed");
      expect(status("error")).toBe("failed");
      expect(status("skip")).toBe("skipped");
      expect(status('"not tested"')).toBe("untested");
      expect(status("not tested")).toBe("untested");
      expect(status("not-tested")).toBe("untested");
      expect(status("NOT_RUN")).toBe("untested");
      expect(status("pasd")).toBe("passed");
    });

    it("matches delivery statuses through synonyms", () => {
      expect(stage("Done")).toBe("done");
      expect(stage("completed")).toBe("done");
      expect(stage("passed")).toBe("done");
      expect(stage('"in progress"')).toBe("pending");
      expect(stage("todo")).toBe("pending");
      expect(stage("failed")).toBe("blocked");
      expect(stage("unclear")).toBe("unknown");
      expect(stage("not started")).toBe("not-started");
      expect(stage("NotStarted")).toBe("not-started");
    });

    it("matches group relationships", () => {
      expect(
        one(
          'group(relationship: Peer, children: [text(body: "a"), text(body: "b")])',
        ),
      ).toMatchObject({ relationship: "peers" });
    });
  });

  describe("value kinds", () => {
    it("reads numbers and booleans written as text", () => {
      expect(
        checks(
          '{name: "N", status: passed}',
          'testTotals: {passed: "1,901", failed: "0", skipped: 1}, ',
        ),
      ).toMatchObject({ testTotals: { passed: 1901, failed: 0, skipped: 1 } });
      expect(
        one(
          'sequence(title: "T", steps: [{title: "a", attention: "yes"}, {title: "b", attention: no}])',
        ),
      ).toMatchObject({
        steps: [
          { title: "a", attention: true },
          { title: "b", attention: false },
        ],
      });
    });

    it("reads a single value as a one-item list", () => {
      expect(
        one('checks(title: "T", scope: "S", items: {name: "N", status: ok})'),
      ).toMatchObject({ items: [{ name: "N", status: "passed" }] });
    });

    it("reads a string as an object with one required text field", () => {
      expect(one('sequence(title: "T", steps: ["Read", "Write"])')).toEqual({
        type: "sequence",
        title: "T",
        steps: [{ title: "Read" }, { title: "Write" }],
      });
      expect(one('sequence(title: "T", steps: {title: "Only"})')).toMatchObject(
        { steps: [{ title: "Only" }] },
      );
    });

    it("drops null and empty optional values", () => {
      expect(
        one(
          'change(title: "T", before: "B", after: "A", unchanged: null, limitation: "  ")',
        ),
      ).toEqual({ type: "change", title: "T", before: "B", after: "A" });
    });
  });

  describe("evidence", () => {
    const evidence = (items: string) =>
      (
        checks(`{name: "N", status: passed, evidence: ${items}}`) as {
          items: { evidence: unknown[] }[];
        }
      ).items[0]!.evidence;

    it("reads a string as a labeled location", () => {
      expect(evidence('"src/app.ts"')).toEqual([
        { label: "src/app.ts", location: "src/app.ts" },
      ]);
      expect(evidence('["the CI log"]')).toEqual([{ label: "the CI log" }]);
    });

    it("labels an unlabeled location", () => {
      expect(evidence('[{location: "src/a.ts", line: 3}]')).toEqual([
        { label: "src/a.ts", location: "src/a.ts", line: 3 },
      ]);
    });

    it("keeps an unusable location as detail", () => {
      expect(evidence('[{label: "Log", location: "http://ci.dev/1"}]')).toEqual(
        [{ label: "Log", detail: "http://ci.dev/1" }],
      );
    });

    it("repairs or drops line numbers that cannot point anywhere", () => {
      expect(
        evidence('[{label: "A", location: "a.ts", line: 9, endLine: 3}]'),
      ).toEqual([{ label: "A", location: "a.ts", line: 3, endLine: 9 }]);
      expect(evidence('[{label: "A", location: "a.ts", line: "4"}]')).toEqual([
        { label: "A", location: "a.ts", line: 4 },
      ]);
      expect(evidence('[{label: "A", line: 4}]')).toEqual([{ label: "A" }]);
      expect(evidence('[{label: "A", location: "a.ts", line: 0}]')).toEqual([
        { label: "A", location: "a.ts" },
      ]);
    });
  });

  describe("groups", () => {
    it("flattens a nested group into its parent, kept together", () => {
      expect(
        one(
          'group(relationship: supporting, children: [text(body: "a"), group(relationship: peers, children: [text(body: "b"), text(body: "c")])])',
        ),
      ).toEqual({
        type: "group",
        relationship: "supporting",
        children: [
          { type: "text", body: "a" },
          [
            { type: "text", body: "b" },
            { type: "text", body: "c" },
          ],
        ],
      });
    });

    it("flattens lists nested more than one level", () => {
      expect(
        one(
          'group(relationship: peers, children: [text(body: "a"), [text(body: "b"), [text(body: "c")]]])',
        ),
      ).toMatchObject({
        children: [{ body: "a" }, [{ body: "b" }, { body: "c" }]],
      });
    });

    it("reads a group of one as that component", () => {
      expect(
        one('group(relationship: peers, children: [text(body: "a")])'),
      ).toEqual({ type: "text", body: "a" });
    });

    it("defaults a missing relationship", () => {
      expect(
        one('group(children: [text(body: "a"), text(body: "b")])'),
      ).toMatchObject({ relationship: "supporting" });
    });
  });

  describe("JSON components", () => {
    it("reads a JSON component through the same repairs", () => {
      expect(
        one('{"type": "Change", "titel": "T", "before": "B", "after": "A",}'),
      ).toEqual({ type: "change", title: "T", before: "B", after: "A" });
    });

    it("reads a JSON list of components and typed children", () => {
      const items = compileComponents(
        '[{"type": "text", "body": "a"}, {"type": "group", "relationship": "peers", "children": [{"type": "text", "body": "b"}, {"type": "text", "body": "c"}]}]',
      );
      expect(items.map((i) => i.ok)).toEqual([true, true]);
    });
  });

  describe("fences", () => {
    it("reads fences whose info string differs in case or plural", () => {
      for (const lang of ["Workstreams", "workstream", "WORKSTREAMS"]) {
        const data = read(
          `:::reply\n\`\`\`${lang}\ntext(body: 'a')\n\`\`\`\n:::\n`,
        );
        expect(data.body).toEqual([{ type: "text", body: "a" }]);
      }
    });
  });
});
