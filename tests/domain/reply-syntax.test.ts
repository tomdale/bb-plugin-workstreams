import { describe, expect, it } from "vitest";
import { parse, type Reply } from "../../src/domain/reply.ts";
import { signatureLines } from "../../src/domain/replyCatalog.ts";
import { compileComponents } from "../../src/domain/replyCompile.ts";
import {
  COMPONENT_EXAMPLES,
  componentFence,
} from "../../src/domain/replyExamples.ts";
import { formatComponent } from "../../src/domain/replyFormat.ts";
import { REPLY_COMPONENT_INSTRUCTIONS } from "../../src/domain/replyInstructions.ts";
import { blockInput } from "./replyFixtures.ts";

function read(message: string): Reply {
  const result = parse(blockInput(message));
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const error = (source: string) => {
  const [item] = compileComponents(source);
  if (!item || item.ok) throw new Error("expected an error");
  return item.error;
};

describe("compact component syntax", () => {
  it.each(Object.entries(COMPONENT_EXAMPLES))(
    "round-trips the %s example",
    (_name, component) => {
      expect(compileComponents(formatComponent(component))).toEqual([
        { ok: true, component },
      ]);
    },
  );

  it("reads every example through a reply, including text that holds a code fence", () => {
    for (const component of Object.values(COMPONENT_EXAMPLES)) {
      const data = read(`:::reply\n${componentFence(component)}\n:::\n`);
      expect(data.body).toEqual([component]);
    }
  });

  it("reads several statements in one fence and recovers per statement", () => {
    const parts = compileComponents(
      [
        'context(topic: "A")',
        'retiredComponent(value: "x")',
        'recommendation(choice: "C", reason: "R")',
      ].join("\n"),
    );
    expect(parts.map((p) => p.ok)).toEqual([true, false, true]);
    expect(parts[1]).toMatchObject({
      error: expect.stringContaining('Unknown component "retiredComponent"'),
    });
  });

  it("reads quoted enum words and multi-line strings", () => {
    const [item] = compileComponents(
      'details(title: "T", body: """\nline one\n\nline "two"\n""")\n',
    );
    expect(item).toEqual({
      ok: true,
      component: {
        type: "details",
        title: "T",
        body: 'line one\n\nline "two"',
      },
    });
    expect(
      compileComponents(
        'checks(title: "T", scope: "S", items: [{name: "N", status: passed}])',
      )[0]?.ok,
    ).toBe(true);
  });

  it("locates errors by line and column", () => {
    expect(
      error('change(\n  title: "T",\n  before: "B",\n  after: "A" + "B"\n)'),
    ).toBe(
      'Component not displayed (line 4, col 14): Expressions are not supported ("+"); write a literal value.',
    );
    expect(error('chnge(title: "T")')).toContain(
      'change is missing required field "before"',
    );
    expect(
      error(
        'checks(title: "T", scope: "S", items: [{name: "N", status: zzz}])',
      ),
    ).toContain("line 1, col 60");
  });

  it("names the argument a bare field name stands for", () => {
    expect(error("text(body)")).toContain('write "body: value"');
    expect(error('text(body: "a", "extra")')).toContain(
      "no field of text is left",
    );
  });

  it("rejects expressions and bindings as unsupported", () => {
    expect(error('text(body: "a" + "b")')).toContain(
      "Expressions are not supported",
    );
    expect(error("text(body: $x)")).toContain("Bindings");
  });

  it("names type and value mismatches that no repair can resolve", () => {
    expect(
      error(
        'checks(title: "T", scope: "S", items: [{name: "N", status: sideways}])',
      ),
    ).toContain("must be one of passed|failed|skipped|blocked|untested");
    expect(error('comparison(title: "T", items: [])')).toContain(
      "needs at least",
    );
    expect(error('details(title: "T", body: {a: "b"})')).toContain(
      'must be text in "quotes", found an object',
    );
  });

  it("reports unterminated input at the failing token", () => {
    expect(error('text(body: "a')).toContain("Unterminated string");
    expect(error("text(body: )")).toContain("Expected a value");
  });

  it("validates group children individually", () => {
    expect(
      error(
        'group(relationship: peers, children: [text(body: "a"), retiredComponent(value: "x")])',
      ),
    ).toContain('Unknown component "retiredComponent"');
  });

  it("keeps the source, a reason, and the surrounding prose for a bad fence", () => {
    const data = read(
      ":::reply\nBefore.\n\n```workstreams\ntext(body: $oops)\n```\n\nAfter.\n:::\n",
    );
    expect(data.body.map((p) => p.type)).toEqual(["text", "unparsed", "text"]);
    expect(data.body[1]).toMatchObject({
      source: "```workstreams\ntext(body: $oops)\n```",
      error: expect.stringContaining("line 1, col"),
    });
  });

  it("keeps rendering stored JSON components", () => {
    const data = read(
      ':::reply\n```workstreams\n{"type":"change","title":"T","before":"B","after":"A"}\n```\n:::\n',
    );
    expect(data.body).toEqual([
      { type: "change", title: "T", before: "B", after: "A" },
    ]);
  });

  it("generates one signature line per component from the schemas", () => {
    const lines = signatureLines();
    expect(lines.filter((l) => /^\w+\(/.test(l))).toHaveLength(
      Object.keys(COMPONENT_EXAMPLES).length,
    );
  });

  it("keeps the component instructions within bb's per-text limit", () => {
    expect(REPLY_COMPONENT_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });
});
