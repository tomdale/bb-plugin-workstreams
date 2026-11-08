import type { ReactNode } from "react";
import { CountPill } from "../../src/app/primitives/CountPill";
import { KeyChip } from "../../src/app/primitives/KeyChip";
import { SectionHeading } from "../../src/app/primitives/SectionHeading";
import { StatusDot } from "../../src/app/primitives/StatusDot";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DISABLED_CLASS,
  MENU_ITEM_HIGHLIGHT_TEXT_CLASS,
  MENU_LABEL_CLASS,
  MENU_SEPARATOR_CLASS,
  menuSurfaceClass,
  type MenuWidth,
} from "../../src/app/primitives/menu";
import { cn } from "@/lib/utils";
import {
  allocateFamilyColor,
  workstreamColorStyle,
} from "../../src/domain/workstreamColor";
import { LiveExample, Variant, Variants } from "../ExampleFrame";
import type { GalleryExample } from "../examples";

const PRIMITIVES = "src/app/primitives/";

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">{children}</div>
  );
}

const dotTones = [
  { label: "Complete", tone: "bg-(--ws-complete)" },
  { label: "Waiting", tone: "animate-pulse bg-(--ws-waiting)" },
  { label: "Needs you", tone: "bg-(--ws-needs-you)" },
  { label: "Failure", tone: "bg-(--ws-failure)" },
  { label: "Quiet", tone: "bg-muted-foreground/50" },
];

function StatusDotExample() {
  return (
    <LiveExample name="StatusDot" sources={[`${PRIMITIVES}StatusDot.tsx`]}>
      <Variants minWidth="16rem">
        <Variant
          label="State tones"
          note="A tone is a background class; each dot sits beside the word that names it."
        >
          <div className="flex flex-col gap-2 text-sm">
            {dotTones.map(({ label, tone }) => (
              <Row key={label}>
                <StatusDot tone={tone} />
                {label}
              </Row>
            ))}
          </div>
        </Variant>
        <Variant label="Sizes" note="xs, sm, and md.">
          <Row>
            {(["xs", "sm", "md"] as const).map((size) => (
              <span key={size} className="flex items-center gap-2">
                <StatusDot size={size} tone="bg-(--ws-review)" />
                {size}
              </span>
            ))}
          </Row>
        </Variant>
        <Variant
          label="Workstream and hollow"
          note="Home's group heads: the topic's hue, or a ring that holds its place."
        >
          <div className="flex flex-col gap-2 text-sm">
            <Row>
              <StatusDot
                size="md"
                workstream
                style={
                  workstreamColorStyle(
                    allocateFamilyColor([]),
                  ) as React.CSSProperties
                }
              />
              Release tools
            </Row>
            <Row>
              <StatusDot size="md" hollow />
              Unfiled
            </Row>
          </div>
        </Variant>
      </Variants>
    </LiveExample>
  );
}

function CountPillExample() {
  return (
    <LiveExample name="CountPill" sources={[`${PRIMITIVES}CountPill.tsx`]}>
      <Variants minWidth="16rem">
        <Variant label="Compact" note="Sidebar group headers.">
          <Row>
            Release tools <CountPill>2</CountPill>
          </Row>
        </Variant>
        <Variant label="Roomy" note="Home group heads.">
          <Row>
            Release tools <CountPill size="roomy">2</CountPill>
          </Row>
        </Variant>
        <Variant label="Wide count">
          <Row>
            <CountPill>12</CountPill>
            <CountPill size="roomy">12</CountPill>
          </Row>
        </Variant>
      </Variants>
    </LiveExample>
  );
}

function KeyChipExample() {
  return (
    <LiveExample name="KeyChip" sources={[`${PRIMITIVES}KeyChip.tsx`]}>
      <Variants minWidth="16rem">
        <Variant label="Default" note="Queue actions and answers.">
          <Row>
            Undo <KeyChip>U</KeyChip>
            Send <KeyChip>↵</KeyChip>
            Cancel <KeyChip>Esc</KeyChip>
          </Row>
        </Variant>
        <Variant label="Bright" note="The key that would act now.">
          <Row>
            Answer <KeyChip bright>1</KeyChip>
          </Row>
        </Variant>
        <Variant label="Inline" note="A sentence of shortcuts.">
          <p className="text-xs text-muted-foreground">
            <KeyChip inline>j</KeyChip> <KeyChip inline>k</KeyChip> move ·{" "}
            <KeyChip inline>a</KeyChip> accept
          </p>
        </Variant>
      </Variants>
    </LiveExample>
  );
}

function SectionHeadingExample() {
  return (
    <LiveExample
      name="SectionHeading"
      sources={[`${PRIMITIVES}SectionHeading.tsx`]}
    >
      <Variants minWidth="18rem">
        <Variant label="Title only">
          <SectionHeading>Project associations</SectionHeading>
        </Variant>
        <Variant
          label="With a count"
          note="Trailing content sets its own type."
        >
          <SectionHeading className="flex items-baseline gap-2">
            Needs review
            <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
              3
            </span>
          </SectionHeading>
        </Variant>
        <Variant label="With an action">
          <SectionHeading className="flex items-center gap-2">
            Topics
            <span className="flex-1" />
            <span className="font-normal normal-case tracking-normal">
              New topic…
            </span>
          </SectionHeading>
        </Variant>
      </Variants>
    </LiveExample>
  );
}

function MenuSpecimen({
  width,
  highlighted,
}: {
  width: MenuWidth;
  highlighted?: string;
}) {
  const item = (label: string, extra?: string) => (
    <div
      role="menuitem"
      aria-disabled={extra === "disabled" || undefined}
      data-highlighted={label === highlighted ? "" : undefined}
      data-disabled={extra === "disabled" ? "" : undefined}
      className={cn(
        MENU_ITEM_CLASS,
        MENU_ITEM_HIGHLIGHT_TEXT_CLASS,
        MENU_ITEM_DISABLED_CLASS,
      )}
    >
      {label}
    </div>
  );
  return (
    <div
      role="menu"
      aria-label={`Menu, width ${width}`}
      className={cn(menuSurfaceClass(width), "w-full")}
    >
      <div className={MENU_LABEL_CLASS}>Sort workstreams</div>
      {item("Alphabetical")}
      {item("Recent activity", "highlighted")}
      {item("Manual", "disabled")}
      <div className={MENU_SEPARATOR_CLASS} />
      {item("Rename…")}
    </div>
  );
}

function MenuExample() {
  return (
    <LiveExample name="Menu classes" sources={[`${PRIMITIVES}menu.ts`]}>
      <Variants minWidth="16rem">
        <Variant
          label="Resting and highlighted"
          note="The second row shows the highlighted item; the third is disabled."
        >
          <MenuSpecimen width="48" highlighted="Recent activity" />
        </Variant>
        <Variant
          label="Wider surface"
          note="Surface widths: 48, 52, 56, and 60."
        >
          <MenuSpecimen width="60" />
        </Variant>
      </Variants>
    </LiveExample>
  );
}

export const primitiveExamples: GalleryExample[] = [
  {
    id: "status-dot",
    title: "Status dot",
    group: "Primitives",
    description:
      "A small colored circle in three sizes: state, workstream, or hollow.",
    source: `import { StatusDot } from "../src/app/primitives/StatusDot";\n\n<StatusDot tone="bg-(--ws-complete)" />\n<StatusDot size="sm" tone="bg-(--ws-needs-you)" />\n<StatusDot size="md" workstream style={workstreamColorStyle(color)} />\n<StatusDot size="md" hollow />`,
    render: () => <StatusDotExample />,
  },
  {
    id: "count-pill",
    title: "Count pill",
    group: "Primitives",
    description: "The Needs you count on group headers, compact and roomy.",
    source: `import { CountPill } from "../src/app/primitives/CountPill";\n\n<CountPill>2</CountPill>\n<CountPill size="roomy">2</CountPill>`,
    render: () => <CountPillExample />,
  },
  {
    id: "key-chip",
    title: "Key chip",
    group: "Primitives",
    description:
      "An outlined key for a shortcut, in default, bright, and inline forms.",
    source: `import { KeyChip } from "../src/app/primitives/KeyChip";\n\n<KeyChip>U</KeyChip>\n<KeyChip bright>1</KeyChip>\n<KeyChip inline>j</KeyChip>`,
    render: () => <KeyChipExample />,
  },
  {
    id: "section-heading",
    title: "Section heading",
    group: "Primitives",
    description: "The small uppercase heading over a page section.",
    source: `import { SectionHeading } from "../src/app/primitives/SectionHeading";\n\n<SectionHeading>Project associations</SectionHeading>\n<SectionHeading className="flex items-baseline gap-2">Needs review <span>3</span></SectionHeading>`,
    render: () => <SectionHeadingExample />,
  },
  {
    id: "menu-classes",
    title: "Menu classes",
    group: "Primitives",
    description:
      "The surface, item, label, and separator classes of Workstreams' own menus.",
    source: `import { MENU_ITEM_CLASS, MENU_LABEL_CLASS, MENU_SEPARATOR_CLASS, menuSurfaceClass } from "../src/app/primitives/menu";\n\n<DropdownMenu.Content className={menuSurfaceClass("48")}>\n  <DropdownMenu.Label className={MENU_LABEL_CLASS}>Sort</DropdownMenu.Label>\n  <DropdownMenu.Item className={MENU_ITEM_CLASS}>Alphabetical</DropdownMenu.Item>\n  <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />\n</DropdownMenu.Content>`,
    render: () => <MenuExample />,
  },
];
