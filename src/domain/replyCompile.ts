/*
 * Turns the compact syntax into validated reply components. The syntax tree is
 * checked against the catalog first, which gives the precise, locatable
 * messages a model can act on (unknown field with "did you mean", unquoted
 * text, wrong enum word); the zod schemas then decide everything else, such as
 * required fields and limits, with each issue mapped back to its source span.
 *
 * Statements are independent: a malformed one yields an error entry and its
 * neighbors still compile.
 */
import type { z } from "zod";
import {
  CATALOG,
  nearest,
  type ObjectShape,
  type Shape,
} from "./replyCatalog.ts";
import {
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
class Collector {
  readonly issues: Issue[] = [];
  add(at: number, message: string) {
    this.issues.push({ at, message });
  }
}

const quoted = (words: string[]) => words.join("|");
const label = (node: Node): string =>
  node.kind === "word"
    ? "a bare word"
    : `a ${node.kind === "call" ? "component" : node.kind}`;

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
  switch (shape.kind) {
    case "text":
      return node.kind === "string"
        ? node.value
        : node.kind === "word"
          ? (out.add(
              node.start,
              `${where} is text; quote it as "${node.value}".`,
            ),
            undefined)
          : mismatch('text in "quotes"');
    case "number":
      return node.kind === "number" ? node.value : mismatch("a number");
    case "boolean":
      return node.kind === "boolean" ? node.value : mismatch("true or false");
    case "enum": {
      const word =
        node.kind === "word" || node.kind === "string" ? node.value : null;
      if (word !== null && shape.options.includes(word)) return word;
      const near = word === null ? null : nearest(word, shape.options);
      out.add(
        node.start,
        `${where} must be one of ${quoted(shape.options)}${word === null ? `, found ${label(node)}` : `, found "${word}"${near ? `; did you mean ${near}?` : ""}`}.`,
      );
      return undefined;
    }
    case "list": {
      if (node.kind !== "list") return mismatch("a list [ … ]");
      return node.items.map((item, i) =>
        convert(item, shape.item, `${where}[${i}]`, out),
      );
    }
    case "object":
      return node.kind === "object"
        ? convertFields(node.fields, shape, where, out)
        : mismatch("an object { name: value }");
    case "children": {
      if (node.kind !== "list") return mismatch("a list of components");
      return node.items.map((item) =>
        item.kind === "list"
          ? item.items.map((inner) => child(inner, out))
          : child(item, out),
      );
    }
  }
}

function child(node: Node, out: Collector): unknown {
  if (node.kind !== "call") {
    out.add(
      node.start,
      `group children must be components, found ${label(node)}.`,
    );
    return undefined;
  }
  if (node.name === "group") {
    out.add(node.start, "A group cannot contain another group.");
    return undefined;
  }
  return build(node, out);
}

function convertFields(
  fields: { key: string; keySpan: { start: number }; value: Node }[],
  shape: ObjectShape,
  owner: string,
  out: Collector,
): Record<string, unknown> {
  const names = shape.fields.map((f) => f.name);
  const value: Record<string, unknown> = {};
  for (const field of fields) {
    const known = shape.fields.find((f) => f.name === field.key);
    if (field.key === "type")
      out.add(
        field.keySpan.start,
        `${owner} takes no "type"; the name before "(" is the type.`,
      );
    else if (!known) {
      const near = nearest(field.key, names);
      out.add(
        field.keySpan.start,
        `${owner} has no field "${field.key}"${near ? `; did you mean "${near}"?` : `; fields are ${names.join(", ")}`}.`,
      );
    } else if (field.key in value)
      out.add(field.keySpan.start, `${owner} repeats "${field.key}".`);
    else
      value[field.key] = convert(
        field.value,
        known.shape,
        `"${field.key}"`,
        out,
      );
  }
  return value;
}

function build(call: CallNode, out: Collector): unknown {
  const shape = CATALOG[call.name];
  if (!shape) {
    const near = nearest(call.name, Object.keys(CATALOG));
    out.add(
      call.nameSpan.start,
      `Unknown component "${call.name}"${near ? `; did you mean "${near}"?` : `; components are ${Object.keys(CATALOG).join(", ")}`}.`,
    );
    return undefined;
  }
  const before = out.issues.length;
  const value = convertFields(call.args, shape, call.name, out);
  if (out.issues.length > before) return undefined;
  const full = { type: call.name, ...value };
  const schema: z.ZodType =
    call.name in leafSchemas
      ? leafSchemas[call.name as keyof typeof leafSchemas]
      : replyComponentSchema;
  const parsed = schema.safeParse(full);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues)
    out.add(locate(call, issue.path), describeIssue(call, full, issue));
  return undefined;
}

/** The syntax node a schema issue's path points at, or the nearest ancestor. */
function locate(call: CallNode, path: PropertyKey[]): number {
  let node: Node = call,
    at = call.start;
  for (const step of path) {
    if (node.kind === "call" || node.kind === "object") {
      const fields: Field[] = node.kind === "call" ? node.args : node.fields;
      const field: Field | undefined = fields.find((f) => f.key === step);
      if (!field) break;
      node = field.value;
    } else if (node.kind === "list" && typeof step === "number") {
      const item: Node | undefined = node.items[step];
      if (!item) break;
      node = item;
    } else break;
    at = node.start;
  }
  return at;
}

function describeIssue(
  call: CallNode,
  value: unknown,
  issue: z.core.$ZodIssue,
): string {
  const path = issue.path;
  const key = String(path.at(-1) ?? call.name);
  const where = path.length
    ? `${call.name}${path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("")}`
    : call.name;
  let cursor: unknown = value;
  for (const step of path.slice(0, -1))
    cursor = (cursor as Record<PropertyKey, unknown> | undefined)?.[step];
  const missing =
    path.length > 0 &&
    cursor !== null &&
    typeof cursor === "object" &&
    (cursor as Record<PropertyKey, unknown>)[path.at(-1)!] === undefined;
  if (missing) {
    const shape = CATALOG[call.name]!;
    const field = shape.fields.find((f) => f.name === key);
    const options =
      field?.shape.kind === "enum" ? ` (${quoted(field.shape.options)})` : "";
    return `${path.length > 1 ? `${where.replace(/\.[^.[]+$/, "")}` : call.name} is missing required field "${key}"${options}.`;
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
    const [first, ...rest] = out.issues.sort((a, b) => a.at - b.at);
    return fail(first!.at, first!.message, rest.length);
  });
}
