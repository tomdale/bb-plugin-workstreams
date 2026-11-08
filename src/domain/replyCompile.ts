/*
 * Turns the compact syntax into validated reply components. The syntax tree is
 * read against the catalog first, then the zod schemas decide everything else,
 * such as required fields and limits, with each issue mapped back to its
 * source span.
 *
 * Reading is liberal: a component renders whenever the writer's intent is
 * unambiguous, even if the text departs from the documented form. Names match
 * regardless of case, `snake_case`, common synonyms, and small misspellings
 * that point at exactly one field; positional arguments fill the fields their
 * values fit; enum words match regardless of case and through synonyms such
 * as `ok` for `passed`; text, numbers, and booleans convert where the meaning
 * is plain; a single value stands for a one-item list; a string stands for an
 * object with one required text field; null, empty optional text, `type`, and
 * unknown fields are dropped; nested groups flatten; and a group of one is
 * that component. A repair that would have to guess fails instead, and the
 * reply shows the statement's source with a locatable reason.
 *
 * Statements are independent: a malformed one yields an error entry and its
 * neighbors still compile.
 */
import type { z } from "zod";
import {
  CATALOG,
  nearest,
  type FieldShape,
  type ObjectShape,
  type Shape,
} from "./replyCatalog.ts";
import {
  evidenceSchema,
  leafSchemas,
  replyComponentSchema,
  type ReplyComponent,
} from "./replyComponents.ts";
import {
  parseStatements,
  position,
  type CallNode,
  type Field,
  type Node,
} from "./replySyntax.ts";

export type CompiledStatement =
  | { ok: true; component: ReplyComponent }
  | { ok: false; source: string; error: string };

type Issue = { at: number; message: string };
/**
 * Hard issues stop a component; notes record what a repair dropped and are
 * reported only when the component fails anyway, since they often explain why.
 */
class Collector {
  readonly issues: Issue[] = [];
  readonly notes: Issue[] = [];
  add(at: number, message: string) {
    this.issues.push({ at, message });
  }
  note(at: number, message: string) {
    this.notes.push({ at, message });
  }
}

/** Source nodes behind each converted object field and list item, for locating schema issues. */
const origins = new WeakMap<object, Record<string | number, Node>>();

const quoted = (words: string[]) => words.join("|");
const label = (node: Node): string =>
  node.kind === "word"
    ? "a bare word"
    : node.kind === "object"
      ? "an object"
      : `a ${node.kind === "call" ? "component" : node.kind}`;
/** Case, spacing, and separators do not distinguish names or enum words. */
const normal = (word: string) => word.toLowerCase().replace(/[\s_\-.]+/g, "");

const COMPONENT_ALIASES: Record<string, string> = {
  prose: "text",
  markdown: "text",
  paragraph: "text",
  steps: "sequence",
  tests: "checks",
  verification: "checks",
  compare: "comparison",
  recommend: "recommendation",
  rollout: "delivery",
  release: "delivery",
};

/** Other names a writer may use for a field, keyed by the field they mean. */
const FIELD_ALIASES: Record<string, string[]> = {
  title: ["heading", "header", "name", "label"],
  name: ["title", "label"],
  label: ["title", "name", "text"],
  topic: ["subject", "title"],
  background: ["context", "description"],
  body: ["content", "text", "markdown", "value", "description"],
  detail: ["description", "desc", "note", "notes", "details", "explanation"],
  summary: ["description"],
  qualification: ["caveat", "caveats", "tradeoff", "tradeoffs"],
  reason: ["why", "because", "rationale"],
  choice: ["recommendation", "option", "decision"],
  before: ["old", "previous", "from"],
  after: ["new", "now", "to"],
  unchanged: ["same", "kept"],
  limitation: ["limitations", "caveat", "caveats", "limits"],
  location: ["url", "href", "link", "path", "file", "uri"],
  line: ["startline", "start", "linestart", "lines"],
  endLine: ["end", "lineend", "stopline"],
  status: ["state", "result", "outcome"],
  testTotals: ["totals", "tests", "counts", "testcounts", "testresults"],
  passed: ["pass", "passes", "passing", "ok", "succeeded"],
  failed: ["fail", "fails", "failing", "failures", "errors"],
  skipped: ["skip", "skips", "ignored", "todo"],
  attention: ["important", "warning", "highlight"],
  recommended: ["preferred", "best"],
  steps: ["items"],
  stages: ["items", "steps"],
  items: ["options", "results", "checks", "entries"],
  children: ["items", "components", "parts"],
  relationship: ["relation", "layout"],
};

/** Words a writer may use for an enum option; the first option the field offers wins. */
const ENUM_SYNONYMS: Record<string, string[]> = {
  passed: [
    "pass",
    "passes",
    "passing",
    "ok",
    "okay",
    "success",
    "successful",
    "succeeded",
    "green",
    "good",
    "verified",
    "done",
    "complete",
    "completed",
    "yes",
    "✓",
    "✔",
    "✅",
  ],
  failed: [
    "fail",
    "fails",
    "failing",
    "failure",
    "error",
    "errored",
    "broken",
    "red",
    "✗",
    "✘",
    "❌",
  ],
  skipped: ["skip", "skips", "ignored", "omitted"],
  blocked: [
    "block",
    "blocking",
    "stuck",
    "failed",
    "failure",
    "error",
    "errored",
  ],
  untested: [
    "nottested",
    "notrun",
    "unverified",
    "notverified",
    "notchecked",
    "pending",
    "todo",
    "notyet",
    "unknown",
  ],
  done: [
    "complete",
    "completed",
    "finished",
    "shipped",
    "deployed",
    "merged",
    "pushed",
    "released",
    "passed",
    "ok",
    "yes",
    "success",
    "succeeded",
    "✓",
    "✔",
    "✅",
  ],
  pending: [
    "inprogress",
    "todo",
    "waiting",
    "queued",
    "started",
    "running",
    "planned",
    "ongoing",
    "wip",
    "next",
  ],
  "not-started": ["notstarted", "notbegun", "nottouched", "fresh"],
  unknown: ["unclear", "unsure", "notsure", "unverified", "na", "?"],
  peers: ["peer", "sidebyside", "parallel", "siblings"],
  supporting: ["support", "supports", "explanation", "stacked"],
};

function enumWord(word: string, options: string[]): string | null {
  if (options.includes(word)) return word;
  const key = normal(word);
  const exact = options.find((option) => normal(option) === key);
  if (exact) return exact;
  const synonym = options.find((option) =>
    ENUM_SYNONYMS[option]?.some((s) => normal(s) === key),
  );
  if (synonym) return synonym;
  return nearest(key, options, true);
}

const BOOLEAN_WORDS: Record<string, boolean> = {
  true: true,
  yes: true,
  y: true,
  on: true,
  "1": true,
  false: false,
  no: false,
  n: false,
  off: false,
  "0": false,
};

/** Text, numbers, and booleans written where the other kind is expected. */
function scalarText(node: Node): string | null {
  switch (node.kind) {
    case "string":
    case "word":
      return node.value;
    case "number":
    case "boolean":
      return String(node.value);
    default:
      return null;
  }
}

/** The one required text field a bare string can stand for, if the object has exactly one. */
function soleTextField(shape: ObjectShape): string | null {
  const required = shape.fields.filter((f) => !f.optional);
  return required.length === 1 && required[0]!.shape.kind === "text"
    ? required[0]!.name
    : null;
}
const looksLikeLocation = (text: string) =>
  /^https:\/\/\S+$/.test(text) || /^[^\s:]*[/.][^\s:]*$/.test(text);

/** Convert a node to a plain value under `shape`; a mismatch records an issue and yields undefined. */
function convert(
  node: Node,
  shape: Shape,
  where: string,
  out: Collector,
): unknown {
  const mismatch = (expected: string) => {
    out.add(node.start, `${where} must be ${expected}, found ${label(node)}.`);
    return undefined;
  };
  if (node.kind === "null") return undefined;
  switch (shape.kind) {
    case "text": {
      const text = scalarText(node);
      if (text !== null) return text;
      if (node.kind === "list") {
        const parts = node.items.map(scalarText);
        if (parts.length && parts.every((p) => p !== null))
          return parts.join("\n\n");
      }
      return mismatch('text in "quotes"');
    }
    case "number": {
      if (node.kind === "number") return node.value;
      const text = scalarText(node)?.replace(/[,_\s]/g, "");
      return text && /^-?\d+(?:\.\d+)?$/.test(text)
        ? Number(text)
        : mismatch("a number");
    }
    case "boolean": {
      if (node.kind === "boolean") return node.value;
      const text = scalarText(node);
      const value = text === null ? undefined : BOOLEAN_WORDS[normal(text)];
      return value ?? mismatch("true or false");
    }
    case "enum": {
      const word = scalarText(node);
      const match = word === null ? null : enumWord(word, shape.options);
      if (match) return match;
      const near = word === null ? null : nearest(word, shape.options);
      out.add(
        node.start,
        `${where} must be one of ${quoted(shape.options)}${word === null ? `, found ${label(node)}` : `, found "${word}"${near ? `; did you mean ${near}?` : ""}`}.`,
      );
      return undefined;
    }
    case "list": {
      const items = node.kind === "list" ? node.items : [node];
      const value = items.map((item, i) =>
        convert(item, shape.item, `${where}[${i}]`, out),
      );
      origins.set(value, Object.fromEntries(items.map((item, i) => [i, item])));
      return value;
    }
    case "object": {
      if (node.kind === "object")
        return convertFields(node.fields, shape, where, out);
      const text = scalarText(node);
      if (text !== null && shape.name === "Evidence")
        return repairEvidence({
          label: text,
          ...(looksLikeLocation(text) ? { location: text } : {}),
        });
      const sole = soleTextField(shape);
      if (text !== null && sole) {
        const value = { [sole]: text };
        origins.set(value, { [sole]: node });
        return value;
      }
      return mismatch("an object { name: value }");
    }
    case "children": {
      if (node.kind !== "list") return [child(node, out)];
      // Lists nested deeper than one level flatten into one kept-together list.
      const leaves = (n: Node): unknown[] =>
        n.kind === "list" ? n.items.flatMap(leaves) : [child(n, out)].flat();
      return node.items.map((item) => {
        if (item.kind !== "list") return child(item, out);
        const inner = leaves(item);
        return inner.length === 1 ? inner[0] : inner;
      });
    }
  }
}

/**
 * A group's child. A nested group contributes its components, kept together,
 * since a group cannot hold another group.
 */
function child(node: Node, out: Collector): unknown {
  if (node.kind !== "call") {
    out.add(
      node.start,
      `group children must be components, found ${label(node)}.`,
    );
    return undefined;
  }
  if (resolveComponent(node.name) === "group") {
    const value = convertFields(node.args, CATALOG.group!, "group", out);
    const leaves = ((value.children as unknown[] | undefined) ?? []).flat();
    return leaves.length === 1 ? leaves[0] : leaves;
  }
  return build(node, out);
}

function resolveComponent(name: string): string | null {
  if (CATALOG[name]) return name;
  const names = Object.keys(CATALOG);
  const key = normal(name);
  return (
    names.find((n) => normal(n) === key) ??
    COMPONENT_ALIASES[key] ??
    nearest(name, names, true)
  );
}

/** The field a written key means, or null when no single field is meant. */
function resolveField(
  key: string,
  shape: ObjectShape,
  taken: Set<string>,
): FieldShape | null {
  const k = normal(key);
  const exact = shape.fields.find((f) => normal(f.name) === k);
  if (exact) return exact;
  const free = shape.fields.filter((f) => !taken.has(f.name));
  const aliased = free.filter((f) =>
    FIELD_ALIASES[f.name]?.some((alias) => normal(alias) === k),
  );
  if (aliased.length === 1) return aliased[0]!;
  if (aliased.length > 1) return null;
  const near = nearest(
    k,
    free.map((f) => normal(f.name)),
    true,
  );
  return near ? free.find((f) => normal(f.name) === near)! : null;
}

/** Whether a node's kind is what a field expects, without any conversion. */
function fits(node: Node, shape: Shape): boolean {
  switch (shape.kind) {
    case "text":
      return node.kind === "string" || node.kind === "word";
    case "number":
      return node.kind === "number";
    case "boolean":
      return node.kind === "boolean";
    case "enum":
      return (
        (node.kind === "word" || node.kind === "string") &&
        enumWord(node.value, shape.options) !== null
      );
    case "list":
      return node.kind === "list";
    case "children":
      return node.kind === "list" || node.kind === "call";
    case "object":
      return node.kind === "object";
  }
}

/** Whether a node can convert to what a field expects. */
function convertible(node: Node, shape: Shape): boolean {
  if (fits(node, shape)) return true;
  switch (shape.kind) {
    case "text":
      return scalarText(node) !== null;
    case "list":
      return convertible(node, shape.item);
    case "object":
      return (
        scalarText(node) !== null &&
        (shape.name === "Evidence" || soleTextField(shape) !== null)
      );
    default:
      return false;
  }
}

function convertFields(
  fields: Field[],
  shape: ObjectShape,
  owner: string,
  out: Collector,
): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  const origin: Record<string, Node> = {};
  const taken = new Set<string>();
  // A call written around one object, name({ … }), means that object's fields.
  if (
    fields.length === 1 &&
    fields[0]!.key === null &&
    fields[0]!.value.kind === "object"
  )
    fields = fields[0]!.value.fields;
  const assign = (field: FieldShape, node: Node, at: number) => {
    const converted = convert(node, field.shape, `"${field.name}"`, out);
    if (converted === undefined) return;
    if (
      field.optional &&
      typeof converted === "string" &&
      converted.trim() === ""
    )
      return;
    if (field.name in value) {
      if (JSON.stringify(value[field.name]) !== JSON.stringify(converted))
        out.add(at, `${owner} repeats "${field.name}".`);
      return;
    }
    value[field.name] = converted;
    origin[field.name] = node;
  };
  const named = fields.filter((f) => f.key !== null && f.key !== "type");
  const exact = (f: Field) =>
    shape.fields.find((s) => normal(s.name) === normal(f.key!));
  // Exact names first, so a synonym or misspelling never takes a field that
  // the writer also named outright.
  for (const field of named) {
    const known = exact(field);
    if (known) {
      taken.add(known.name);
      assign(known, field.value, field.keySpan.start);
    }
  }
  for (const field of named) {
    if (exact(field)) continue;
    const known = resolveField(field.key!, shape, taken);
    if (known && !taken.has(known.name)) {
      taken.add(known.name);
      assign(known, field.value, field.keySpan.start);
    } else {
      const near = nearest(
        field.key!,
        shape.fields.map((f) => f.name),
      );
      out.note(
        field.keySpan.start,
        `${owner} has no field "${field.key}"${near ? `; did you mean "${near}"?` : `; fields are ${shape.fields.map((f) => f.name).join(", ")}`}.`,
      );
    }
  }
  // Positional values fill the remaining fields, required ones first, each
  // taking the first field its value already fits, then one it converts to.
  const order = [
    ...shape.fields.filter((f) => !f.optional),
    ...shape.fields.filter((f) => f.optional),
  ];
  for (const field of fields.filter((f) => f.key === null)) {
    const node = field.value;
    if (
      node.kind === "word" &&
      shape.fields.some((f) => f.name === node.value)
    ) {
      out.add(
        node.start,
        `Arguments are named: write "${node.value}: value"; "${node.value}" has no ":" after it.`,
      );
      continue;
    }
    const free = order.filter((f) => !taken.has(f.name));
    const target =
      free.find((f) => fits(node, f.shape)) ??
      free.find((f) => convertible(node, f.shape));
    if (!target) {
      out.add(
        node.start,
        `Arguments are named: write ${owner}(field: value); no field of ${owner} is left for this value.`,
      );
      continue;
    }
    taken.add(target.name);
    assign(target, node, node.start);
  }
  origins.set(value, origin);
  return shape.name === "Evidence" ? repairEvidence(value) : value;
}

/**
 * Evidence keeps every claim it can: a location that is not HTTPS or a
 * workspace-safe path moves into the detail, a label defaults to the
 * location, and line numbers that cannot point anywhere are dropped.
 */
function repairEvidence(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const origin = origins.get(value);
  const next = { ...value };
  const { location } = next;
  if (
    typeof location === "string" &&
    !evidenceSchema.shape.location.safeParse(location).success
  ) {
    delete next.location;
    next.detail =
      typeof next.detail === "string"
        ? `${next.detail} (${location})`
        : location;
  }
  if (next.label === undefined && typeof next.location === "string")
    next.label = next.location;
  const lineOk = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  if (!lineOk(next.line)) delete next.line;
  if (!lineOk(next.endLine)) delete next.endLine;
  if (next.endLine !== undefined && next.line === undefined) {
    next.line = next.endLine;
    delete next.endLine;
  }
  if ((next.endLine as number) < (next.line as number))
    [next.line, next.endLine] = [next.endLine, next.line];
  if (
    next.line !== undefined &&
    (typeof next.location !== "string" || next.location.startsWith("https://"))
  ) {
    delete next.line;
    delete next.endLine;
  }
  if (origin) origins.set(next, origin);
  return next;
}

function build(call: CallNode, out: Collector): unknown {
  const name = resolveComponent(call.name);
  const shape = name ? CATALOG[name] : undefined;
  if (!name || !shape) {
    const near = nearest(call.name, Object.keys(CATALOG));
    out.add(
      call.nameSpan.start,
      `Unknown component "${call.name}"${near ? `; did you mean "${near}"?` : `; components are ${Object.keys(CATALOG).join(", ")}`}.`,
    );
    return undefined;
  }
  const before = out.issues.length;
  const value = convertFields(call.args, shape, name, out);
  if (out.issues.length > before) return undefined;
  if (name === "group") {
    const children = (value.children as unknown[] | undefined) ?? [];
    // A group of one component is that component.
    if (children.flat().length === 1) return children.flat()[0];
    value.relationship ??= "supporting";
  }
  const full = { type: name, ...value };
  origins.set(full, origins.get(value) ?? {});
  const schema: z.ZodType =
    name in leafSchemas
      ? leafSchemas[name as keyof typeof leafSchemas]
      : replyComponentSchema;
  const parsed = schema.safeParse(full);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues)
    out.add(locate(call, full, issue.path), describeIssue(name, full, issue));
  return undefined;
}

/** The source offset a schema issue's path points at, or the nearest ancestor's. */
function locate(call: CallNode, value: unknown, path: PropertyKey[]): number {
  let at = call.start,
    cursor: unknown = value;
  for (const step of path) {
    if (cursor === null || typeof cursor !== "object") break;
    const node = origins.get(cursor)?.[step as string | number];
    if (node) at = node.start;
    cursor = (cursor as Record<PropertyKey, unknown>)[step];
  }
  return at;
}

function describeIssue(
  name: string,
  value: unknown,
  issue: z.core.$ZodIssue,
): string {
  const path = issue.path;
  const key = String(path.at(-1) ?? name);
  const where = path.length
    ? `${name}${path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("")}`
    : name;
  let cursor: unknown = value;
  for (const step of path.slice(0, -1))
    cursor = (cursor as Record<PropertyKey, unknown> | undefined)?.[step];
  const missing =
    path.length > 0 &&
    cursor !== null &&
    typeof cursor === "object" &&
    (cursor as Record<PropertyKey, unknown>)[path.at(-1)!] === undefined;
  if (missing) {
    const shape = CATALOG[name]!;
    const field = shape.fields.find((f) => f.name === key);
    const options =
      field?.shape.kind === "enum" ? ` (${quoted(field.shape.options)})` : "";
    return `${path.length > 1 ? `${where.replace(/\.[^.[]+$/, "")}` : name} is missing required field "${key}"${options}.`;
  }
  if (issue.code === "too_small" && issue.origin === "array")
    return `"${key}" needs at least ${String(issue.minimum)} entries.`;
  if (issue.code === "too_big" && issue.origin === "array")
    return `"${key}" takes at most ${String(issue.maximum)} entries.`;
  if (issue.code === "too_small" && issue.origin === "string")
    return `"${key}" cannot be empty.`;
  if (issue.code === "too_small" && issue.origin === "number")
    return `"${key}" must be at least ${String(issue.minimum)}.`;
  return path.length ? `${where}: ${issue.message}` : issue.message;
}

/** Compile the statements in a fence's content (the text between its markers). */
export function compileComponents(content: string): CompiledStatement[] {
  return parseStatements(content).map((statement): CompiledStatement => {
    const source = content.slice(statement.start, statement.end).trim();
    const fail = (at: number, message: string, more = 0): CompiledStatement => {
      const { line, col } = position(content, at);
      return {
        ok: false,
        source,
        error: `Component not displayed (line ${line}, col ${col}): ${message.replace(/\?\.$/, "?")}${more ? ` (+${more} more)` : ""}`,
      };
    };
    if (!statement.ok)
      return fail(statement.error.start, statement.error.message);
    const out = new Collector();
    const component = build(statement.call, out);
    if (component !== undefined && out.issues.length === 0)
      return { ok: true, component: component as ReplyComponent };
    const byPlace = (a: Issue, b: Issue) => a.at - b.at;
    const [first, ...rest] = [
      ...out.notes.sort(byPlace),
      ...out.issues.sort(byPlace),
    ];
    return fail(first!.at, first!.message, rest.length);
  });
}
