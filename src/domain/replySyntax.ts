/*
 * The compact component syntax: `name(key: value, …)` calls over static
 * values. Every argument is named; values are strings, numbers, booleans,
 * null, lists, objects, bare words, and nested calls. Nothing is evaluated, so
 * operators, templates, variables, and bindings are lexical errors rather than
 * ignored text. This module knows grammar only; field names, types, and
 * limits belong to the schemas that `replyCompile.ts` applies.
 *
 * Each top-level statement parses independently: an error ends that statement
 * and parsing resumes at the next line that begins, in column one, with
 * `name(`. One malformed component therefore never hides the others.
 */

export type Pos = { line: number; col: number };
export type SyntaxIssue = { message: string; start: number; end: number };

type Span = { start: number; end: number };
export type Node = Span &
  (
    | { kind: "string"; value: string }
    | { kind: "number"; value: number }
    | { kind: "boolean"; value: boolean }
    | { kind: "null" }
    | { kind: "word"; value: string }
    | { kind: "list"; items: Node[] }
    | { kind: "object"; fields: Field[] }
    | { kind: "call"; name: string; nameSpan: Span; args: Field[] }
  );
export type Field = { key: string; keySpan: Span; value: Node };
export type CallNode = Extract<Node, { kind: "call" }>;

export type Statement =
  | { ok: true; call: CallNode; start: number; end: number }
  | { ok: false; error: SyntaxIssue; start: number; end: number };

type Token = Span &
  (
    | { t: "ident" | "string" | "number" | "eof"; text: string }
    | { t: "punct"; text: "(" | ")" | "[" | "]" | "{" | "}" | "," | ":" }
  );

class Fail extends Error {
  readonly info: SyntaxIssue;
  constructor(info: SyntaxIssue) {
    super(info.message);
    this.info = info;
  }
}
const fail = (message: string, start: number, end = start + 1): never => {
  throw new Fail({ message, start, end });
};

const OPERATORS = "+*/%=<>!?&|^~;";
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPE_ERROR =
  'Invalid string escape; use JSON escapes such as \\n or \\".';

/** Position of an offset within `source`, 1-based. */
export function position(source: string, offset: number): Pos {
  let line = 1,
    last = -1;
  for (let i = source.indexOf("\n"); i !== -1 && i < offset;) {
    line++;
    last = i;
    i = source.indexOf("\n", i + 1);
  }
  return { line, col: offset - last };
}

function lexString(source: string, at: number): [Token, number] {
  if (source.startsWith('"""', at)) {
    const close = source.indexOf('"""', at + 3);
    if (close === -1)
      return fail('Unterminated """ string; close it with """.', at, at + 3);
    const raw = source
      .slice(at + 3, close)
      .replace(/^[ \t]*\r?\n/, "")
      .replace(/\r?\n[ \t]*$/, "");
    return [{ t: "string", text: raw, start: at, end: close + 3 }, close + 3];
  }
  let i = at + 1;
  while (i < source.length && source[i] !== '"') {
    if (source[i] === "\n")
      return fail(
        'Unterminated string; strings stay on one line, so use \\n or a """ string for line breaks.',
        at,
        i,
      );
    i += source[i] === "\\" ? 2 : 1;
  }
  if (i >= source.length)
    return fail("Unterminated string.", at, source.length);
  let text: string;
  try {
    text = JSON.parse(source.slice(at, i + 1)) as string;
  } catch {
    return fail(ESCAPE_ERROR, at, i + 1);
  }
  return [{ t: "string", text, start: at, end: i + 1 }, i + 1];
}

/** Pull-based lexer: a lexical error surfaces only when the parser reaches that token. */
class Lexer {
  private buffer: Token[] = [];
  private pos: number;
  private readonly source: string;
  constructor(source: string, from: number) {
    this.source = source;
    this.pos = from;
  }
  peek(ahead = 0): Token {
    while (this.buffer.length <= ahead) this.buffer.push(this.read());
    return this.buffer[ahead]!;
  }
  next(): Token {
    const token = this.peek();
    if (token.t !== "eof") this.buffer.shift();
    return token;
  }
  private read(): Token {
    const { source } = this;
    while (/\s/.test(source[this.pos] ?? "x")) this.pos++;
    const i = this.pos;
    if (i >= source.length)
      return { t: "eof", text: "", start: source.length, end: source.length };
    const c = source[i]!;
    if (c === '"') {
      const [token, next] = lexString(source, i);
      this.pos = next;
      return token;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < source.length && IDENT_PART.test(source[j]!)) j++;
      this.pos = j;
      return { t: "ident", text: source.slice(i, j), start: i, end: j };
    }
    if (/\d/.test(c) || (c === "-" && /\d/.test(source[i + 1] ?? ""))) {
      NUMBER.lastIndex = i;
      const text = NUMBER.exec(source)![0];
      this.pos = i + text.length;
      return { t: "number", text, start: i, end: this.pos };
    }
    if ("()[]{},:".includes(c)) {
      this.pos = i + 1;
      return { t: "punct", text: c as "(", start: i, end: i + 1 };
    }
    if (c === "$")
      return fail(
        "Bindings ($name) are not supported; write a literal value.",
        i,
      );
    if (c === "`" || c === "'")
      return fail("Write strings with double quotes.", i);
    if (c === "-" || OPERATORS.includes(c))
      return fail(
        `Expressions are not supported ("${c}"); write a literal value.`,
        i,
      );
    return fail(`Unexpected character "${c}".`, i);
  }
}

/**
 * Parse every statement in `source`. After an error, parsing resumes at the
 * next line that begins in column one with `name(`; a component whose text
 * itself has such a line inside a broken string can therefore be split, which
 * is acceptable for text already reported as malformed.
 */
export function parseStatements(source: string): Statement[] {
  const out: Statement[] = [];
  const callLine = /^[A-Za-z_]\w*[ \t]*\(/gm;
  let from = 0;
  for (;;) {
    while (from < source.length && /\s/.test(source[from]!)) from++;
    if (from >= source.length) return out;
    const lexer = new Lexer(source, from);
    const parser = new Parser(lexer);
    try {
      const call = parser.statement();
      const end = call.end;
      let after: Token | null = null;
      try {
        after = lexer.peek();
      } catch (error) {
        // A lexical error in the next statement is reported with that statement.
        if (!(error instanceof Fail)) throw error;
      }
      if (
        after &&
        after.t !== "eof" &&
        !source.slice(end, after.start).includes("\n")
      )
        fail("Start each component on its own line.", after.start, after.end);
      out.push({ ok: true, call, start: from, end });
      from = end;
    } catch (error) {
      if (!(error instanceof Fail)) throw error;
      callLine.lastIndex = Math.max(error.info.start, from + 1);
      const next = callLine.exec(source)?.index ?? source.length;
      out.push({ ok: false, error: error.info, start: from, end: next });
      from = next;
    }
  }
}

class Parser {
  private readonly lexer: Lexer;
  constructor(lexer: Lexer) {
    this.lexer = lexer;
  }
  private get peek(): Token {
    return this.lexer.peek();
  }
  private next(): Token {
    return this.lexer.next();
  }
  private isPunct(text: string): boolean {
    return this.peek.t === "punct" && this.peek.text === text;
  }
  private expect(text: string, after: string): Token {
    if (!this.isPunct(text)) {
      const t = this.peek;
      return fail(
        t.t === "eof"
          ? `Expected "${text}" ${after}, found the end of the component.`
          : `Expected "${text}" ${after}.`,
        t.start,
        Math.max(t.end, t.start + 1),
      );
    }
    return this.next();
  }
  statement(): CallNode {
    const t = this.peek;
    if (t.t !== "ident")
      return fail(
        "Start a component with its name, as in name(key: value).",
        t.start,
        Math.max(t.end, t.start + 1),
      );
    return this.call();
  }
  private call(): CallNode {
    const name = this.next();
    this.expect("(", `after "${name.text}"`);
    const args = this.fields(")", "an argument", name.text);
    const close = this.expect(")", `to close ${name.text}(`);
    return {
      kind: "call",
      name: name.text,
      nameSpan: { start: name.start, end: name.end },
      args,
      start: name.start,
      end: close.end,
    };
  }
  /** `key: value, …` up to the closer; used by calls (named args) and objects. */
  private fields(closer: ")" | "}", what: string, owner?: string): Field[] {
    const fields: Field[] = [];
    while (!this.isPunct(closer)) {
      const key = this.peek;
      if (key.t === "eof")
        return fail(
          `Expected "${closer}" ${owner ? `to close ${owner}(` : "to close the object"}, found the end of the component.`,
          key.start,
        );
      const isKey = key.t === "ident" || (closer === "}" && key.t === "string");
      if (!isKey)
        return fail(
          closer === ")"
            ? `Arguments must be named: write ${owner ?? "name"}(field: value). Found ${describe(key)} where ${what} should begin.`
            : `Object keys are names, as in {name: value}; found ${describe(key)}.`,
          key.start,
          Math.max(key.end, key.start + 1),
        );
      this.next();
      if (!this.isPunct(":"))
        return fail(
          closer === ")"
            ? `Arguments must be named: write "${key.text}: value"; "${key.text}" has no ":" after it.`
            : `Expected ":" after the key "${key.text}".`,
          this.peek.start,
          Math.max(this.peek.end, this.peek.start + 1),
        );
      this.next();
      const value = this.value();
      fields.push({
        key: key.text,
        keySpan: { start: key.start, end: key.end },
        value,
      });
      if (this.isPunct(",")) this.next();
      else if (!this.isPunct(closer)) {
        const t = this.peek;
        return fail(
          t.t === "eof"
            ? `Expected "," or "${closer}", found the end of the component.`
            : `Expected "," or "${closer}" after the value of "${key.text}".`,
          t.start,
          Math.max(t.end, t.start + 1),
        );
      }
    }
    return fields;
  }
  private value(): Node {
    const t = this.peek;
    const span = { start: t.start, end: t.end };
    switch (t.t) {
      case "string":
        this.next();
        return { kind: "string", value: t.text, ...span };
      case "number":
        this.next();
        return { kind: "number", value: Number(t.text), ...span };
      case "ident": {
        const ahead = this.lexer.peek(1);
        if (ahead.t === "punct" && ahead.text === "(") return this.call();
        this.next();
        if (t.text === "true" || t.text === "false")
          return { kind: "boolean", value: t.text === "true", ...span };
        if (t.text === "null") return { kind: "null", ...span };
        return { kind: "word", value: t.text, ...span };
      }
      case "punct":
        if (t.text === "[") return this.list();
        if (t.text === "{") return this.object();
        return fail(`Expected a value, found "${t.text}".`, t.start, t.end);
      case "eof":
        return fail(
          "Expected a value, found the end of the component.",
          t.start,
        );
    }
  }
  private list(): Node {
    const open = this.next();
    const items: Node[] = [];
    while (!this.isPunct("]")) {
      if (this.peek.t === "eof")
        return fail(
          'Expected "]" to close the list, found the end of the component.',
          this.peek.start,
        );
      items.push(this.value());
      if (this.isPunct(",")) this.next();
      else if (!this.isPunct("]"))
        return fail(
          'Expected "," or "]" in the list.',
          this.peek.start,
          Math.max(this.peek.end, this.peek.start + 1),
        );
    }
    const close = this.next();
    return { kind: "list", items, start: open.start, end: close.end };
  }
  private object(): Node {
    const open = this.next();
    const fields = this.fields("}", "a key");
    const close = this.expect("}", "to close the object");
    return { kind: "object", fields, start: open.start, end: close.end };
  }
}

function describe(t: Token): string {
  return t.t === "string"
    ? "a string"
    : t.t === "number"
      ? "a number"
      : t.t === "punct"
        ? `"${t.text}"`
        : "something else";
}
