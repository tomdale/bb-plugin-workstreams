/*
 * Writes a component in the compact syntax, in the layout the examples teach:
 * fields in schema order, one line when it fits, otherwise one field or list
 * entry per line. Multi-line text becomes a """ string when the lexer can read
 * it back unchanged. `compileComponents(formatComponent(x))` returns `x`.
 */
import { CATALOG, type ObjectShape, type Shape } from "./replyCatalog.ts";
import type { ReplyComponent } from "./replyComponents.ts";

const WIDTH = 100;

function rawString(text: string): boolean {
  return (
    text.includes("\n") &&
    !text.includes('"""') &&
    !text.includes("\r") &&
    !/^[ \t]*\n/.test(text) &&
    !/\n[ \t]*$/.test(text)
  );
}

function flat(value: unknown, shape: Shape): string | null {
  switch (shape.kind) {
    case "enum":
      return String(value);
    case "text":
      return rawString(value as string) ? null : JSON.stringify(value);
    case "number":
    case "boolean":
      return String(value);
    case "list": {
      const parts = (value as unknown[]).map((item) => flat(item, shape.item));
      return parts.includes(null) ? null : `[${parts.join(", ")}]`;
    }
    case "object": {
      const parts = fieldParts(value as Record<string, unknown>, shape, flat);
      return parts.some((p) => p === null) ? null : `{${parts.join(", ")}}`;
    }
    case "children": {
      const parts = (value as unknown[]).map((item) =>
        Array.isArray(item) ? flatList(item) : flatCall(item as ReplyComponent),
      );
      return parts.includes(null) ? null : `[${parts.join(", ")}]`;
    }
  }
}
function flatList(items: ReplyComponent[]): string | null {
  const parts = items.map(flatCall);
  return parts.includes(null) ? null : `[${parts.join(", ")}]`;
}
function flatCall(component: ReplyComponent): string | null {
  const shape = CATALOG[component.type]!;
  const parts = fieldParts(component as Record<string, unknown>, shape, flat);
  return parts.some((p) => p === null)
    ? null
    : `${component.type}(${parts.join(", ")})`;
}
function fieldParts(
  value: Record<string, unknown>,
  shape: ObjectShape,
  render: (value: unknown, shape: Shape) => string | null,
): (string | null)[] {
  return shape.fields
    .filter((field) => value[field.name] !== undefined)
    .map((field) => {
      const text = render(value[field.name], field.shape);
      return text === null ? null : `${field.name}: ${text}`;
    });
}

function expand(value: unknown, shape: Shape, indent: string): string {
  const inline = flat(value, shape);
  if (inline !== null && indent.length + inline.length <= WIDTH) return inline;
  const inner = `${indent}  `;
  const block = (open: string, close: string, lines: string[]) =>
    `${open}\n${lines.map((line) => `${inner}${line},`).join("\n")}\n${indent}${close}`;
  switch (shape.kind) {
    case "text": {
      const text = value as string;
      return rawString(text) ? `"""\n${text}\n"""` : JSON.stringify(text);
    }
    case "list":
      return block(
        "[",
        "]",
        (value as unknown[]).map((item) => expand(item, shape.item, inner)),
      );
    case "object":
      return block(
        "{",
        "}",
        fieldParts(value as Record<string, unknown>, shape, (v, s) =>
          expand(v, s, inner),
        ) as string[],
      );
    case "children":
      return block(
        "[",
        "]",
        (value as unknown[]).map((item) =>
          Array.isArray(item)
            ? `[\n${item
                .map(
                  (c) =>
                    `${inner}  ${expandCall(c as ReplyComponent, `${inner}  `)},`,
                )
                .join("\n")}\n${inner}]`
            : expandCall(item as ReplyComponent, inner),
        ),
      );
    default:
      return flat(value, shape)!;
  }
}
function expandCall(component: ReplyComponent, indent: string): string {
  const inline = flatCall(component);
  if (inline !== null && indent.length + inline.length <= WIDTH) return inline;
  const shape = CATALOG[component.type]!;
  const inner = `${indent}  `;
  const lines = fieldParts(
    component as Record<string, unknown>,
    shape,
    (v, s) => expand(v, s, inner),
  ) as string[];
  return `${component.type}(\n${lines.map((l) => `${inner}${l},`).join("\n")}\n${indent})`;
}

export function formatComponent(component: ReplyComponent): string {
  return expandCall(component, "");
}
