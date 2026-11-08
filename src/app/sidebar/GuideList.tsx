import type { ReactNode } from "react";
import type { LinePrefs } from "../../domain/lines.ts";

export function guideColor(line: LinePrefs) {
  return line.color || "var(--border)";
}

export function guideStep(line: LinePrefs) {
  return line.indent + line.width + line.spacing;
}

export function GuideList({
  line,
  kind,
  children,
  className,
  baseOffset = 0,
}: {
  line: LinePrefs | undefined;
  kind: string;
  children: ReactNode;
  className?: string;
  baseOffset?: number;
}) {
  const enabled = line?.show;
  return (
    <ul
      className={`list-none ${className ?? ""}`}
      data-ws-guide={enabled ? kind : undefined}
      style={
        enabled
          ? {
              paddingLeft: guideStep(line),
              backgroundImage: `linear-gradient(${guideColor(line)}, ${guideColor(line)})`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: `${baseOffset + line.indent}px 0`,
              backgroundSize: `${line.width}px 100%`,
            }
          : undefined
      }
    >
      {children}
    </ul>
  );
}
