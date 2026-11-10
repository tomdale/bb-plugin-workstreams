/*
 * The compact component syntax: `name(key: value, …)` calls over static
 * values. Values are strings, numbers, booleans, null, lists, objects, bare
 * words, and nested calls. Nothing is evaluated, so operators, templates, and
 * bindings are lexical errors rather than ignored text. This module knows
 * grammar only; field names, types, and limits belong to the schemas that
 * `replyCompile.ts` applies.
 *
 * The documented form is strict, but the reader is forgiving wherever the
 * writer's intent is unambiguous, because a model's near miss should still
 * render: single, curly, and backtick quotes; a double-quoted string that
 * spans lines or holds unescaped quotes; unknown escapes kept literally;
 * `"""` text dedented; `=` for `:`; missing, doubled, and trailing commas or
 * semicolons; positional arguments (a field with a null key, resolved against
 * the schema later); unquoted text, read as raw source up to the next field;
 * several components on one line; `//` comments; and a JSON object or list of
 * objects whose `type` names the component.
 *
 * Closing punctuation is forgiving too, because a call whose values are all
 * lists of objects reads like JSON and writers close it with `}` instead of
 * `)`. Any of `)`, `]`, and `}` ends the entry list or list it closes, a
 * container the writer never closed ends with the component itself, and a
 * component name that begins a line in column one ends the container the
 * writer left open before it. Stray closers and sentence punctuation between
 * components are skipped.
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
/** A named or, with a null key, positional argument or object entry. */
export type Field = { key: string | null; keySpan: Span; value: Node };
export type CallNode = Extract<Node, { kind: "call" }>;

export type Statement =
  | { ok: true; call: CallNode; start: number; end: number }
  | { ok: false; error: SyntaxIssue; start: number; end: number };

type PunctText = "(" | ")" | "[" | "]" | "{" | "}" | "," | ":" | "=" | ";";
type Token = Span &
  (
    | { t: "ident" | "string" | "number" | "eof"; text: string }
    | { t: "punct"; text: PunctText }
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

const OPERATORS = "+*/%<>!?&|^~";
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
/** Characters that can begin unquoted text: letters, digits, Markdown marks, and symbols such as ✓. */
const LOOSE_START = /[\p{L}\p{N}\p{So}\p{Sk}_*#>@!~&-]/u;
/** Opening quote → closing quote for the single-line quote styles. */
const QUOTES: Record<string, string> = {
  "'": "'",
  "`": "`",
  "\u201c": "\u201d",
  "\u2018": "\u2019",
};
/** Punctuation that closes a container, or that no statement can begin with. */
const CLOSERS = [")", "]", "}"] as const;
const BETWEEN_STATEMENTS = /[\s,;)\]}.]/;

/** What may follow a closing quote: the end of the value, an operator, or a new field. */
const AFTER_STRING =
  /^[ \t]*(?:$|[\r\n,;:=)\]}+]|\/\/)|^[ \t]+[A-Za-z_]\w*[ \t]*[:=]/;
const STATEMENT_LINE = /\n[A-Za-z_]\w*[ \t]*\(/;

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

/** JSON escapes; an unknown escape such as `\d` or `\*` keeps its backslash. */
function unescape(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (whole, c: string) =>
    c.length === 5
      ? String.fromCharCode(parseInt(c.slice(1), 16))
      : (({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as const)[c as "n"] ??
        ("\"'`\\/".includes(c) ? c : whole)),
  );
}

/**
 * Remove the indentation every content line shares, so a `"""` block indented
 * with its call reads as written. A first line that starts right after the
 * opening quotes does not count toward the shared indentation.
 */
export function dedent(raw: string): string {
  const lines = raw.split("\n");
  const counted = lines.filter(
    (line, i) => line.trim() && !(i === 0 && !/^[ \t]/.test(line)),
  );
  if (!counted.length) return raw;
  let prefix = /^[ \t]*/.exec(counted[0]!)![0];
  for (const line of counted)
    while (prefix && !line.startsWith(prefix)) prefix = prefix.slice(0, -1);
  if (!prefix) return raw;
  return lines
    .map((line, i) =>
      line.startsWith(prefix)
        ? line.slice(prefix.length)
        : i > 0 && !line.trim()
          ? ""
          : line,
    )
    .join("\n");
}

function lexTriple(source: string, at: number, quote: string): [Token, number] {
  const close = source.indexOf(quote, at + 3);
  if (close === -1)
    return fail(
      `Unterminated ${quote} string; close it with ${quote}.`,
      at,
      at + 3,
    );
  const raw = dedent(
    source
      .slice(at + 3, close)
      .replace(/^[ \t]*\r?\n/, "")
      .replace(/\r?\n[ \t]*$/, ""),
  );
  return [{ t: "string", text: raw, start: at, end: close + 3 }, close + 3];
}

/**
 * The closing quote of a string opened at `at`: the first unescaped `close`
 * that a value boundary follows, so quotes inside the text stay text. The
 * string may span lines but not run into a line that starts a new component.
 * When no quote qualifies, the first one on the opening line closes it.
 */
function closingQuote(source: string, at: number, close: string): number {
  let first = -1;
  for (let i = at + 1; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "\n" && STATEMENT_LINE.test(source.slice(i, i + 200))) break;
    if (c !== close) continue;
    if (first === -1 && !source.slice(at, i).includes("\n")) first = i;
    if (AFTER_STRING.test(source.slice(i + 1, i + 200))) return i;
  }
  return first;
}

function lexString(source: string, at: number): [Token, number] {
  if (source.startsWith('"""', at)) return lexTriple(source, at, '"""');
  if (source.startsWith("'''", at)) return lexTriple(source, at, "'''");
  const open = source[at]!;
  const end = closingQuote(source, at, open === '"' ? '"' : QUOTES[open]!);
  if (end === -1)
    return fail(
      'Unterminated string; close it, or use a """ string for several lines.',
      at,
      source.indexOf("\n", at) === -1
        ? source.length
        : source.indexOf("\n", at),
    );
  const text = unescape(source.slice(at + 1, end).replace(/\r\n/g, "\n"));
  return [{ t: "string", text, start: at, end: end + 1 }, end + 1];
}

/** Pull-based lexer: a lexical error surfaces only when the parser reaches that token. */
class Lexer {
  private buffer: Token[] = [];
  private pos: number;
  readonly source: string;
  constructor(source: string, from: number) {
    this.source = source;
    this.pos = from;
  }
  peek(ahead = 0): Token {
    while (this.buffer.length <= ahead) this.buffer.push(this.read());
    return this.buffer[ahead]!;
  }
  /** Like peek, but a lexical error reads as null. */
  look(ahead = 0): Token | null {
    try {
      return this.peek(ahead);
    } catch (error) {
      if (error instanceof Fail) return null;
      throw error;
    }
  }
  next(): Token {
    const token = this.peek();
    if (token.t !== "eof") this.buffer.shift();
    return token;
  }
  /** Discard buffered tokens and continue lexing at `offset`. */
  seek(offset: number) {
    this.buffer = [];
    this.pos = offset;
  }
  private skipSpace() {
    const { source } = this;
    for (;;) {
      while (/\s/.test(source[this.pos] ?? "x")) this.pos++;
      if (!source.startsWith("//", this.pos)) return;
      const eol = source.indexOf("\n", this.pos);
      this.pos = eol === -1 ? source.length : eol;
    }
  }
  private read(): Token {
    const { source } = this;
    this.skipSpace();
    const i = this.pos;
    if (i >= source.length)
      return { t: "eof", text: "", start: source.length, end: source.length };
    const c = source[i]!;
    if (c === '"' || c in QUOTES) {
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
    if ("()[]{},:=;".includes(c)) {
      this.pos = i + 1;
      return { t: "punct", text: c as PunctText, start: i, end: i + 1 };
    }
    if (c === "$")
      return fail(
        "Bindings ($name) are not supported; write a literal value.",
        i,
      );
    if (c === "-" || OPERATORS.includes(c))
      return fail(
        `Expressions are not supported ("${c}"); write a literal value.`,
        i,
      );
    return fail(`Unexpected character "${c}".`, i);
  }
}

/**
 * Unquoted text starting at `from`: raw source up to the unmatched bracket
 * that closes its container, or a comma or line break that a new field or the
 * closer follows. Commas inside the text therefore stay text.
 */
function looseEnd(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && (c === "," || c === ";" || c === "\n")) {
      const rest = source.slice(i + 1, i + 200);
      if (/^\s*(?:[A-Za-z_]\w*\s*[:=]|[)\]}]|$)/.test(rest)) return i;
      if (c === "\n" && /^[A-Za-z_]\w*[ \t]*\(/.test(rest)) return i;
    }
  }
  return source.length;
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
    while (from < source.length && BETWEEN_STATEMENTS.test(source[from]!))
      from++;
    if (source.startsWith("//", from)) {
      const eol = source.indexOf("\n", from);
      from = eol === -1 ? source.length : eol;
      continue;
    }
    if (from >= source.length) return out;
    const lexer = new Lexer(source, from);
    const parser = new Parser(lexer);
    try {
      const { calls, end } = parser.statement();
      for (const call of calls) out.push({ ok: true, call, start: from, end });
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

const isTerminator = (t: Token | null) =>
  t !== null &&
  (t.t === "eof" ||
    (t.t === "punct" &&
      (t.text === "," ||
        t.text === ";" ||
        CLOSERS.some((closer) => closer === t.text))));
const isSeparator = (t: Token | null) =>
  t?.t === "punct" && (t.text === ":" || t.text === "=");

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
  private skipCommas() {
    while (this.isPunct(",") || this.isPunct(";")) this.next();
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
  /** A call, or a JSON-style object or list of objects whose `type` names each component. */
  statement(): { calls: CallNode[]; end: number } {
    const t = this.peek;
    if (t.t === "punct" && (t.text === "{" || t.text === "[")) {
      const value = this.value();
      const items = value.kind === "list" ? value.items : [value];
      return {
        calls: items.map((item) => typedObjectCall(item) ?? notComponent(item)),
        end: value.end,
      };
    }
    if (t.t !== "ident")
      return fail(
        "Start a component with its name, as in name(key: value).",
        t.start,
        Math.max(t.end, t.start + 1),
      );
    const call = this.call();
    return { calls: [call], end: call.end };
  }
  private call(): CallNode {
    const name = this.next();
    const open = this.expect("(", `after "${name.text}"`);
    const { fields: args, end } = this.entries(open.end);
    return {
      kind: "call",
      name: name.text,
      nameSpan: { start: name.start, end: name.end },
      args,
      start: name.start,
      end,
    };
  }
  /** Whether the next token ends the container, by a closer or by the component's end. */
  private closes(): boolean {
    const t = this.peek;
    return (
      t.t === "eof" ||
      (t.t === "punct" && CLOSERS.some((closer) => closer === t.text))
    );
  }
  /**
   * `key: value` entries up to the closer or the end of the component, for
   * calls and objects. A value with no key before it is positional; a key that
   * directly follows a value is read as if a comma separated them. A closer
   * that does not match the one that opened the container still ends it, so
   * does the end of the component, and so does the next component's name at the
   * start of a line, because each means the writer finished.
   */
  private entries(openEnd: number): { fields: Field[]; end: number } {
    const fields: Field[] = [];
    let end = openEnd;
    this.skipCommas();
    while (!this.closes() && !(fields.length && this.startsComponent())) {
      const key = this.peek;
      const named =
        (key.t === "ident" || key.t === "string") &&
        isSeparator(this.lexer.look(1));
      let field: Field;
      if (named) {
        this.next();
        this.next();
        field = {
          key: key.text,
          keySpan: { start: key.start, end: key.end },
          value: this.value(),
        };
      } else {
        const value = this.value();
        field = {
          key: null,
          keySpan: { start: value.start, end: value.end },
          value,
        };
      }
      fields.push(field);
      end = field.value.end;
      if (this.isPunct(",") || this.isPunct(";")) this.skipCommas();
      else if (!this.closes() && !this.startsValue()) {
        const t = this.peek;
        return fail(
          `Expected "," or ")" after the value${named ? ` of "${key.text}"` : ""}.`,
          t.start,
          Math.max(t.end, t.start + 1),
        );
      }
    }
    return { fields, end: this.closes() ? this.next().end : end };
  }
  /**
   * Whether the next token begins a component of its own: a name at the start of
   * a line in column one, followed by `(`. A writer who leaves a container open
   * and starts the next component means two statements, not a component that
   * holds the other.
   */
  private startsComponent(): boolean {
    const t = this.peek;
    if (
      t.t !== "ident" ||
      (t.start !== 0 && this.lexer.source[t.start - 1] !== "\n")
    )
      return false;
    return /^[A-Za-z_]\w*[ \t]*\(/.test(this.lexer.source.slice(t.start));
  }
  /** Whether the next token can begin another entry, for a missing comma. */
  private startsValue(): boolean {
    const t = this.peek;
    return (
      t.t === "ident" ||
      t.t === "string" ||
      t.t === "number" ||
      (t.t === "punct" && (t.text === "[" || t.text === "{"))
    );
  }
  /** Unquoted text from `start`, read as raw source. */
  private loose(start: number): Node {
    const { source } = this.lexer;
    const end = looseEnd(source, start);
    const value = source.slice(start, end).trim();
    const stop = start + source.slice(start, end).trimEnd().length;
    this.lexer.seek(stop);
    return { kind: "word", value, start, end: stop };
  }
  /**
   * Whether the token after a word or number continues the same unquoted
   * text rather than ending the value or starting the next field.
   */
  private continuesText(): boolean {
    const after = this.lexer.look(1);
    if (isTerminator(after)) return false;
    if (after && (after.t === "ident" || after.t === "string")) {
      const then = this.lexer.look(2);
      if (isSeparator(then)) return false;
    }
    return true;
  }
  private value(): Node {
    let t: Token;
    try {
      t = this.peek;
    } catch (error) {
      if (!(error instanceof Fail)) throw error;
      const at = error.info.start;
      if (LOOSE_START.test(this.lexer.source[at] ?? "")) return this.loose(at);
      throw error;
    }
    const span = { start: t.start, end: t.end };
    switch (t.t) {
      case "string":
        this.next();
        return { kind: "string", value: t.text, ...span };
      case "number":
        if (this.continuesText()) return this.loose(t.start);
        this.next();
        return { kind: "number", value: Number(t.text), ...span };
      case "ident": {
        const ahead = this.lexer.look(1);
        if (ahead?.t === "punct" && ahead.text === "(" && ahead.start === t.end)
          return this.call();
        if (ahead?.t === "punct" && ahead.text === "(") {
          // `name (` is a call only when the name could be one; otherwise text.
          const lexer = this.lexer;
          const after = lexer.source.slice(ahead.end).trimStart();
          if (/^(?:[A-Za-z_]\w*\s*[:=]|\)|[[{"])/.test(after))
            return this.call();
        }
        if (this.continuesText()) return this.loose(t.start);
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
    this.skipCommas();
    while (!this.closes()) {
      items.push(this.value());
      if (this.isPunct(",") || this.isPunct(";")) this.skipCommas();
      else if (!this.closes() && !this.startsValue())
        return fail(
          'Expected "," or "]" in the list.',
          this.peek.start,
          Math.max(this.peek.end, this.peek.start + 1),
        );
    }
    const end = this.closes()
      ? this.next().end
      : (items.at(-1)?.end ?? open.end);
    return { kind: "list", items, start: open.start, end };
  }
  private object(): Node {
    const open = this.next();
    const { fields, end } = this.entries(open.end);
    return { kind: "object", fields, start: open.start, end };
  }
}

/**
 * A JSON-style component, `{"type": "name", …}`, as the call it stands for;
 * nested values that are typed objects become calls too, so a group's
 * children read the same way.
 */
function typedObjectCall(node: Node): CallNode | null {
  if (node.kind !== "object") return null;
  const type = node.fields.find(
    (f) =>
      f.key === "type" &&
      (f.value.kind === "string" || f.value.kind === "word"),
  );
  if (!type) return null;
  const name = (type.value as { value: string }).value;
  return {
    kind: "call",
    name,
    nameSpan: { start: type.value.start, end: type.value.end },
    args: node.fields
      .filter((f) => f !== type)
      .map((f) => ({ ...f, value: typedValue(f.value) })),
    start: node.start,
    end: node.end,
  };
}
function typedValue(node: Node): Node {
  if (node.kind === "list")
    return { ...node, items: node.items.map(typedValue) };
  return typedObjectCall(node) ?? node;
}
function notComponent(node: Node): never {
  return fail(
    'A JSON component needs a "type" naming the component.',
    node.start,
    node.end,
  );
}
