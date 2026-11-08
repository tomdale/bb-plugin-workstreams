import {
  clearComponents,
  mountThread,
  mountWorkstreamName,
} from "./components.tsx";
import { appSidebarDefaults } from "./appDefaults.ts";
import { compareGroupNames } from "../../src/domain/group-name-order.ts";
import { workstreamGap } from "../../src/app/sidebar/workstreamGap.ts";

const defaults = {
  grouping: "family",
  sort: "name",
  focus: "off",
  disclosureWorkstream: "always",
  disclosureThread: "current",
  disclosureCategoryThread: "current",
  familyGap: "4",
  itemGap: "12",
  catGap: "12",
  indent: "6",
  statusGap: "6",
  mix: "45",
  width: "280",
  rowHeight: "28",
  headerHeight: "28",
  parentHeight: "22",
  catAfter: "2",
  rowInset: "0",
  categoryIndent: "8",
  categoryRowIndent: "4",
  childIndent: "20",
  categoryChildIndent: "20",
  statusWidth: "14",
  headerGap: "6",
  chevronWidth: "14",
  parentInset: "6",
  sectionGap: "8",
  sectionTop: "2",
  sectionInset: "6",
  sideX: "8",
  sideY: "12",
  tierGap: "16",
  tierLabelTop: "16",
  tierLabelInset: "6",
  tierLabelBottom: "10",
};
const fontSpecs = [
  {
    id: "section",
    name: "Workstreams heading",
    size: 11,
    weight: 600,
    spacing: 0.4,
  },
  { id: "parent", name: "Parent heading", size: 12, weight: 600, spacing: 0 },
  {
    id: "workstream",
    name: "Workstream header",
    size: 13,
    weight: 600,
    spacing: 0,
  },
  {
    id: "inlineWorkstream",
    name: "Workstream with inline parent",
    size: 13,
    weight: 600,
    spacing: 0,
  },
  { id: "prefix", name: "Parent prefix", size: 13, weight: 400, spacing: 0 },
  {
    id: "category",
    name: "Category heading",
    size: 12,
    weight: 500,
    spacing: 0,
  },
  {
    id: "thread",
    name: "Uncategorized thread",
    size: 13,
    weight: 400,
    spacing: 0,
  },
  {
    id: "catThread",
    name: "Categorized thread",
    size: 13,
    weight: 400,
    spacing: 0,
  },
  {
    id: "childThread",
    name: "Uncategorized child thread",
    size: 13,
    weight: 400,
    spacing: 0,
  },
  {
    id: "catChildThread",
    name: "Categorized child thread",
    size: 13,
    weight: 400,
    spacing: 0,
  },
  {
    id: "tier",
    name: "Show other workstreams",
    size: 12,
    weight: 400,
    spacing: 0,
  },
  {
    id: "collapsedParent",
    name: "Collapsed parent heading",
    size: 12,
    weight: 600,
    spacing: 0,
  },
  {
    id: "collapsedWorkstream",
    name: "Collapsed workstream header",
    size: 13,
    weight: 600,
    spacing: 0,
  },
  {
    id: "collapsedThread",
    name: "Collapsed uncategorized thread",
    size: 13,
    weight: 400,
    spacing: 0,
  },
  {
    id: "collapsedCatThread",
    name: "Collapsed categorized thread",
    size: 13,
    weight: 400,
    spacing: 0,
  },
];
const families = {
  app: 'var(--font-sans, "Geist", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
  system: "system-ui, sans-serif",
  serif: "ui-serif, Georgia, serif",
  mono: "ui-monospace, Menlo, monospace",
};
const fontFields = [
  {
    key: "family",
    name: "Font family",
    options: [
      ["app", "BB font"],
      ["system", "System sans"],
      ["serif", "System serif"],
      ["mono", "System mono"],
    ],
  },
  {
    key: "transform",
    name: "Text transform",
    options: [
      ["none", "None"],
      ["uppercase", "Uppercase"],
      ["lowercase", "Lowercase"],
      ["capitalize", "Capitalize"],
    ],
  },
  { key: "size", name: "Size", min: 8, max: 24, step: 1, unit: "px" },
  { key: "weight", name: "Weight", min: 100, max: 900, step: 50, unit: "" },
  { key: "line", name: "Line height", min: 90, max: 180, step: 0.1, unit: "%" },
  {
    key: "spacing",
    name: "Letter spacing",
    min: -0.5,
    max: 2,
    step: 0.1,
    unit: "px",
  },
];
const accentRoles = new Set([
  "parent",
  "workstream",
  "inlineWorkstream",
  "prefix",
  "category",
  "thread",
  "catThread",
  "childThread",
  "catChildThread",
  "collapsedParent",
  "collapsedWorkstream",
  "collapsedThread",
  "collapsedCatThread",
]);
const colorFields = (spec) => [
  {
    key: "color",
    name: "Color",
    options: [
      ["default", "Default"],
      ["foreground", "Foreground"],
      ["muted", "Muted"],
      ...(accentRoles.has(spec.id)
        ? [
            ["accent", "Accent"],
            ["accent-muted", "Accent + muted"],
            ["accent-foreground", "Accent + foreground"],
            ["accent-background", "Accent + background"],
            ["accent-black", "Accent + black"],
            ["accent-white", "Accent + white"],
            ["accent-gray", "Accent + grayscale"],
          ]
        : []),
      ["custom", "Custom"],
    ],
  },
  { key: "customColor", name: "Custom color", type: "color" },
  ...(accentRoles.has(spec.id)
    ? [
        {
          key: "blend",
          name: "Accent share",
          min: 0,
          max: 100,
          step: 5,
          unit: "%",
        },
      ]
    : []),
];
const fieldsFor = (spec) => [...colorFields(spec), ...fontFields];
const fontId = (spec, field) => `font_${spec.id}_${field.key}`;
for (const spec of fontSpecs) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "font-group";
  fieldset.dataset.fontRole = spec.id;
  const legend = document.createElement("legend");
  legend.textContent = spec.name;
  fieldset.append(legend);
  const controls = document.createElement("div");
  controls.className = "controls";
  for (const field of fieldsFor(spec)) {
    const id = fontId(spec, field),
      value =
        field.key === "color"
          ? "default"
          : field.key === "customColor"
            ? "#808080"
            : field.key === "blend"
              ? 70
              : field.key === "line"
                ? 120
                : field.key === "family"
                  ? "app"
                  : field.key === "transform"
                    ? spec.id === "section"
                      ? "uppercase"
                      : "none"
                    : spec[field.key];
    defaults[id] = String(value);
    const wrap = document.createElement("div");
    wrap.className = "control";
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = field.name;
    const input = document.createElement(field.options ? "select" : "input");
    input.id = id;
    if (field.options) {
      for (const [key, name] of field.options) input.add(new Option(name, key));
    } else if (field.type === "color") {
      input.type = "color";
    } else {
      input.type = "number";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      input.dataset.unit = field.unit;
      if (field.key === "line") input.dataset.increment = "5";
    }
    input.value = String(value);
    input.setAttribute(
      "aria-label",
      `${spec.name} ${field.name.toLowerCase()}`,
    );
    wrap.append(label, input);
    if (field.key === "blend") {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Percentage of the contextual accent in the mix";
      wrap.append(hint);
    }
    controls.append(wrap);
  }
  fieldset.append(controls);
  document.getElementById("font-controls").append(fieldset);
}
const extraSpacing = [
  ["collapsedParentBefore", "Before", 0, 0, 40, 1],
  ["collapsedParentHeight", "Height", 22, 0, 80, 1],
  ["collapsedParentAfter", "After", 0, 0, 40, 1],
  ["collapsedParentGap", "Gap after group", 12, 0, 40, 1],
  ["collapsedWorkstreamBefore", "Before", 0, 0, 40, 1],
  ["collapsedWorkstreamHeight", "Height", 28, 0, 80, 1],
  ["collapsedWorkstreamAfter", "After", 0, 0, 40, 1],
  ["collapsedWorkstreamGap", "Gap to next workstream", 12, 0, 40, 1],
  ["collapsedThreadBefore", "Before", 0, 0, 40, 1],
  ["collapsedThreadHeight", "Height", 28, 0, 80, 1],
  ["collapsedThreadAfter", "After", 0, 0, 40, 1],
  ["collapsedCatThreadBefore", "Before", 0, 0, 40, 1],
  ["collapsedCatThreadHeight", "Height", 28, 0, 80, 1],
  ["collapsedCatThreadAfter", "After", 0, 0, 40, 1],
  ["categoryBetween", "Extra between categories", 0, 0, 40, 1],
  ["collapsedInlineFamilyGap", "Collapsed inline boundary extra", 4, 0, 40, 1],
  ["inlineFamilyGap", "Extra at inline parent boundaries", 4, 0, 40, 1],
  ["prefixGap", "Gap to workstream", 4, 0, 40, 1],
  ["topWorkstreamIndent", "Top-level workstream indent", 0, -64, 200, 1],
  ["parentChevronWidth", "Parent chevron slot width", 14, 8, 40, 1],
  ["parentChevronGap", "Parent chevron to name", 6, 0, 40, 1],
  ["sectionHeight", "Workstreams heading height", 13.2, 0, 80, 0.1],
  ["parentBefore", "Before parent heading", 0, 0, 40, 1],
  ["parentAfter", "After parent heading", 0, 0, 40, 1],
  ["workstreamBefore", "Before workstream header", 0, 0, 40, 1],
  ["workstreamAfter", "After workstream header", 0, 0, 40, 1],
  ["categoryHeight", "Category heading height", 14.4, 0, 80, 0.1],
  ["rootBefore", "Before uncategorized thread", 0, 0, 40, 1],
  ["rootAfter", "After uncategorized thread", 0, 0, 40, 1],
  ["catRootBefore", "Before categorized thread", 0, 0, 40, 1],
  ["catRootAfter", "After categorized thread", 0, 0, 40, 1],
  ["catRowHeight", "Categorized thread height", 28, 20, 80, 1],
  ["catStatusGap", "Status icon to title", 6, 0, 40, 1],
  ["catStatusWidth", "Status slot width", 14, 8, 40, 1],
  ["childBefore", "Before uncategorized child", 0, 0, 40, 1],
  ["childAfter", "After uncategorized child", 0, 0, 40, 1],
  ["childRowHeight", "Uncategorized child height", 28, 20, 80, 1],
  ["childStatusGap", "Status icon to title", 6, 0, 40, 1],
  ["childStatusWidth", "Status slot width", 14, 8, 40, 1],
  ["catChildBefore", "Before categorized child", 0, 0, 40, 1],
  ["catChildAfter", "After categorized child", 0, 0, 40, 1],
  ["catChildRowHeight", "Categorized child height", 28, 20, 80, 1],
  ["catChildStatusGap", "Status icon to title", 6, 0, 40, 1],
  ["catChildStatusWidth", "Status slot width", 14, 8, 40, 1],
  ["tierLabelHeight", "Show other workstreams height", 15.2, 0, 80, 0.1],
];
for (const [id, name, value, min, max, step] of extraSpacing) {
  defaults[id] = String(value);
  const wrap = document.createElement("div");
  wrap.className = "control";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = name;
  const input = document.createElement("input");
  input.type = "number";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  wrap.append(label, input);
  if (
    [
      "inlineFamilyGap",
      "categoryBetween",
      "collapsedWorkstreamGap",
      "collapsedParentGap",
      "collapsedInlineFamilyGap",
    ].includes(id)
  ) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      id === "categoryBetween"
        ? "Added before each category after the first"
        : id === "inlineFamilyGap"
          ? "Added where a boundary touches an inline parent."
          : id === "collapsedInlineFamilyGap"
            ? "Used after a collapsed workstream or parent."
            : "Replaces the base gap after a collapsed row; boundary extras still apply.";
    wrap.append(hint);
  }
  document.getElementById("spacing-staging").append(wrap);
}
for (const [id, labelText, options] of [
  [
    "disclosureThreadPlacement",
    "Disclosure placement",
    [
      ["left", "Status slot · left"],
      ["right", "After title"],
    ],
  ],
  [
    "disclosureCategoryThreadPlacement",
    "Disclosure placement",
    [
      ["left", "Status slot · left"],
      ["right", "After title"],
    ],
  ],
  [
    "collapsedInlineBoundaryMode",
    "Collapsed inline boundary",
    [
      ["same", "Same as expanded"],
      ["separate", "Separate"],
    ],
  ],
  [
    "collapsedParentMode",
    "Collapsed style",
    [
      ["same", "Same as expanded"],
      ["separate", "Separate"],
    ],
  ],
  [
    "collapsedWorkstreamMode",
    "Collapsed style",
    [
      ["same", "Same as expanded"],
      ["separate", "Separate"],
    ],
  ],
  [
    "collapsedThreadMode",
    "Collapsed style",
    [
      ["same", "Same as expanded"],
      ["separate", "Separate"],
    ],
  ],
  [
    "collapsedCatThreadMode",
    "Collapsed style",
    [
      ["same", "Same as expanded"],
      ["separate", "Separate"],
    ],
  ],
  [
    "categorizedSpacing",
    "Categorized spacing",
    [
      ["independent", "Independent"],
      ["inherit", "Inherit"],
    ],
  ],
  [
    "inlineWorkstreamStyle",
    "Style",
    [
      ["inherit", "Same as workstream header"],
      ["separate", "Separate"],
    ],
  ],
  [
    "prefixGapMode",
    "Gap",
    [
      ["natural", "Natural space"],
      ["fixed", "Fixed"],
    ],
  ],
  [
    "disclosureParent",
    "Parent disclosure",
    [
      ["always", "Always"],
      ["hover", "On hover"],
    ],
  ],
  [
    "parentChevronPlacement",
    "Parent chevron placement",
    [
      ["inline", "Inline"],
      ["hanging", "Hanging"],
      ["right", "After label"],
    ],
  ],
  [
    "workstreamChevronPlacement",
    "Workstream chevron placement",
    [
      ["inline", "Inline"],
      ["hanging", "Hanging"],
      ["right", "After label"],
    ],
  ],
]) {
  defaults[id] = options[0][0];
  const wrap = document.createElement("div");
  wrap.className = "control";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  const select = document.createElement("select");
  select.id = id;
  for (const [value, text] of options) select.add(new Option(text, value));
  wrap.append(label, select);
  if (id === "disclosureCategoryThreadPlacement") {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Right placement keeps the status mark visible.";
    wrap.append(hint);
  }
  if (id.endsWith("ChevronPlacement")) {
    const hint = document.createElement("div");
    hint.className = "hint placement-hint";
    hint.hidden = true;
    hint.textContent =
      "Hanging chevrons can clip at the sidebar edge; increase the row indent to make room.";
    wrap.append(hint);
  }
  document.getElementById("spacing-staging").append(wrap);
}
const guideTypes = [
  ["section", "Workstreams section"],
  ["parent", "Shared parent"],
  ["workstream", "Workstream"],
  ["category", "Category"],
  ["children", "Child threads"],
];
for (const [kind] of guideTypes) {
  for (const [suffix, label, value, type, min, max] of [
    ["Show", "Show line", "off", "select"],
    ["Width", "Width", "1", "number", 1, 6],
    ["Color", "Color", "#454545", "color"],
    ["Indent", "Indent", "8", "number", -64, 64],
    ["Spacing", "Spacing", "11", "number", 0, 64],
  ]) {
    const id = `guide${kind}${suffix}`;
    defaults[id] = value;
    const control = document.createElement("div");
    control.className = "control";
    const labelEl = document.createElement("label");
    labelEl.htmlFor = id;
    labelEl.textContent = label;
    const input = document.createElement(
      type === "select" ? "select" : "input",
    );
    input.id = id;
    if (type === "select") {
      input.add(new Option("Off", "off"));
      input.add(new Option("On", "on"));
    } else {
      input.type = type;
      if (type === "number") {
        input.min = min;
        input.max = max;
        input.step = "1";
      }
    }
    input.value = value;
    control.append(labelEl, input);
    document.getElementById("spacing-staging").append(control);
  }
}
const legacyDefaults = { ...defaults };
Object.assign(defaults, {
  grouping: "prefix",
  disclosureWorkstream: "hover",
  familyGap: "0",
  itemGap: "9",
  catGap: "4",
  rowHeight: "21",
  headerHeight: "22",
  catAfter: "3",
  rowInset: "5",
  categoryIndent: "20",
  categoryRowIndent: "0",
  chevronWidth: "8",
  sectionGap: "9",
  sectionInset: "10",
  categoryBetween: "9",
  inlineFamilyGap: "13",
  topWorkstreamIndent: "10",
  sectionHeight: "13",
  categoryHeight: "14",
  catRowHeight: "21",
  collapsedWorkstreamGap: "0",
  collapsedWorkstreamHeight: "22",
  collapsedThreadHeight: "21",
  collapsedCatThreadHeight: "21",
  collapsedInlineBoundaryMode: "separate",
  workstreamChevronPlacement: "hanging",
  font_prefix_color: "accent-black",
  font_prefix_blend: "60",
  font_prefix_weight: "450",
  font_category_color: "accent-gray",
  font_category_blend: "45",
  font_inlineWorkstream_weight: "450",
});
const defaultLinkExceptions = new Set([
  "collapsedWorkstreamGap",
  "font_inlineWorkstream_weight",
]);
const data = [
  {
    id: "studio-app",
    parent: "Studio",
    name: "App",
    color: "blue2",
    activity: 80,
    focused: true,
    rows: [
      ["none", "Planning shortcuts"],
      ["unread", "Reviewing shortcuts", 1],
      ["complete", "Improving keyboard navigation"],
    ],
  },
  {
    id: "studio-workstreams",
    parent: "Studio",
    name: "Workstreams",
    color: "blue",
    activity: 40,
    focused: false,
    categories: [
      [
        "Sidebar design",
        [
          ["review", "Refining sidebar grouping"],
          ["complete", "Checking layout", 1],
          ["working", "Testing colors"],
          ["unread", "Polishing contrast"],
        ],
      ],
      [
        "Performance",
        [
          ["error", "Optimizing test runtime"],
          ["blocked", "Profiling startup"],
          ["complete", "Reducing memory use"],
        ],
      ],
    ],
  },
  {
    id: "agent-automations",
    parent: "Agent",
    name: "Automations",
    color: "orange",
    activity: 100,
    focused: false,
    rows: [["waiting", "Configuring scheduled tasks"]],
  },
  {
    id: "agent-review",
    parent: "Agent",
    name: "Code review",
    color: "red",
    activity: 60,
    focused: true,
    categories: [
      [
        "Review investigations",
        [
          ["review", "Reviewing changes"],
          ["working", "Comparing revisions", 1],
          ["complete", "Fixing checks"],
          ["waiting", "Responding to feedback"],
        ],
      ],
      [
        "Review tooling",
        [
          ["working", "Testing review flow"],
          ["unread", "Inspecting diagnostics"],
          ["draft", "Preparing review guide"],
        ],
      ],
    ],
  },
  {
    id: "agent-research",
    parent: "Agent",
    name: "Research",
    color: "orange2",
    activity: 30,
    focused: false,
    rows: [["blocked", "Comparing approaches"]],
  },
  {
    id: "tools-cli",
    parent: "Tools",
    name: "CLI",
    color: "teal",
    activity: 10,
    focused: false,
    rows: [["draft", "Improving commands"]],
  },
  {
    id: "prompting",
    parent: "",
    name: "Prompting",
    color: "green",
    activity: 20,
    focused: false,
    rows: [["none", "Evaluating prompts"]],
  },
  {
    id: "quality",
    parent: "",
    name: "Quality",
    color: "blue2",
    activity: 15,
    focused: true,
    rows: [
      ["decision", "Choosing release scope"],
      ["working", "Checking release notes", 1],
      ["complete", "Reviewing release criteria"],
    ],
  },
];
const presets = { compact: 3, balanced: 4, airy: 5 };
function presetValues(u) {
  return {
    familyGap: u,
    inlineFamilyGap: u,
    itemGap: 2 * u,
    catGap: 3 * u,
    categoryBetween: 0,
    indent: 2 * u,
    topWorkstreamIndent: 0,
    statusGap: u,
    rowHeight: 28,
    headerHeight: 28,
    parentHeight: 24,
    sectionHeight: 13.2,
    parentBefore: 0,
    parentAfter: 0,
    workstreamBefore: 0,
    workstreamAfter: 0,
    categoryHeight: 14.4,
    rootBefore: 0,
    rootAfter: 0,
    catRootBefore: 0,
    catRootAfter: 0,
    catRowHeight: 28,
    catStatusGap: u,
    catStatusWidth: 14,
    childBefore: 0,
    childAfter: 0,
    childRowHeight: 28,
    childStatusGap: u,
    childStatusWidth: 14,
    catChildBefore: 0,
    catChildAfter: 0,
    catChildRowHeight: 28,
    catChildStatusGap: u,
    catChildStatusWidth: 14,
    tierLabelHeight: 15.2,
    catAfter: u,
    rowInset: 0,
    categoryIndent: 2 * u,
    categoryRowIndent: u,
    childIndent: 5 * u,
    categoryChildIndent: 5 * u,
    statusWidth: 14,
    headerGap: u,
    chevronWidth: 14,
    parentInset: u,
    sectionGap: 2 * u,
    sectionTop: 0,
    sectionInset: u,
    sideX: 2 * u,
    sideY: 3 * u,
    tierGap: 4 * u,
    tierLabelTop: 3 * u,
    tierLabelInset: u,
    tierLabelBottom: 2 * u,
    ...Object.fromEntries(
      indentSpecs.map(([id]) => [id + "Reference", "relative"]),
    ),
  };
}
let theme = "dark",
  legacyPresentation = false,
  showBounds = false,
  inlineWorkstreamInitialized = false,
  collapsedInlineGapInitialized = false,
  previewMode = "both",
  previewWidth = null;
const collapsed = { before: new Set(), after: new Set() },
  lowerExpanded = { before: new Set(), after: new Set() },
  childCollapsed = { before: new Set(), after: new Set() },
  parentCollapsed = { after: new Set() },
  showLower = { before: false, after: false };
const $ = (id) => document.getElementById(id);
const indentSpecs = [
  ["indent", "Grouped workstream indent", "Parent row"],
  ["topWorkstreamIndent", "Top-level workstream indent", "Sidebar content"],
  ["rowInset", "Uncategorized thread indent", "Workstream header"],
  ["categoryIndent", "Category heading inset", "Workstream header"],
  ["categoryRowIndent", "Categorized thread indent", "Category heading"],
  ["childIndent", "Uncategorized child thread indent", "Parent thread row"],
  [
    "categoryChildIndent",
    "Categorized child thread indent",
    "Parent thread row",
  ],
  ["parentInset", "Parent heading inset", "Sidebar content"],
  ["sectionInset", "Workstreams heading inset", "Sidebar content"],
  ["tierLabelInset", "Show other workstreams inset", "Sidebar content"],
];
for (const [id, label, parent] of indentSpecs) {
  $(id).min = "-64";
  $(id).max = "200";
  const key = id + "Reference",
    wrap = document.createElement("div");
  wrap.className = "control mode-control";
  const fieldLabel = document.createElement("label");
  fieldLabel.htmlFor = key;
  fieldLabel.textContent = "Reference";
  const select = document.createElement("select");
  select.id = key;
  select.setAttribute("aria-label", label + " reference");
  select.add(new Option("Relative · " + parent, "relative"));
  if (
    ![
      "topWorkstreamIndent",
      "parentInset",
      "sectionInset",
      "tierLabelInset",
    ].includes(id)
  )
    select.add(new Option("Relative · Sidebar content", "content"));
  select.add(new Option("Absolute · sidebar left", "absolute"));
  legacyDefaults[key] = "relative";
  defaults[key] =
    id === "rowInset" || id === "categoryIndent" ? "content" : "relative";
  wrap.append(fieldLabel, select);
  $(id).closest(".control").after(wrap);
}
const currentDefaults = { ...defaults };
Object.assign(defaults, {
  grouping: "family",
  familyGap: "14",
  itemGap: "7",
  catGap: "3",
  indent: "0",
  statusGap: "3",
  width: "300",
  rowHeight: "25",
  parentHeight: "24",
  rowInset: "13",
  categoryIndent: "0",
  categoryRowIndent: "-2",
  childIndent: "15",
  categoryChildIndent: "15",
  headerGap: "3",
  chevronWidth: "14",
  parentInset: "13",
  sectionTop: "0",
  sectionInset: "3",
  sideX: "6",
  sideY: "9",
  tierGap: "12",
  tierLabelTop: "9",
  tierLabelInset: "3",
  tierLabelBottom: "6",
  font_parent_size: "13",
  font_prefix_weight: "400",
  font_category_size: "11",
  topWorkstreamIndent: "0",
  sectionHeight: "13.2",
  parentBefore: "3",
  parentAfter: "3",
  categoryHeight: "13.2",
  catRowHeight: "25",
  catStatusGap: "3",
  childRowHeight: "25",
  childStatusGap: "3",
  catChildRowHeight: "25",
  catChildStatusGap: "3",
  rowInsetReference: "relative",
  categoryIndentReference: "relative",
});
const previousTrialDefaults = { ...defaults };
defaults.grouping = "prefix";
const inheritedCategorySpacing = {
  catRootBefore: "rootBefore",
  catRowHeight: "rowHeight",
  catRootAfter: "rootAfter",
  categoryRowIndent: "rowInset",
  categoryRowIndentReference: "rowInsetReference",
  catStatusWidth: "statusWidth",
  catStatusGap: "statusGap",
  catChildBefore: "childBefore",
  catChildRowHeight: "childRowHeight",
  catChildAfter: "childAfter",
  categoryChildIndent: "childIndent",
  categoryChildIndentReference: "childIndentReference",
  catChildStatusWidth: "childStatusWidth",
  catChildStatusGap: "childStatusGap",
};
const collapsedSpecs = {
  collapsedParent: {
    base: "parent",
    spacing: {
      collapsedParentBefore: "parentBefore",
      collapsedParentHeight: "parentHeight",
      collapsedParentAfter: "parentAfter",
      collapsedParentGap: "itemGap",
    },
  },
  collapsedWorkstream: {
    base: "workstream",
    spacing: {
      collapsedWorkstreamBefore: "workstreamBefore",
      collapsedWorkstreamHeight: "headerHeight",
      collapsedWorkstreamAfter: "workstreamAfter",
      collapsedWorkstreamGap: "itemGap",
    },
  },
  collapsedThread: {
    base: "thread",
    spacing: {
      collapsedThreadBefore: "rootBefore",
      collapsedThreadHeight: "rowHeight",
      collapsedThreadAfter: "rootAfter",
    },
  },
  collapsedCatThread: {
    base: "catThread",
    spacing: {
      collapsedCatThreadBefore: "catRootBefore",
      collapsedCatThreadHeight: "catRowHeight",
      collapsedCatThreadAfter: "catRootAfter",
    },
  },
};
const collapsedInitialized = {};
const propertySources = { ...inheritedCategorySpacing },
  linkDefaults = {},
  linkExceptions = new Set(defaultLinkExceptions),
  linkMemory = new Set();
for (const id of Object.keys(inheritedCategorySpacing))
  linkDefaults[id] = () => $("categorizedSpacing").value === "inherit";
for (const [role, spec] of Object.entries(collapsedSpecs)) {
  for (const [target, source] of Object.entries(spec.spacing)) {
    propertySources[target] = source;
    linkDefaults[target] = () => $(role + "Mode").value === "same";
  }
  for (const field of fieldsFor({ id: role })) {
    const target = fontId({ id: role }, field);
    propertySources[target] = fontId({ id: spec.base }, field);
    linkDefaults[target] = () => $(role + "Mode").value === "same";
  }
}
for (const [role, source] of [
  ["inlineWorkstream", "workstream"],
  ["catThread", "thread"],
  ["childThread", "thread"],
  ["catChildThread", "catThread"],
])
  for (const field of fieldsFor({ id: role })) {
    const target = fontId({ id: role }, field);
    propertySources[target] = fontId({ id: source }, field);
    linkDefaults[target] =
      role === "inlineWorkstream"
        ? () => $("inlineWorkstreamStyle").value === "inherit"
        : () => false;
  }
for (const [id, source] of [
  ["indent", "topWorkstreamIndent"],
  ["indentReference", "topWorkstreamIndentReference"],
]) {
  propertySources[id] = source;
  linkDefaults[id] = () => false;
}
const variantFallback = {};
const generatedWorkstreamControls = [];
const newWorkstreamStaging = document.createElement("div");
newWorkstreamStaging.hidden = true;
document.body.append(newWorkstreamStaging);
const workstreamRows = {
  top: {
    expanded: {
      before: "workstreamBefore",
      height: "headerHeight",
      after: "workstreamAfter",
      indent: "topWorkstreamIndent",
      reference: "topWorkstreamIndentReference",
      visibility: "disclosureWorkstream",
      placement: "workstreamChevronPlacement",
      slot: "chevronWidth",
      gap: "headerGap",
      text: "workstream",
    },
    collapsed: {
      before: "collapsedWorkstreamBefore",
      height: "collapsedWorkstreamHeight",
      after: "collapsedWorkstreamAfter",
      text: "collapsedWorkstream",
    },
  },
  grouped: {
    expanded: {
      indent: "indent",
      reference: "indentReference",
      text: "groupedWorkstream",
    },
    collapsed: { text: "collapsedGroupedWorkstream" },
  },
  inline: {
    expanded: { text: "inlineWorkstream" },
    collapsed: { text: "collapsedInlineWorkstream" },
  },
};
function addWorkstreamControl(id, source, linkSource = source, fallback) {
  generatedWorkstreamControls.push([id, source]);
  const original = $(source),
    control = document.createElement("div"),
    label = document.createElement("label"),
    input = original.cloneNode(true);
  control.className = "control";
  label.htmlFor = id;
  label.textContent = original
    .closest(".control")
    .querySelector("label").textContent;
  input.id = id;
  input.value = defaults[source];
  input.setAttribute("aria-label", id.replaceAll("_", " "));
  control.append(label, input);
  newWorkstreamStaging.append(control);
  defaults[id] = defaults[source];
  legacyDefaults[id] = defaults[id];
  currentDefaults[id] = defaults[id];
  previousTrialDefaults[id] = defaults[id];
  propertySources[id] = linkSource;
  linkDefaults[id] = () => true;
  if (fallback) variantFallback[id] = fallback;
}
for (const key of [
  "indent",
  "reference",
  "visibility",
  "placement",
  "slot",
  "gap",
]) {
  const source = workstreamRows.top.expanded[key],
    id = "topCollapsed_" + key;
  addWorkstreamControl(id, source);
  workstreamRows.top.collapsed[key] = id;
}
for (const variant of ["grouped", "inline"]) {
  const row = workstreamRows[variant];
  for (const key of [
    "before",
    "height",
    "after",
    "indent",
    "reference",
    "visibility",
    "placement",
    "slot",
    "gap",
  ]) {
    if (row.expanded[key]) continue;
    const source = workstreamRows.top.expanded[key],
      id = variant + "Expanded_" + key;
    addWorkstreamControl(id, source);
    row.expanded[key] = id;
  }
  for (const key of [
    "before",
    "height",
    "after",
    "indent",
    "reference",
    "visibility",
    "placement",
    "slot",
    "gap",
  ]) {
    const id = variant + "Collapsed_" + key,
      fallback = workstreamRows.top.collapsed[key];
    addWorkstreamControl(id, row.expanded[key], row.expanded[key], fallback);
    row.collapsed[key] = id;
  }
}
for (const role of [
  "groupedWorkstream",
  "collapsedGroupedWorkstream",
  "collapsedInlineWorkstream",
]) {
  accentRoles.add(role);
  fontSpecs.push({ id: role, name: role });
  const sourceRole =
    role === "groupedWorkstream"
      ? "workstream"
      : role === "collapsedGroupedWorkstream"
        ? "groupedWorkstream"
        : "inlineWorkstream";
  for (const field of fieldsFor({ id: role })) {
    const target = fontId({ id: role }, field),
      source = fontId({ id: sourceRole }, field),
      fallback = role.startsWith("collapsed")
        ? fontId({ id: "collapsedWorkstream" }, field)
        : undefined;
    addWorkstreamControl(target, source, source, fallback);
  }
}
// Versioned URLs omit unchanged values, so keep their original baselines.
const version6Defaults = { ...currentDefaults };
const version8Defaults = { ...defaults };
const appDefaults = appSidebarDefaults();
Object.assign(currentDefaults, appDefaults);
for (const [id, source] of generatedWorkstreamControls)
  currentDefaults[id] = currentDefaults[source];
// Sidebar width belongs to BB, not the plugin's geometry; both panels share it.
currentDefaults.width = version8Defaults.width;
Object.assign(defaults, currentDefaults);
// Keep production values representable if a future geometry or type token changes.
for (const [id, value] of Object.entries(appDefaults)) {
  const input = $(id);
  if (!input) continue;
  if (input.tagName === "SELECT") {
    if (![...input.options].some((option) => option.value === value))
      input.add(new Option(value, value));
    continue;
  }
  if (!["number", "range"].includes(input.type)) continue;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid app default: ${id}`);
  const oldMin = Number(input.min || 0),
    oldMax = Number(input.max || number),
    step = Number(input.step || 1);
  const min = Math.min(oldMin, number);
  input.min = String(min);
  input.max = String(Math.max(oldMax, number));
  const aligned = (n) => Math.abs(n - Math.round(n)) < 1e-7;
  if (!aligned((number - min) / step) || !aligned((oldMin - min) / step)) {
    input.dataset.increment ||= String(step);
    input.step = "0.0001";
  }
}

const linkKey = (id) => id.replace(/_(customColor|blend)$/, "_color");
const isLinked = (id) => {
  id = linkKey(id);
  return (
    Boolean(propertySources[id]) &&
    linkDefaults[id]() !== linkExceptions.has(id)
  );
};
const effectiveValue = (id) => {
  if (!propertySources[id] || !isLinked(id)) return valueOf(id);
  const fallback = variantFallback[id];
  return effectiveValue(
    fallback && !isLinked(fallback) ? fallback : propertySources[id],
  );
};
const collapsedActive = (role) =>
  $(role + "Mode").value === "separate" ||
  Object.keys(propertySources).some(
    (id) =>
      ((id.startsWith(role) && id !== role + "Mode") ||
        id.startsWith("font_" + role + "_")) &&
      !isLinked(id),
  );
const inlineWorkstreamActive = () =>
  $("inlineWorkstreamStyle").value === "separate" ||
  Object.keys(propertySources).some(
    (id) => id.startsWith("font_inlineWorkstream_") && !isLinked(id),
  );
const shortLabels = {
  collapsedParentMode: "Style",
  collapsedWorkstreamMode: "Style",
  collapsedThreadMode: "Style",
  collapsedCatThreadMode: "Style",
  categorizedSpacing: "Default links",
  width: "Width",
  sideX: "Horizontal padding",
  sideY: "Vertical padding",
  sectionTop: "Before",
  sectionHeight: "Height",
  sectionGap: "After",
  sectionInset: "Indent",
  parentBefore: "Before",
  parentHeight: "Height",
  parentAfter: "After",
  parentInset: "Indent",
  parentChevronWidth: "Slot width",
  parentChevronGap: "Gap to label",
  disclosureParent: "Visibility",
  parentChevronPlacement: "Placement",
  groupedParentColor: "Color",
  familyGap: "Extra between other groups",
  inlineFamilyGap: "Extra at inline parent boundaries",
  collapsedInlineBoundaryMode: "Collapsed inline boundary",
  collapsedInlineFamilyGap: "Collapsed inline boundary extra",
  itemGap: "Between workstreams",
  workstreamBefore: "Before",
  headerHeight: "Height",
  workstreamAfter: "After",
  topWorkstreamIndent: "Top-level",
  indent: "Under a parent",
  chevronWidth: "Slot width",
  headerGap: "Gap to label",
  disclosureWorkstream: "Visibility",
  workstreamChevronPlacement: "Placement",
  inlineParentColor: "Color",
  catGap: "Before",
  categoryHeight: "Height",
  catAfter: "After",
  categoryBetween: "Extra between categories",
  categoryIndent: "Indent",
  mix: "Default accent strength",
  rootBefore: "Before",
  rowHeight: "Height",
  rootAfter: "After",
  rowInset: "Indent",
  statusGap: "Gap to title",
  statusWidth: "Slot width",
  disclosureThread: "Disclosure visibility",
  disclosureThreadPlacement: "Disclosure placement",
  disclosureCategoryThreadPlacement: "Disclosure placement",
  catRootBefore: "Before",
  catRowHeight: "Height",
  catRootAfter: "After",
  categoryRowIndent: "Indent",
  catStatusGap: "Gap to title",
  catStatusWidth: "Slot width",
  disclosureCategoryThread: "Disclosure visibility",
  childBefore: "Before",
  childRowHeight: "Height",
  childAfter: "After",
  childIndent: "Indent",
  childStatusGap: "Gap to title",
  childStatusWidth: "Slot width",
  catChildBefore: "Before",
  catChildRowHeight: "Height",
  catChildAfter: "After",
  categoryChildIndent: "Indent",
  catChildStatusGap: "Gap to title",
  catChildStatusWidth: "Slot width",
  tierLabelTop: "Before",
  tierLabelHeight: "Height",
  tierLabelBottom: "After",
  tierLabelInset: "Indent",
  tierGap: "Between focus tiers",
};
const rowSections = [
  [
    "lines-section",
    "Connecting lines",
    guideTypes.map(([kind, label]) => [
      label,
      [
        "Line",
        ["Show", "Width", "Color", "Indent", "Spacing"].map(
          (suffix) => `guide${kind}${suffix}`,
        ),
      ],
    ]),
  ],
  [
    "sidebar-section",
    "Sidebar",
    [
      [null, ["Dimensions", ["width", "sideX", "sideY"]]],
      [
        "Workstreams heading",
        ["Spacing", ["sectionTop", "sectionHeight", "sectionGap"]],
        ["Indentation", ["sectionInset"]],
        ["Text", [], "section"],
      ],
    ],
  ],
  [
    "parent-section",
    "Parents",
    [
      [
        "Shared parent heading",
        ["Spacing", ["parentBefore", "parentHeight", "parentAfter"]],
        ["Indentation", ["parentInset"]],
        [
          "Chevron",
          [
            "disclosureParent",
            "parentChevronPlacement",
            "parentChevronWidth",
            "parentChevronGap",
          ],
        ],
        ["Text", [], "parent"],
      ],
      [
        "Collapsed parent heading",
        [
          "Spacing",
          [
            "collapsedParentMode",
            "collapsedParentBefore",
            "collapsedParentHeight",
            "collapsedParentAfter",
            "collapsedParentGap",
          ],
        ],
        ["Text", [], "collapsedParent"],
      ],
      [
        "Inline parent label",
        ["Spacing", ["prefixGapMode", "prefixGap"]],
        ["Text", [], "prefix"],
      ],
    ],
  ],
  [
    "workstreams-section",
    "Workstream headers",
    [
      [
        null,
        [
          "Spacing",
          [
            "workstreamBefore",
            "headerHeight",
            "workstreamAfter",
            "itemGap",
            "inlineFamilyGap",
            "collapsedInlineBoundaryMode",
            "collapsedInlineFamilyGap",
            "familyGap",
          ],
        ],
        ["Indentation", ["topWorkstreamIndent", "indent"]],
        [
          "Chevron",
          [
            "disclosureWorkstream",
            "workstreamChevronPlacement",
            "chevronWidth",
            "headerGap",
          ],
        ],
        ["Text", [], "workstream"],
      ],
      [
        "Workstream label with inline parent",
        ["Text", ["inlineWorkstreamStyle"], "inlineWorkstream"],
      ],
      [
        "Collapsed workstream header",
        [
          "Spacing",
          [
            "collapsedWorkstreamMode",
            "collapsedWorkstreamBefore",
            "collapsedWorkstreamHeight",
            "collapsedWorkstreamAfter",
            "collapsedWorkstreamGap",
          ],
        ],
        ["Text", [], "collapsedWorkstream"],
      ],
    ],
  ],
  [
    "category-section",
    "Category headings",
    [
      [
        null,
        [
          "Spacing",
          ["catGap", "categoryHeight", "catAfter", "categoryBetween"],
        ],
        ["Indentation", ["categoryIndent"]],
        ["Text", ["mix"], "category"],
      ],
    ],
  ],
  [
    "threads-section",
    "Thread rows",
    [
      [null, ["Categorized spacing", ["categorizedSpacing"]]],
      [
        "Uncategorized threads",
        ["Spacing", ["rootBefore", "rowHeight", "rootAfter"]],
        ["Indentation", ["rowInset"]],
        [
          "Status and disclosure",
          [
            "statusWidth",
            "statusGap",
            "disclosureThread",
            "disclosureThreadPlacement",
          ],
        ],
        ["Text", [], "thread"],
      ],
      [
        "Collapsed uncategorized thread",
        [
          "Spacing",
          [
            "collapsedThreadMode",
            "collapsedThreadBefore",
            "collapsedThreadHeight",
            "collapsedThreadAfter",
          ],
        ],
        ["Text", [], "collapsedThread"],
      ],
      [
        "Categorized threads",
        ["Spacing", ["catRootBefore", "catRowHeight", "catRootAfter"]],
        ["Indentation", ["categoryRowIndent"]],
        [
          "Status and disclosure",
          [
            "catStatusWidth",
            "catStatusGap",
            "disclosureCategoryThread",
            "disclosureCategoryThreadPlacement",
          ],
        ],
        ["Text", [], "catThread"],
      ],
      [
        "Collapsed categorized thread",
        [
          "Spacing",
          [
            "collapsedCatThreadMode",
            "collapsedCatThreadBefore",
            "collapsedCatThreadHeight",
            "collapsedCatThreadAfter",
          ],
        ],
        ["Text", [], "collapsedCatThread"],
      ],
      [
        "Uncategorized child threads",
        ["Spacing", ["childBefore", "childRowHeight", "childAfter"]],
        ["Indentation", ["childIndent"]],
        ["Status", ["childStatusWidth", "childStatusGap"]],
        ["Text", [], "childThread"],
      ],
      [
        "Categorized child threads",
        ["Spacing", ["catChildBefore", "catChildRowHeight", "catChildAfter"]],
        ["Indentation", ["categoryChildIndent"]],
        ["Status", ["catChildStatusWidth", "catChildStatusGap"]],
        ["Text", [], "catChildThread"],
      ],
    ],
  ],
  [
    "focus-section",
    "Show other workstreams",
    [
      [
        null,
        [
          "Spacing",
          ["tierLabelTop", "tierLabelHeight", "tierLabelBottom", "tierGap"],
        ],
        ["Indentation", ["tierLabelInset"]],
        ["Text", [], "tier"],
      ],
    ],
  ],
];
function buildRow(target, sectionName, row) {
  const [title, ...groups] = row,
    context = title || sectionName,
    block = document.createElement("div");
  block.className = "row-block";
  const collapsedRole = groups.find((group) =>
    group[2]?.startsWith("collapsed"),
  )?.[2];
  if (collapsedRole) block.dataset.collapsedRole = collapsedRole;
  if (title) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    block.append(heading);
    if (
      title === "Inline parent label" ||
      title === "Workstream label with inline parent"
    ) {
      const hint = document.createElement("p");
      hint.id =
        title === "Inline parent label" ? "prefixHint" : "inlineWorkstreamHint";
      hint.className = "hint";
      block.append(hint);
    }
  }
  const grid = document.createElement("div");
  grid.className = "property-grid";
  for (const [name, ids, role] of groups) {
    const card = document.createElement("fieldset");
    card.className = "controls property-card";
    const legend = document.createElement("legend");
    legend.textContent = name;
    card.append(legend);
    for (const id of ids) {
      if (role === "category" && id === "mix") continue;
      const input = $(id),
        control = input.closest(".control"),
        label = control.querySelector("label");
      if (shortLabels[id]) label.textContent = shortLabels[id];
      input.setAttribute(
        "aria-label",
        `${context}: ${id === "categorizedSpacing" ? "Categorized spacing" : label.textContent}`,
      );
      card.append(control);
      const ref = $(id + "Reference");
      if (ref) {
        const refControl = ref.closest(".control"),
          refLabel = refControl.querySelector("label");
        refLabel.textContent =
          id === "topWorkstreamIndent"
            ? "Top-level reference"
            : id === "indent"
              ? "Under a parent reference"
              : "Reference";
        ref.setAttribute(
          "aria-label",
          `${context}: ${shortLabels[id] || label.textContent} reference`,
        );
        card.append(refControl);
      }
    }
    if (role) {
      card.dataset.textRole = role;
      const font = document.querySelector(`[data-font-role="${role}"]`);
      for (const field of fieldsFor({ id: role })) {
        const input = $(fontId({ id: role }, field)),
          control = input.closest(".control"),
          label = control.querySelector("label");
        label.textContent =
          field.key === "family"
            ? "Family"
            : field.key === "transform"
              ? "Transform"
              : field.name;
        input.setAttribute("aria-label", `${context}: ${label.textContent}`);
        card.append(control);
        if (role === "category" && field.key === "color") {
          const mix = $("mix"),
            control = mix.closest(".control"),
            label = control.querySelector("label");
          label.textContent = shortLabels.mix;
          mix.setAttribute("aria-label", `${context}: ${label.textContent}`);
          card.append(control);
        }
      }
      font.remove();
    }
    grid.append(card);
  }
  block.append(grid);
  target.append(block);
}
const viewGrid = $("view-groups");
buildRow(viewGrid, "View", [
  null,
  ["Arrangement", ["grouping", "sort", "focus"]],
]);
$("view-section").append(document.querySelector(".presets"));
for (const [id, title, rows] of rowSections) {
  const section = document.createElement("section");
  section.id = id;
  section.className = "control-section";
  const h = document.createElement("h2");
  h.textContent = title;
  section.append(h);
  if (id === "lines-section") {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Indent positions the line; spacing adds room before its contents.";
    section.append(hint);
  }
  $("share-section").before(section);
  for (const row of rows) buildRow(section, title, row);
}
for (const id of Object.keys(inheritedCategorySpacing)) {
  const hint = document.createElement("div");
  hint.className = "hint inherited-hint";
  hint.hidden = true;
  $(id).closest(".control").append(hint);
}
{
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent =
    "Changing this sets all categorized spacing links; independent values are kept. Parent-relative indents use the categorized parent.";
  $("categorizedSpacing").closest(".control").append(hint);
}
$("view-staging").remove();
$("spacing-section").remove();
$("fonts-section").remove();
const lastValid = {};
for (const id of Object.keys(defaults)) {
  const input = $(id),
    control = input.closest(".control"),
    label =
      input.getAttribute("aria-label") ||
      control.querySelector("label").textContent.trim(),
    output = $(id + "Value");
  if (output) output.remove();
  if (input.type === "range") input.type = "number";
  const row = document.createElement("div");
  row.className = input.type === "number" ? "stepper" : "select-field";
  input.before(row);
  if (input.type === "number") {
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "step-minus";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `Decrease ${label}`);
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "step-plus";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `Increase ${label}`);
    const buttons = document.createElement("span");
    buttons.className = "step-buttons";
    buttons.append(plus, minus);
    for (const [button, direction] of [
      [minus, -1],
      [plus, 1],
    ]) {
      const setStep = (steps) => {
        const min = Number(input.min),
          max = Number(input.max),
          step = Number(input.dataset.increment || input.step || 1),
          start = Number(lastValid[id]);
        const value = Math.min(max, Math.max(min, start + steps * step));
        input.value = String(Number(value.toFixed(8)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      let gesture = null;
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (!validNumber(input)) input.value = lastValid[id];
        gesture = {
          y: event.clientY,
          start: Number(input.value),
          dragging: false,
        };
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener("pointermove", (event) => {
        if (!gesture) return;
        const delta = gesture.y - event.clientY;
        if (Math.abs(delta) >= 4) gesture.dragging = true;
        if (gesture.dragging) {
          lastValid[id] = String(gesture.start);
          setStep(Math.trunc(delta / 8));
        }
      });
      button.addEventListener("pointerup", () => {
        if (!gesture) return;
        const wasDrag = gesture.dragging;
        gesture = null;
        if (!wasDrag) setStep(direction);
      });
      button.addEventListener("pointercancel", () => {
        gesture = null;
      });
      button.addEventListener("click", (event) => {
        if (event.detail === 0) setStep(direction);
      });
    }
    row.append(input, buttons);
    const unit = document.createElement("span");
    unit.className = "step-unit";
    unit.textContent = input.dataset.unit ?? (id === "mix" ? "%" : "px");
    row.append(unit);
  } else row.append(input);
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "property-reset";
  reset.textContent = "↺";
  reset.setAttribute("aria-label", `Reset ${label} to its initial value`);
  reset.title = "Reset to initial value";
  reset.addEventListener("click", () => {
    input.value = defaults[id];
    input.removeAttribute("aria-invalid");
    lastValid[id] = input.value;
    propertyChanged(id);
    render();
  });
  row.append(reset);
  lastValid[id] = input.value;
}
for (const id of Object.keys(propertySources)) {
  if (linkKey(id) !== id) continue;
  const input = $(id),
    row = input.parentElement,
    wrap = document.createElement("div"),
    display = document.createElement("button"),
    toggle = document.createElement("button");
  wrap.className = "linked-field";
  display.type = "button";
  display.className = "linked-value";
  toggle.type = "button";
  toggle.className = "link-toggle";
  row.before(wrap);
  wrap.append(row, display, toggle);
  display.addEventListener("click", () => {
    if (isLinked(id)) switchLink(id);
    input.focus();
  });
  toggle.addEventListener("click", () => {
    switchLink(id);
    if (isLinked(id)) display.focus();
    else input.focus();
  });
}
function pairRows(sectionId, role, title, rows, baseFont) {
  const section = $(sectionId),
    collapsed = section.querySelector(`[data-collapsed-role="${role}"]`),
    base = title
      ? [...section.querySelectorAll(".row-block")].find(
          (block) => block.querySelector("h3")?.textContent === title,
        )
      : section.querySelector(".row-block");
  const baseGrid = base.querySelector(".property-grid"),
    baseSpacing = $(rows[0][1]).closest(".property-card"),
    collapsedSpacing = $(rows[0][2]).closest(".property-card"),
    baseText = section.querySelector(`[data-text-role="${baseFont}"]`),
    collapsedText = section.querySelector(`[data-text-role="${role}"]`),
    layout = document.createElement("div");
  layout.className = "paired-layout";
  const makeTable = (label, pairs) => {
    const card = document.createElement("div");
    card.className = "matrix-card";
    const heading = document.createElement("h4");
    heading.textContent = label;
    const table = document.createElement("table");
    table.className = "matrix";
    const caption = document.createElement("caption");
    caption.className = "sr";
    caption.textContent =
      (title || section.querySelector("h2").textContent) + " " + label;
    table.append(caption);
    const head = document.createElement("thead");
    head.innerHTML =
      '<tr><th scope="col">Property</th><th scope="col">Expanded</th><th scope="col">Collapsed</th></tr>';
    table.append(head);
    const body = document.createElement("tbody");
    for (const [label, a, b] of pairs) {
      const tr = document.createElement("tr"),
        th = document.createElement("th"),
        left = document.createElement("td"),
        right = document.createElement("td");
      th.scope = "row";
      th.textContent = label;
      if (a.startsWith("@")) {
        const output = document.createElement("output");
        output.dataset.source = a.slice(1);
        left.append(output);
      } else {
        left.append($(a).closest(".control"));
        tr.dataset.pairA = a;
      }
      right.append($(b).closest(".control"));
      tr.dataset.pairB = b;
      tr.append(th, left, right);
      body.append(tr);
    }
    table.append(body);
    const actions = document.createElement("div");
    actions.className = "matrix-actions";
    const expanded = pairs
        .map((pair) => pair[1])
        .filter((id) => propertySources[id]),
      closed = pairs.map((pair) => pair[2]).filter((id) => propertySources[id]);
    if (expanded.length)
      actions.append(makeBulkLink(expanded, "expanded " + label));
    if (closed.length)
      actions.append(makeBulkLink(closed, "collapsed " + label));
    card.append(heading, actions);
    if (baseFont === "catThread") {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent =
        label === "Text"
          ? "Expanded text links follow uncategorized threads."
          : "Expanded spacing links follow uncategorized threads; parent-relative indents use the category.";
      card.append(hint);
    }
    card.append(table);
    layout.append(card);
  };
  makeTable("Spacing", rows);
  makeTable(
    "Text",
    fieldsFor({ id: role }).map((field) => [
      field.key === "family"
        ? "Family"
        : field.key === "transform"
          ? "Transform"
          : field.name,
      fontId({ id: baseFont }, field),
      fontId({ id: role }, field),
    ]),
  );
  base.insertBefore(layout, baseGrid);
  const policy = $(role + "Mode").closest(".control");
  policy.hidden = true;
  policy.classList.add("policy-control");
  base.append(policy);
  if (!baseSpacing.querySelector(".control")) baseSpacing.remove();
  else baseSpacing.querySelector("legend").textContent = "Group spacing";
  collapsedSpacing.remove();
  baseText.remove();
  collapsedText.remove();
  collapsed.remove();
}
pairRows(
  "parent-section",
  "collapsedParent",
  "Shared parent heading",
  [
    ["Before", "parentBefore", "collapsedParentBefore"],
    ["Height", "parentHeight", "collapsedParentHeight"],
    ["After", "parentAfter", "collapsedParentAfter"],
    ["Gap after group", "@itemGap", "collapsedParentGap"],
  ],
  "parent",
);
pairRows(
  "workstreams-section",
  "collapsedWorkstream",
  null,
  [
    ["Before", "workstreamBefore", "collapsedWorkstreamBefore"],
    ["Height", "headerHeight", "collapsedWorkstreamHeight"],
    ["After", "workstreamAfter", "collapsedWorkstreamAfter"],
    ["Gap to next", "itemGap", "collapsedWorkstreamGap"],
  ],
  "workstream",
);
pairRows(
  "threads-section",
  "collapsedThread",
  "Uncategorized threads",
  [
    ["Before", "rootBefore", "collapsedThreadBefore"],
    ["Height", "rowHeight", "collapsedThreadHeight"],
    ["After", "rootAfter", "collapsedThreadAfter"],
  ],
  "thread",
);
pairRows(
  "threads-section",
  "collapsedCatThread",
  "Categorized threads",
  [
    ["Before", "catRootBefore", "collapsedCatThreadBefore"],
    ["Height", "catRowHeight", "collapsedCatThreadHeight"],
    ["After", "catRootAfter", "collapsedCatThreadAfter"],
  ],
  "catThread",
);
$("inlineWorkstreamStyle").closest(".control").hidden = true;
{
  const section = $("workstreams-section"),
    top = section.querySelector(".row-block"),
    layout = top.querySelector(".paired-layout"),
    common = document.createElement("div"),
    nav = document.createElement("div");
  common.className = "row-block";
  const shared = document.createElement("details"),
    summary = document.createElement("summary");
  summary.textContent = "Group spacing · shared";
  shared.append(summary, top.querySelector(".property-grid"));
  common.append(shared);
  section.append(common);
  const commonCard = common.querySelector(".property-card"),
    gapRow = $("itemGap").closest("tr");
  for (const id of ["itemGap", "collapsedWorkstreamGap"])
    commonCard.append($(id).closest(".control"));
  gapRow.remove();
  nav.className = "variant-nav";
  nav.setAttribute("role", "group");
  nav.setAttribute("aria-label", "Workstream treatment");
  const labels = {
    top: "Top-level",
    grouped: "Under shared parent",
    inline: "Inline parent",
  };
  function matrix(title, variant, pairs) {
    const card = document.createElement("div"),
      heading = document.createElement("h4"),
      table = document.createElement("table"),
      caption = document.createElement("caption"),
      head = document.createElement("thead"),
      body = document.createElement("tbody"),
      actions = document.createElement("div");
    card.className = "matrix-card";
    heading.textContent = title;
    table.className = "matrix";
    caption.className = "sr";
    caption.textContent = labels[variant] + " " + title;
    head.innerHTML =
      '<tr><th scope="col">Property</th><th scope="col">Expanded</th><th scope="col">Collapsed</th></tr>';
    table.append(caption, head);
    for (const [label, a, b] of pairs) {
      const tr = document.createElement("tr"),
        th = document.createElement("th"),
        left = document.createElement("td"),
        right = document.createElement("td");
      th.scope = "row";
      th.textContent = label;
      tr.dataset.pairA = a;
      tr.dataset.pairB = b;
      for (const [id, cell, state] of [
        [a, left, "expanded"],
        [b, right, "collapsed"],
      ]) {
        const input = $(id);
        input.setAttribute(
          "aria-label",
          labels[variant] + " " + state + " " + label.toLowerCase(),
        );
        const control = input.closest(".control");
        for (const [selector, verb] of [
          [".step-plus", "Increase"],
          [".step-minus", "Decrease"],
          [".property-reset", "Reset"],
        ]) {
          const button = control.querySelector(selector);
          if (button)
            button.setAttribute(
              "aria-label",
              verb + " " + input.getAttribute("aria-label"),
            );
        }
        cell.append(control);
      }
      tr.append(th, left, right);
      body.append(tr);
    }
    table.append(body);
    actions.className = "matrix-actions";
    for (const [column, name] of [
      [1, "expanded"],
      [2, "collapsed"],
    ]) {
      const ids = pairs
        .map((pair) => pair[column])
        .filter((id) => propertySources[id]);
      if (ids.length)
        actions.append(
          makeBulkLink(
            ids,
            name + " " + labels[variant] + " " + title.toLowerCase(),
          ),
        );
    }
    card.append(heading, actions, table);
    return card;
  }
  function pairs(variant, entries) {
    const row = workstreamRows[variant];
    return entries.map(([label, key]) => [
      label,
      row.expanded[key],
      row.collapsed[key],
    ]);
  }
  const spacing = [
      ["Before", "before"],
      ["Height", "height"],
      ["After", "after"],
    ],
    indentation = [
      ["Indent", "indent"],
      ["Reference", "reference"],
    ],
    chevron = [
      ["Visibility", "visibility"],
      ["Placement", "placement"],
      ["Slot width", "slot"],
      ["Gap to label", "gap"],
    ];
  layout.append(
    matrix("Indentation", "top", pairs("top", indentation)),
    matrix("Chevron", "top", pairs("top", chevron)),
  );
  top.dataset.workstreamVariant = "top";
  const oldInline = [...section.querySelectorAll(".row-block")].find(
    (el) =>
      el.querySelector("h3")?.textContent ===
      "Workstream label with inline parent",
  );
  const hint = $("inlineWorkstreamHint");
  oldInline.before($("inlineWorkstreamStyle").closest(".control"));
  for (const variant of ["grouped", "inline"]) {
    const block = document.createElement("div"),
      grid = document.createElement("div");
    block.className = "row-block workstream-variant";
    block.dataset.workstreamVariant = variant;
    grid.className = "paired-layout";
    if (variant === "inline") block.append(hint);
    else {
      const note = document.createElement("p");
      note.id = "groupedWorkstreamHint";
      note.className = "hint";
      block.append(note);
    }
    grid.append(
      matrix("Spacing", variant, pairs(variant, spacing)),
      matrix(
        "Text",
        variant,
        fieldsFor({ id: workstreamRows[variant].expanded.text }).map(
          (field) => [
            field.key === "family"
              ? "Family"
              : field.key === "transform"
                ? "Transform"
                : field.name,
            fontId({ id: workstreamRows[variant].expanded.text }, field),
            fontId({ id: workstreamRows[variant].collapsed.text }, field),
          ],
        ),
      ),
      matrix("Indentation", variant, pairs(variant, indentation)),
      matrix("Chevron", variant, pairs(variant, chevron)),
    );
    block.append(grid);
    section.append(block);
  }
  oldInline.remove();
  newWorkstreamStaging.remove();
  for (const card of [...common.querySelectorAll(".property-card")])
    if (!card.querySelector(".control")) card.remove();
  section.querySelector("h2").after(nav, common);
  top.classList.add("workstream-variant");
  function showVariant(variant) {
    for (const block of section.querySelectorAll(".workstream-variant"))
      block.hidden = block.dataset.workstreamVariant !== variant;
    for (const button of nav.querySelectorAll("button"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.workstreamVariant === variant),
      );
  }
  for (const [variant, label] of Object.entries(labels)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.workstreamVariant = variant;
    button.addEventListener("click", () => showVariant(variant));
    nav.append(button);
  }
  showVariant("top");
}
{
  const bar = document.createElement("div");
  bar.className = "global-arrangement";
  for (const id of ["grouping", "sort", "focus"])
    bar.append($(id).closest(".control"));
  document.querySelector(".top").after(bar);
  const note = $("orderNote");
  note.classList.add("global-order-note");
  bar.after(note);
  $("view-groups").remove();
}
{
  const section = $("threads-section"),
    nav = document.createElement("div"),
    variants = [
      ["Uncategorized", "Uncategorized threads"],
      ["Categorized", "Categorized threads"],
      ["Child", "Uncategorized child threads"],
      ["Categorized child", "Categorized child threads"],
    ];
  nav.className = "variant-nav";
  nav.setAttribute("role", "group");
  nav.setAttribute("aria-label", "Thread row type");
  for (const [label, title] of variants) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.variant = title;
    nav.append(button);
  }
  section.querySelector("h2").after(nav);
  const blocks = [...section.querySelectorAll(".row-block")],
    policy = $("categorizedSpacing").closest(".row-block");
  policy.classList.add("thread-policy");
  for (const [label, title] of variants) {
    const block = blocks.find(
      (item) => item.querySelector("h3")?.textContent === title,
    );
    block.classList.add("thread-variant");
    block.dataset.variant = title;
  }
  function showVariant(title) {
    for (const block of section.querySelectorAll(".thread-variant"))
      block.hidden = block.dataset.variant !== title;
    policy.hidden = !title.startsWith("Categorized");
    for (const button of nav.querySelectorAll("button"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.variant === title),
      );
  }
  for (const button of nav.querySelectorAll("button"))
    button.addEventListener("click", () => showVariant(button.dataset.variant));
  showVariant("Uncategorized threads");
}
for (const role of ["childThread", "catChildThread"]) {
  const card = document.querySelector(`[data-text-role="${role}"]`),
    ids = fieldsFor({ id: role })
      .map((field) => fontId({ id: role }, field))
      .filter((id) => propertySources[id]);
  const actions = document.createElement("div");
  actions.className = "matrix-actions";
  actions.append(
    makeBulkLink(
      ids,
      role === "inlineWorkstream"
        ? "inline workstream text"
        : role === "childThread"
          ? "child thread text"
          : "categorized child text",
    ),
  );
  card.insertBefore(actions, card.querySelector("legend").nextSibling);
  if (role !== "inlineWorkstream") {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      role === "childThread"
        ? "Linked text follows uncategorized threads."
        : "Linked text follows categorized threads.";
    card.insertBefore(hint, actions.nextSibling);
  }
}
function makeBulkLink(ids, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bulk-link";
  button.dataset.linkIds = [...new Set(ids.map(linkKey))].join(",");
  button.dataset.linkLabel = label;
  button.addEventListener("click", () => {
    const keys = button.dataset.linkIds.split(","),
      link = !keys.every(isLinked);
    for (const id of keys) setLink(id, link);
    render();
  });
  return button;
}
function setLink(id, linked) {
  const wasLinked = isLinked(id);
  if (wasLinked === linked) return;
  if (wasLinked && !linkMemory.has(id)) {
    const value = effectiveValue(id);
    $(id).value = value;
    lastValid[id] = $(id).value;
    if (id.endsWith("_color"))
      for (const suffix of ["customColor", "blend"]) {
        const target = id.replace(/_color$/, "_" + suffix);
        if (propertySources[target]) {
          $(target).value = effectiveValue(target);
          lastValid[target] = $(target).value;
        }
      }
  }
  if (linkExceptions.has(id)) linkExceptions.delete(id);
  else linkExceptions.add(id);
  linkMemory.add(id);
}
function switchLink(id) {
  setLink(id, !isLinked(id));
  render();
}
const validNumber = (input) => {
  const value = Number(input.value),
    min = Number(input.min),
    max = Number(input.max),
    step = Number(input.step || 1);
  return (
    input.value.trim() !== "" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-7
  );
};
const valueOf = (id) => {
  const input = $(id);
  return input.type === "number" && !validNumber(input)
    ? lastValid[id]
    : input.value;
};
const layoutValue = (id) => effectiveValue(id);
function showSection(id) {
  for (const section of document.querySelectorAll(
    ".control-panel>.control-section",
  ))
    section.hidden = section.id !== id;
  for (const button of document.querySelectorAll("[data-section]"))
    button.setAttribute("aria-pressed", String(button.dataset.section === id));
  $("linkLegend").hidden = ![
    "parent-section",
    "workstreams-section",
    "threads-section",
  ].includes(id);
  document.querySelector(".control-panel").scrollTop = 0;
}
for (const button of document.querySelectorAll("[data-section]"))
  button.addEventListener("click", () => showSection(button.dataset.section));
showSection("view-section");
$("showSettings").addEventListener("click", () => {
  const show = $("settingsValues").hidden;
  $("settingsValues").hidden = !show;
  $("showSettings").setAttribute("aria-expanded", String(show));
  $("showSettings").textContent = show
    ? "Hide current values"
    : "Show current values";
});
function splitBounds() {
  const width = document.querySelector(".playground").clientWidth,
    max = Math.max(0, Math.floor(width - Math.min(220, width * 0.35) - 12));
  return { min: Math.min(180, max), max };
}
function updateSplitter() {
  const splitter = $("previewSplitter"),
    { min, max } = splitBounds(),
    width = Math.round($("previewColumn").getBoundingClientRect().width);
  splitter.setAttribute("aria-valuemin", String(min));
  splitter.setAttribute("aria-valuemax", String(max));
  splitter.setAttribute("aria-valuenow", String(width));
  splitter.setAttribute("aria-valuetext", width + " pixels");
}
function layoutPreview() {
  const playground = document.querySelector(".playground");
  playground.style.setProperty(
    "--preview-count",
    previewMode === "both" ? "2" : "1",
  );
  if (previewWidth === null) playground.style.removeProperty("--split-width");
  else playground.style.setProperty("--split-width", previewWidth + "px");
  $("trialPanel").hidden = previewMode === "current";
  $("currentPanel").hidden = previewMode === "trial";
  for (const button of document.querySelectorAll("[data-preview]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.preview === previewMode),
    );
  updateSplitter();
}
function resizePreview(width) {
  const { min, max } = splitBounds();
  previewWidth = Math.round(Math.max(min, Math.min(max, width)));
  layoutPreview();
}
for (const button of document.querySelectorAll("[data-preview]"))
  button.addEventListener("click", () => {
    previewMode = button.dataset.preview;
    layoutPreview();
    syncUrl();
  });
{
  const splitter = $("previewSplitter"),
    playground = document.querySelector(".playground");
  let drag = null;
  splitter.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      width: $("previewColumn").getBoundingClientRect().width,
      previous: previewWidth,
    };
    splitter.setPointerCapture(event.pointerId);
    splitter.dataset.dragging = "true";
    playground.dataset.resizing = "true";
    splitter.focus();
  });
  splitter.addEventListener("pointermove", (event) => {
    if (drag && event.pointerId === drag.id)
      resizePreview(drag.width + event.clientX - drag.x);
  });
  function finish(event, cancel) {
    if (!drag || event.pointerId !== drag.id) return;
    if (cancel) {
      previewWidth = drag.previous;
      layoutPreview();
    }
    drag = null;
    delete splitter.dataset.dragging;
    delete playground.dataset.resizing;
    syncUrl();
  }
  splitter.addEventListener("pointerup", (event) => finish(event, false));
  splitter.addEventListener("pointercancel", (event) => finish(event, true));
  splitter.addEventListener("lostpointercapture", (event) =>
    finish(event, true),
  );
  splitter.addEventListener("keydown", (event) => {
    const bounds = splitBounds(),
      width = $("previewColumn").getBoundingClientRect().width,
      step = event.shiftKey ? 50 : 10;
    let target;
    if (event.key === "ArrowLeft") target = width - step;
    else if (event.key === "ArrowRight") target = width + step;
    else if (event.key === "Home") target = bounds.min;
    else if (event.key === "End") target = bounds.max;
    else return;
    event.preventDefault();
    resizePreview(target);
    syncUrl();
  });
  new ResizeObserver(updateSplitter).observe(playground);
  new ResizeObserver(updateSplitter).observe($("previewColumn"));
}
function restoreUrl() {
  const params = new URLSearchParams(location.hash.slice(1)),
    version = params.get("iv"),
    hasState = params.toString() !== "",
    legacy = hasState && !["6", "7", "8", "9"].includes(version),
    previous = hasState && version === "6",
    previousTrial = hasState && version === "7",
    previousV8 = hasState && version === "8";
  legacyPresentation =
    legacy ||
    previous ||
    previousTrial ||
    previousV8 ||
    params.get("legacyPresentation") === "1";
  previewMode = ["trial", "current", "both"].includes(params.get("preview"))
    ? params.get("preview")
    : "both";
  const savedWidth = params.get("previewWidth");
  previewWidth =
    savedWidth !== null &&
    /^\d+$/.test(savedWidth) &&
    Number(savedWidth) >= 1 &&
    Number(savedWidth) <= 10000
      ? Number(savedWidth)
      : null;
  for (const [id, value] of Object.entries(defaults))
    $(id).value = legacy
      ? (legacyDefaults[id] ?? currentDefaults[id] ?? value)
      : previous
        ? (version6Defaults[id] ?? value)
        : previousTrial
          ? (previousTrialDefaults[id] ?? value)
          : previousV8
            ? (version8Defaults[id] ?? value)
            : value;
  theme = "dark";
  for (const panel of ["before", "after"]) {
    collapsed[panel].clear();
    lowerExpanded[panel].clear();
    childCollapsed[panel].clear();
    showLower[panel] = false;
  }
  parentCollapsed.after.clear();
  linkExceptions.clear();
  if (!legacy) for (const id of defaultLinkExceptions) linkExceptions.add(id);
  linkMemory.clear();
  for (const id of (params.get("linkOverrides") || "").split(","))
    if (propertySources[id] && linkKey(id) === id) {
      if (!legacy && linkExceptions.has(id)) linkExceptions.delete(id);
      else linkExceptions.add(id);
    }
  for (const id of (params.get("linkMemory") || "").split(","))
    if (propertySources[id] && linkKey(id) === id) linkMemory.add(id);
  inlineWorkstreamInitialized =
    params.get("inlineWorkstreamStyle") === "separate" ||
    [...params.keys()].some((key) => key.startsWith("font_inlineWorkstream_"));
  collapsedInlineGapInitialized =
    params.get("collapsedInlineBoundaryMode") === "separate" ||
    params.has("collapsedInlineFamilyGap") ||
    (!params.has("collapsedInlineBoundaryMode") &&
      (legacy
        ? legacyDefaults
        : previous
          ? version6Defaults
          : previousTrial
            ? previousTrialDefaults
            : previousV8
              ? version8Defaults
              : defaults
      ).collapsedInlineBoundaryMode === "separate");
  for (const role of Object.keys(collapsedSpecs))
    collapsedInitialized[role] =
      params.get(role + "Mode") === "separate" ||
      [...params.keys()].some(
        (key) =>
          key.startsWith("font_" + role + "_") ||
          (key.startsWith(role) && key !== role + "Mode"),
      );
  if (params.get("theme") === "light") theme = "light";
  showBounds = params.get("bounds") === "1";
  for (const id of Object.keys(defaults)) {
    if (!params.has(id)) continue;
    const input = $(id),
      raw = params.get(id);
    if (input.type === "number") {
      const n = Number(raw),
        min = Number(input.min),
        max = Number(input.max),
        step = Number(input.step || 1);
      if (
        raw.trim() !== "" &&
        Number.isFinite(n) &&
        n >= min &&
        n <= max &&
        Math.abs((n - min) / step - Math.round((n - min) / step)) < 1e-7
      )
        input.value = raw;
    } else if (input.type === "color") {
      if (/^#[0-9a-f]{6}$/i.test(raw)) input.value = raw;
    } else if ([...input.options].some((option) => option.value === raw))
      input.value = raw;
  }
  if (
    params.get("groupedParentColor") === "accent" &&
    !params.has("font_parent_color")
  )
    $("font_parent_color").value = "accent";
  if (
    params.get("inlineParentColor") === "accent" &&
    !params.has("font_prefix_color")
  )
    $("font_prefix_color").value = "accent-muted";
  if (
    legacy &&
    version !== "2" &&
    version !== "3" &&
    version !== "4" &&
    version !== "5" &&
    version !== "6"
  ) {
    const legacy = (id, fallback, max) => {
      const raw = params.get(id),
        value = raw === null ? NaN : Number(raw);
      return Number.isInteger(value) && value >= 0 && value <= max
        ? value
        : fallback;
    };
    $("indent").value = String(
      legacy("indent", 12, 24) - Number($("parentInset").value),
    );
    $("categoryRowIndent").value = String(
      legacy("categoryRowIndent", 12, 32) +
        Number($("rowInset").value) -
        Number($("categoryIndent").value),
    );
    $("categoryChildIndent").value = $("childIndent").value;
  }
  if (
    legacy &&
    version !== "3" &&
    version !== "4" &&
    version !== "5" &&
    version !== "6"
  ) {
    $("disclosureCategoryThread").value = $("disclosureThread").value;
    for (const role of ["catThread", "childThread", "catChildThread"])
      for (const field of fontFields)
        $(fontId({ id: role }, field)).value = $(
          fontId({ id: "thread" }, field),
        ).value;
    for (const id of ["catRowHeight", "childRowHeight", "catChildRowHeight"])
      $(id).value = $("rowHeight").value;
    for (const id of ["catStatusGap", "childStatusGap", "catChildStatusGap"])
      $(id).value = $("statusGap").value;
    for (const id of [
      "catStatusWidth",
      "childStatusWidth",
      "catChildStatusWidth",
    ])
      $(id).value = $("statusWidth").value;
    const oldLine = (role) =>
      Math.round(
        (Number($(fontId({ id: role }, { key: "size" })).value) *
          Number($(fontId({ id: role }, { key: "line" })).value)) /
          10,
      ) / 10;
    $("sectionHeight").value = String(oldLine("section"));
    $("categoryHeight").value = String(oldLine("category"));
    $("tierLabelHeight").value = String(Math.max(15.2, oldLine("tier")));
  }
  if (legacy && version !== "4" && version !== "5")
    $("inlineFamilyGap").value = $("familyGap").value;
  const known = new Set(data.map((item) => item.id)),
    knownChildren = new Set();
  for (const item of data) {
    const groups = item.rows
      ? [["rows", item.rows]]
      : (item.categories ?? []).map(([, rows], i) => [String(i), rows]);
    for (const [group, rows] of groups)
      rows.forEach((row, i) => {
        if (!row[2] && rows[i + 1]?.[2])
          knownChildren.add(childKey(item.id, group, i));
      });
  }
  for (const [prefix, panel] of [
    ["trial", "after"],
    ["current", "before"],
  ]) {
    for (const id of (params.get(prefix + "Collapsed") || "").split(","))
      if (known.has(id)) collapsed[panel].add(id);
    for (const id of (params.get(prefix + "Threads") || "").split(","))
      if (knownChildren.has(id)) childCollapsed[panel].add(id);
  }
  for (const key of (params.get("trialParents") || "").split(",")) {
    const [mode, tier, parent, first] = key.split(":");
    if (
      ["family", "runs", "two-prefix"].includes(mode) &&
      tier === "main" &&
      data.some((item) => item.parent === parent) &&
      (!first || known.has(first))
    )
      parentCollapsed.after.add(key);
  }
  for (const id of Object.keys(defaults)) {
    lastValid[id] = $(id).value;
    $(id).removeAttribute("aria-invalid");
  }
  for (const id of Object.keys(propertySources))
    if (
      linkKey(id) === id &&
      (!isLinked(id) ||
        params.has(id) ||
        (legacy &&
          version !== "5" &&
          id in inheritedCategorySpacing &&
          $("categorizedSpacing").value === "inherit"))
    )
      linkMemory.add(id);
}
function syncUrl() {
  const params = new URLSearchParams();
  if (previewMode !== "both") params.set("preview", previewMode);
  if (previewWidth !== null) params.set("previewWidth", String(previewWidth));
  if (theme !== "dark") params.set("theme", theme);
  if (legacyPresentation) params.set("legacyPresentation", "1");
  if (showBounds) params.set("bounds", "1");
  const changedLinks = [
    ...new Set([...defaultLinkExceptions, ...linkExceptions]),
  ].filter((id) => defaultLinkExceptions.has(id) !== linkExceptions.has(id));
  if (changedLinks.length)
    params.set("linkOverrides", changedLinks.sort().join(","));
  const savedMemory = [...linkMemory].filter((id) => isLinked(id));
  if (savedMemory.length)
    params.set("linkMemory", savedMemory.sort().join(","));
  for (const id of Object.keys(defaults))
    if (valueOf(id) !== defaults[id]) params.set(id, valueOf(id));
  for (const [prefix, panel] of [
    ["trial", "after"],
    ["current", "before"],
  ]) {
    if (collapsed[panel].size)
      params.set(prefix + "Collapsed", [...collapsed[panel]].sort().join(","));
    if (childCollapsed[panel].size)
      params.set(
        prefix + "Threads",
        [...childCollapsed[panel]].sort().join(","),
      );
  }
  const savedParents = [...parentCollapsed.after].filter(
    (key) => !key.includes(":other:"),
  );
  if (savedParents.length)
    params.set("trialParents", savedParents.sort().join(","));
  if ([...params].length) params.set("iv", "9");
  const target = new URL(document.baseURI);
  target.hash = params.toString();
  let embedded = window.self !== window.top;
  if (!embedded)
    try {
      history.replaceState(null, "", target.href);
    } catch {
      embedded = true;
    }
  document.body.dataset.embedded = String(embedded);
  $("urlNotice").hidden = !embedded;
  $("openSettings").href = target.href;
  $("shareUrl").value = target.href;
}
function ordered(list) {
  if ($("sort").value === "manual") return [...list];
  const label = (item) =>
    item.parent ? `${item.parent}: ${item.name}` : item.name;
  return [...list].sort((a, b) =>
    $("sort").value === "activity"
      ? b.activity - a.activity
      : compareGroupNames(label(a), label(b)),
  );
}
function units(list, mode) {
  const sorted = ordered(list);
  if (mode === "prefix")
    return sorted.map((x) => ({
      key: x.parent || x.id,
      parent: "",
      items: [x],
    }));
  if (mode === "runs") {
    const groups = [];
    for (const x of sorted) {
      const key = x.parent || x.id;
      const prev = groups[groups.length - 1];
      if (prev && prev.key === key) prev.items.push(x);
      else groups.push({ key, parent: x.parent, items: [x] });
    }
    return groups;
  }
  const groups = [];
  for (const x of sorted) {
    const key = x.parent || x.id;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, parent: x.parent, items: [] };
      groups.push(group);
    }
    group.items.push(x);
  }
  return mode === "two-prefix"
    ? groups.flatMap((group) =>
        group.parent && group.items.length === 2
          ? group.items.map((item) => ({
              key: group.key,
              parent: "",
              items: [item],
              prefix: true,
            }))
          : [group],
      )
    : groups;
}
function chevron(expanded) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "chevron-icon" + (expanded ? " expanded" : ""));
  svg.innerHTML =
    '<path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>';
  return svg;
}
function focusIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "focus-icon");
  svg.innerHTML =
    '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3.5" fill="currentColor" fill-opacity=".9"/></g>';
  return svg;
}
function applyCollapsedText(element, role, inline = false) {
  const resolve = (id) =>
    inline && role === "collapsedWorkstream" && isLinked(id)
      ? effectiveValue(
          id.replace("font_collapsedWorkstream_", "font_inlineWorkstream_"),
        )
      : effectiveValue(id);
  for (const field of fontFields) {
    const value = resolve(fontId({ id: role }, field)),
      property = {
        family: "fontFamily",
        transform: "textTransform",
        size: "fontSize",
        weight: "fontWeight",
        line: "lineHeight",
        spacing: "letterSpacing",
      }[field.key];
    element.style[property] =
      field.key === "family"
        ? families[value]
        : field.key === "transform"
          ? value
          : field.key === "line"
            ? String(Number(value) / 100)
            : value + field.unit;
  }
  element.style.color = "";
  applyFontColor(element, role, "after", resolve);
}
function applyFontColor(element, role, panel, resolve = effectiveValue) {
  if (panel === "before") resolve = (id) => currentDefaults[id];
  const mode = resolve(`font_${role}_color`);
  if (mode === "default") {
    if (
      role === "category" &&
      panel === "after" &&
      valueOf("mix") !== appDefaults.mix
    )
      element.style.color = `color-mix(in oklab, var(--color) ${valueOf("mix")}%, oklch(from var(--color) l 0 h))`;
    return;
  }
  const accent =
      role === "parent" || role === "collapsedParent"
        ? "var(--family-color)"
        : "var(--color)",
    blend = accentRoles.has(role) ? resolve(`font_${role}_blend`) : "70",
    mixWith = {
      "accent-muted": "var(--muted)",
      "accent-foreground": "var(--ink)",
      "accent-background": "var(--bg)",
      "accent-black": "black",
      "accent-white": "white",
      "accent-gray": `oklch(from ${accent} l 0 h)`,
    };
  element.style.color =
    mode === "foreground"
      ? "var(--ink)"
      : mode === "muted"
        ? "var(--muted)"
        : mode === "custom"
          ? resolve(`font_${role}_customColor`)
          : mode === "accent"
            ? accent
            : `color-mix(in oklab, ${accent} ${blend}%, ${mixWith[mode]})`;
  if (role === "prefix") element.style.opacity = "1";
}
function childKey(itemId, group, index) {
  return `${itemId}.${group}.${index}`;
}
function guide(panel, target, kind, base = "0px", shift = true) {
  if (panel !== "after" || valueOf(`guide${kind}Show`) !== "on") return;
  const width = Number(valueOf(`guide${kind}Width`));
  const indent = Number(valueOf(`guide${kind}Indent`));
  const spacing = Number(valueOf(`guide${kind}Spacing`));
  const color = valueOf(`guide${kind}Color`);
  target.dataset.guide = kind;
  target.style.backgroundImage = `linear-gradient(${color}, ${color})`;
  target.style.backgroundRepeat = "no-repeat";
  target.style.backgroundPosition = `calc(${base} + ${indent}px) 0`;
  target.style.backgroundSize = `${width}px 100%`;
  if (shift)
    target.style.paddingLeft = `${Math.max(0, indent + width + spacing)}px`;
}

function addRows(root, item, panel) {
  const renderList = (rows, group, categorized, container = root) => {
    let hidden = false;
    rows.forEach(([kind, title, depth], index) => {
      if (!depth)
        hidden = childCollapsed[panel].has(childKey(item.id, group, index));
      else if (hidden) return;
      const key = childKey(item.id, group, index),
        hasChildren = !depth && Boolean(rows[index + 1]?.[2]);
      const row = document.createElement("div");
      row.className =
        "row" +
        (categorized ? " categorized" : "") +
        (depth ? " child" : "") +
        (hasChildren ? " has-disclosure" : "");
      row.dataset.disclosure =
        panel === "after"
          ? $(categorized ? "disclosureCategoryThread" : "disclosureThread")
              .value
          : "current";
      row.dataset.disclosurePlacement =
        panel === "after"
          ? valueOf(
              categorized
                ? "disclosureCategoryThreadPlacement"
                : "disclosureThreadPlacement",
            )
          : "left";
      row.dataset.hasStatus = String(kind !== "none");
      const textRole = depth
        ? categorized
          ? "catChildThread"
          : "childThread"
        : categorized
          ? "catThread"
          : "thread";
      const weightKey = `font_${textRole}_weight`;
      row.dataset.customWeight = String(
        panel === "after" &&
          (legacyPresentation ||
            effectiveValue(weightKey) !== appDefaults[weightKey]),
      );
      mountThread(panel, row, {
        title,
        kind,
        legacy: panel === "after" && legacyPresentation,
        depth: depth || 0,
        categorized,
        expanded: !hidden,
        toggle: hasChildren
          ? () => {
              if (childCollapsed[panel].has(key))
                childCollapsed[panel].delete(key);
              else childCollapsed[panel].add(key);
              queueMicrotask(() => {
                render();
                $(panel).querySelector(`[data-child-key="${key}"]`)?.focus();
              });
            }
          : undefined,
      });
      const text = row.querySelector(".ws-text-thread");
      text.classList.add("title");
      const disclosure = row.querySelector(".ws-disclosure");
      if (disclosure) {
        disclosure.dataset.childKey = key;
        disclosure.classList.add("thread-disclosure");
      }
      applyFontColor(text, textRole, panel);
      const wrap = document.createElement("div");
      wrap.className =
        "row-wrap" +
        (categorized ? " categorized" : "") +
        (depth ? " child" : "");
      wrap.append(row);
      if (depth && panel === "after" && valueOf("guidechildrenShow") === "on") {
        guide(
          panel,
          wrap,
          "children",
          categorized ? "var(--categorized-offset)" : "var(--row-offset)",
          false,
        );
        const offset = categorized
          ? "var(--child-category-offset)"
          : "var(--child-offset)";
        row.style.marginLeft = `calc(${offset} + ${valueOf("guidechildrenSpacing")}px)`;
      }
      const role = categorized ? "collapsedCatThread" : "collapsedThread";
      if (panel === "after" && hasChildren && hidden && collapsedActive(role)) {
        wrap.style.paddingTop = effectiveValue(role + "Before") + "px";
        wrap.style.paddingBottom = effectiveValue(role + "After") + "px";
        row.style.height = effectiveValue(role + "Height") + "px";
        applyCollapsedText(text, role);
      }
      container.append(wrap);
    });
  };
  if (item.rows) renderList(item.rows, "rows", false);
  if (item.categories)
    item.categories.forEach(([name, rows], index) => {
      const cat = document.createElement("div");
      cat.className = "cat ws-category-label" + (index ? " subsequent" : "");
      cat.textContent = name;
      applyFontColor(cat, "category", panel);
      root.append(cat);
      const content = document.createElement("div");
      content.className = "category-content";
      guide(panel, content, "category", "var(--cat-offset)");
      root.append(content);
      renderList(rows, String(index), true, content);
    });
}
function insetValue(panel, id) {
  return Number(panel === "after" ? layoutValue(id) : currentDefaults[id]);
}
function insetPosition(panel, id, parent) {
  const reference =
      panel === "after"
        ? layoutValue(id + "Reference")
        : currentDefaults[id + "Reference"],
    value = insetValue(panel, id);
  return reference === "absolute"
    ? value
    : reference === "content"
      ? 1 + insetValue(panel, "sideX") + value
      : parent + value;
}
function renderUnit(item, mode, panel, lower, hasParent) {
  const unit = document.createElement("div");
  unit.className = "unit";
  unit.style.setProperty("--color", `var(--${item.color})`);
  // The fixture supplies a theme-specific color; production names read these tokens.
  unit.style.setProperty("--ws-color-light", "var(--color)");
  unit.style.setProperty("--ws-color-dark", "var(--color)");
  const variant = hasParent
      ? "grouped"
      : mode === "prefix" && item.parent
        ? "inline"
        : "top",
    isCollapsed = lower
      ? !lowerExpanded[panel].has(item.id)
      : collapsed[panel].has(item.id),
    treatment = workstreamRows[variant][isCollapsed ? "collapsed" : "expanded"],
    get = (key) =>
      panel === "after"
        ? layoutValue(treatment[key])
        : currentDefaults[
            workstreamRows[variant === "grouped" ? "grouped" : "top"].expanded[
              key
            ]
          ],
    base = 1 + insetValue(panel, "sideX"),
    parent = insetPosition(panel, "parentInset", base),
    reference = get("reference"),
    work =
      reference === "absolute"
        ? Number(get("indent"))
        : reference === "content"
          ? base + Number(get("indent"))
          : (hasParent ? parent : base) + Number(get("indent")),
    cat = insetPosition(panel, "categoryIndent", work),
    row = insetPosition(panel, "rowInset", work),
    categorized = insetPosition(panel, "categoryRowIndent", cat),
    child = insetPosition(panel, "childIndent", row),
    categoryChild = insetPosition(panel, "categoryChildIndent", categorized);
  for (const [name, absolute] of Object.entries({
    cat,
    row,
    categorized,
    child,
    "child-category": categoryChild,
  }))
    unit.style.setProperty("--" + name + "-offset", absolute - work + "px");
  unit.dataset.collapsed = String(isCollapsed);
  unit.style.marginLeft = work - base + "px";
  unit.style.setProperty("--chevron-width", get("slot") + "px");
  unit.style.setProperty("--header-gap", get("gap") + "px");
  unit.style.setProperty("--header-height", get("height") + "px");
  unit.style.setProperty("--workstream-before", get("before") + "px");
  unit.style.setProperty("--workstream-after", get("after") + "px");
  const heading = document.createElement("button");
  heading.type = "button";
  heading.className = "heading";
  heading.dataset.placement = get("placement");
  heading.dataset.disclosure = get("visibility");
  heading.setAttribute("aria-expanded", String(!isCollapsed));
  heading.setAttribute(
    "aria-label",
    `${item.parent ? item.parent + ": " : ""}${item.name}`,
  );
  const chev = document.createElement("span");
  chev.className = "chev";
  chev.setAttribute("aria-hidden", "true");
  chev.append(chevron(!isCollapsed));
  const name = document.createElement("span");
  name.className = "name";
  mountWorkstreamName(
    panel,
    name,
    mode === "prefix" && item.parent
      ? `${item.parent}: ${item.name}`
      : item.name,
  );
  const prefix = name.querySelector(".ws-text-prefix");
  if (prefix) {
    prefix.classList.add("prefix");
    const fixedGap = panel === "after" && valueOf("prefixGapMode") === "fixed";
    if (fixedGap) prefix.style.marginRight = valueOf("prefixGap") + "px";
    applyFontColor(prefix, "prefix", panel);
  }
  const accent = name.querySelector(".ws-workstream-name");
  const separate =
    mode === "prefix" &&
    item.parent &&
    (panel === "before" || inlineWorkstreamActive());
  accent.classList.add("accent");
  if (separate) accent.classList.add("inline-workstream");
  applyFontColor(accent, separate ? "inlineWorkstream" : "workstream", panel);
  if (panel === "after") applyCollapsedText(accent, treatment.text);
  const rightChevron = get("placement") === "right";
  if (!rightChevron) heading.append(chev);
  heading.append(name);
  if (rightChevron) heading.append(chev);
  if ($("focus").value === "on" && item.focused) heading.append(focusIcon());
  heading.addEventListener("click", () => {
    const set = lower ? lowerExpanded[panel] : collapsed[panel];
    if (set.has(item.id)) set.delete(item.id);
    else set.add(item.id);
    render();
    [...$(panel).querySelectorAll(".heading")]
      .find(
        (button) =>
          button.getAttribute("aria-label") ===
          heading.getAttribute("aria-label"),
      )
      ?.focus();
  });
  const headerWrap = document.createElement("div");
  headerWrap.className = "heading-wrap";
  headerWrap.append(heading);
  unit.append(headerWrap);
  if (!isCollapsed) {
    const content = document.createElement("div");
    content.className = "workstream-content";
    guide(panel, content, "workstream");
    unit.append(content);
    addRows(content, item, panel);
  }
  return unit;
}
function renderPanel(id, mode) {
  clearComponents(id);
  const el = $(id),
    scrollTop = el.scrollTop;
  el.replaceChildren();
  el.classList.toggle("light", theme === "light");
  el.dataset.showBounds = String(showBounds);
  const isTrial = id === "after";
  el.style.setProperty("--sidebar-width", valueOf("width") + "px");
  el.style.setProperty(
    "--family-gap",
    (isTrial
      ? Number(valueOf("itemGap")) + Number(valueOf("familyGap"))
      : Number(currentDefaults.itemGap) + Number(currentDefaults.familyGap)) +
      "px",
  );
  el.style.setProperty(
    "--item-gap",
    (isTrial ? valueOf("itemGap") : currentDefaults.itemGap) + "px",
  );
  el.style.setProperty(
    "--inline-family-gap",
    (isTrial
      ? Number(valueOf("itemGap")) + Number(valueOf("inlineFamilyGap"))
      : Number(currentDefaults.itemGap) +
        Number(currentDefaults.inlineFamilyGap)) + "px",
  );
  el.style.setProperty(
    "--cat-gap",
    (isTrial ? valueOf("catGap") : currentDefaults.catGap) + "px",
  );
  el.style.setProperty(
    "--between-categories",
    (isTrial ? valueOf("categoryBetween") : currentDefaults.categoryBetween) +
      "px",
  );
  el.style.setProperty("--indent", (isTrial ? valueOf("indent") : 0) + "px");
  el.style.setProperty(
    "--mix",
    (isTrial ? valueOf("mix") : currentDefaults.mix) + "%",
  );
  el.dataset.workstreamDisclosure = isTrial
    ? $("disclosureWorkstream").value
    : currentDefaults.disclosureWorkstream;
  el.dataset.parentDisclosure = isTrial
    ? $("disclosureParent").value
    : "always";
  el.dataset.parentChevronPlacement = isTrial
    ? $("parentChevronPlacement").value
    : "inline";
  el.dataset.workstreamChevronPlacement = isTrial
    ? $("workstreamChevronPlacement").value
    : currentDefaults.workstreamChevronPlacement;
  const spacing = {
    parentChevronWidth: "parent-chevron-width",
    parentChevronGap: "parent-chevron-gap",
    statusGap: "status-gap",
    rowHeight: "row-height",
    headerHeight: "header-height",
    parentHeight: "parent-height",
    sectionHeight: "section-height",
    parentBefore: "parent-before",
    parentAfter: "parent-after",
    workstreamBefore: "workstream-before",
    workstreamAfter: "workstream-after",
    categoryHeight: "category-height",
    rootBefore: "root-before",
    rootAfter: "root-after",
    catRootBefore: "cat-root-before",
    catRootAfter: "cat-root-after",
    catRowHeight: "cat-row-height",
    catStatusGap: "cat-status-gap",
    catStatusWidth: "cat-status-width",
    childBefore: "child-before",
    childAfter: "child-after",
    childRowHeight: "child-row-height",
    childStatusGap: "child-status-gap",
    childStatusWidth: "child-status-width",
    catChildBefore: "cat-child-before",
    catChildAfter: "cat-child-after",
    catChildRowHeight: "cat-child-row-height",
    catChildStatusGap: "cat-child-status-gap",
    catChildStatusWidth: "cat-child-status-width",
    tierLabelHeight: "tier-label-height",
    catAfter: "cat-after",
    rowInset: "row-inset",
    categoryIndent: "cat-inset",
    categoryRowIndent: "category-row-indent",
    childIndent: "child-indent",
    statusWidth: "status-width",
    headerGap: "header-gap",
    chevronWidth: "chevron-width",
    parentInset: "parent-inset",
    sectionGap: "section-gap",
    sectionTop: "section-top",
    sectionInset: "section-inset",
    sideX: "side-x",
    sideY: "side-y",
    tierGap: "tier-gap",
    tierLabelTop: "tier-label-top",
    tierLabelInset: "tier-label-inset",
    tierLabelBottom: "tier-label-bottom",
  };
  for (const [input, property] of Object.entries(spacing))
    el.style.setProperty(
      "--" + property,
      (isTrial ? layoutValue(input) : currentDefaults[input]) + "px",
    );
  const base = 1 + insetValue(id, "sideX"),
    parent = insetPosition(id, "parentInset", base);
  el.style.setProperty("--parent-offset", parent - base + "px");
  el.style.setProperty(
    "--workstream-offset",
    insetPosition(id, "indent", parent) - base + "px",
  );
  el.style.setProperty(
    "--top-workstream-offset",
    insetPosition(id, "topWorkstreamIndent", base) - base + "px",
  );
  el.style.setProperty(
    "--section-offset",
    insetPosition(id, "sectionInset", base) - base + "px",
  );
  el.style.setProperty(
    "--tier-label-inset",
    insetPosition(id, "tierLabelInset", base) - base + "px",
  );
  for (const spec of fontSpecs)
    for (const field of fontFields) {
      const input = fontId(spec, field),
        value = isTrial ? effectiveValue(input) : currentDefaults[input];
      el.style.setProperty(
        `--font-${spec.id}-${field.key}`,
        field.key === "family"
          ? families[value]
          : field.key === "transform"
            ? value
            : field.key === "line"
              ? String(Number(value) / 100)
              : value + field.unit,
      );
    }
  const title = document.createElement("div");
  title.className = "section-title";
  title.textContent = "Workstreams";
  applyFontColor(title, "section", id);
  el.append(title);
  const sectionContent = document.createElement("div");
  sectionContent.className = "section-content";
  guide(id, sectionContent, "section");
  el.append(sectionContent);
  const drawGroups = (items, lower) => {
    const tierEl = document.createElement("div");
    tierEl.className = "tier";
    let previousKey = null,
      previousInline = false,
      previousGap = null,
      previousCollapsed = false,
      previousItem = null;
    for (const group of units(items, mode)) {
      const inline = Boolean(
          (mode === "prefix" || group.prefix) && group.items[0].parent,
        ),
        boundary =
          previousKey !== null &&
          group.key !== previousKey &&
          (inline || previousInline);
      const family = document.createElement("div");
      family.className =
        "family" +
        (group.parent ? " has-parent" : "") +
        (group.key === previousKey ? " same-parent" : "") +
        (boundary ? " inline-boundary" : "");
      const useAppGaps =
        mode === "prefix" &&
        (!isTrial ||
          (!legacyPresentation &&
            [
              "itemGap",
              "familyGap",
              "inlineFamilyGap",
              "collapsedWorkstreamGap",
              "collapsedInlineBoundaryMode",
              "collapsedInlineFamilyGap",
            ].every((key) => effectiveValue(key) === defaults[key])));
      const collapsedBoundary =
        boundary &&
        previousCollapsed &&
        (isTrial
          ? valueOf("collapsedInlineBoundaryMode")
          : currentDefaults.collapsedInlineBoundaryMode) === "separate";
      if (previousKey !== null && (previousGap !== null || collapsedBoundary)) {
        const extraId = boundary
            ? collapsedBoundary
              ? "collapsedInlineFamilyGap"
              : "inlineFamilyGap"
            : "familyGap",
          extra =
            group.key === previousKey
              ? 0
              : Number(isTrial ? valueOf(extraId) : currentDefaults[extraId]);
        family.style.marginTop =
          (previousGap ??
            Number(isTrial ? valueOf("itemGap") : currentDefaults.itemGap)) +
          extra +
          "px";
      }
      if (useAppGaps && previousItem) {
        const gapGroup = (item) => ({
          id: item.id,
          name: item.parent ? `${item.parent}: ${item.name}` : item.name,
        });
        family.style.marginTop = `${workstreamGap(gapGroup(previousItem), gapGroup(group.items[0]), previousCollapsed)}px`;
      }
      family.style.setProperty(
        "--family-color",
        `var(--${{ Studio: "blue", Agent: "orange", Tools: "teal" }[group.parent] ?? group.items[0].color})`,
      );
      previousKey = group.key;
      previousInline = inline;
      let isParentCollapsed = false;
      if (group.parent) {
        const key = [
          mode,
          lower ? "other" : "main",
          group.key,
          mode === "runs" ? group.items[0].id : "",
        ].join(":");
        isParentCollapsed = parentCollapsed.after.has(key);
        const parent = document.createElement("button");
        parent.type = "button";
        parent.className = "parent";
        parent.dataset.parentKey = key;
        parent.setAttribute("aria-expanded", String(!isParentCollapsed));
        parent.setAttribute("aria-label", group.parent);
        const chev = document.createElement("span");
        chev.className = "chev";
        chev.append(chevron(!isParentCollapsed));
        const label = document.createElement("span");
        label.className = "name";
        label.textContent = group.parent;
        applyFontColor(label, "parent", id);
        if (
          isTrial &&
          isParentCollapsed &&
          collapsedActive("collapsedParent")
        ) {
          parent.style.marginTop =
            effectiveValue("collapsedParentBefore") + "px";
          parent.style.height = effectiveValue("collapsedParentHeight") + "px";
          parent.style.marginBottom =
            effectiveValue("collapsedParentAfter") + "px";
          applyCollapsedText(label, "collapsedParent");
        }
        if (
          (isTrial
            ? valueOf("parentChevronPlacement")
            : currentDefaults.parentChevronPlacement) === "right"
        )
          parent.append(label, chev);
        else parent.append(chev, label);
        parent.addEventListener("click", () => {
          if (parentCollapsed.after.has(key)) parentCollapsed.after.delete(key);
          else parentCollapsed.after.add(key);
          render();
          [...$(id).querySelectorAll(".parent")]
            .find((button) => button.dataset.parentKey === key)
            ?.focus();
        });
        family.append(parent);
      }
      let familyContent = family;
      if (group.parent && !isParentCollapsed) {
        familyContent = document.createElement("div");
        familyContent.className = "family-content";
        guide(id, familyContent, "parent", "var(--parent-offset)");
        family.append(familyContent);
      }
      let withinGap = null,
        lastCollapsed = false;
      if (!isParentCollapsed)
        for (const item of group.items) {
          const unit = renderUnit(
            item,
            group.prefix ? "prefix" : mode,
            id,
            lower,
            Boolean(group.parent),
          );
          if (withinGap !== null) unit.style.marginTop = withinGap + "px";
          familyContent.append(unit);
          lastCollapsed = unit.dataset.collapsed === "true";
          withinGap =
            lastCollapsed &&
            (isTrial ? collapsedActive("collapsedWorkstream") : true)
              ? Number(
                  isTrial
                    ? effectiveValue("collapsedWorkstreamGap")
                    : currentDefaults.collapsedWorkstreamGap,
                )
              : null;
        }
      previousCollapsed = isParentCollapsed || lastCollapsed;
      previousItem = group.items.at(-1);
      previousGap =
        isParentCollapsed && isTrial && collapsedActive("collapsedParent")
          ? Number(effectiveValue("collapsedParentGap"))
          : withinGap;
      tierEl.append(family);
    }
    sectionContent.append(tierEl);
  };
  if ($("focus").value === "on") {
    drawGroups(
      data.filter((item) => item.focused),
      false,
    );
    const other = data.filter((item) => !item.focused),
      toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tier-label tier-toggle";
    toggle.setAttribute("aria-expanded", String(showLower[id]));
    const text = document.createElement("span");
    text.textContent = showLower[id]
      ? "Hide other workstreams"
      : "Show other workstreams";
    applyFontColor(text, "tier", id);
    toggle.append(text);
    if (!showLower[id]) {
      const rows = other
          .flatMap(
            (item) =>
              item.rows ??
              item.categories?.flatMap(([, entries]) => entries) ??
              [],
          )
          .filter((row) => !row[2]),
        waiting = rows.filter(
          (row) => row[0] === "waiting" || row[0] === "decision",
        ).length,
        counts = document.createElement("span");
      counts.className = "tier-counts";
      if (waiting) {
        const pill = document.createElement("span");
        pill.className = "tier-waiting";
        pill.textContent = String(waiting);
        counts.append(pill);
      }
      const total = document.createElement("span");
      total.textContent = String(rows.length);
      counts.append(total);
      counts.setAttribute("aria-hidden", "true");
      toggle.append(counts);
    }
    toggle.addEventListener("click", () => {
      if (showLower[id]) {
        lowerExpanded[id].clear();
        if (id === "after")
          for (const key of parentCollapsed.after)
            if (key.includes(":other:")) parentCollapsed.after.delete(key);
      }
      showLower[id] = !showLower[id];
      render();
      $(id).querySelector(".tier-toggle")?.focus();
    });
    sectionContent.append(toggle);
    if (showLower[id]) drawGroups(other, true);
  } else drawGroups(data, false);
  el.scrollTop = scrollTop;
}
function render() {
  document.body.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  $("baselineNote").textContent = legacyPresentation
    ? "Trial uses an older saved presentation; Reset all returns to the app's sidebar defaults."
    : "Trial starts with the app's sidebar defaults.";
  $("showBounds").setAttribute("aria-pressed", String(showBounds));
  document
    .querySelector(".playground")
    .style.setProperty("--requested-width", valueOf("width") + "px");
  layoutPreview();
  $("resetTheme").disabled = theme === "dark";
  for (const t of ["dark", "light"])
    $(t).setAttribute("aria-pressed", String(theme === t));
  const mode = $("grouping").value;
  $("groupingHint").textContent =
    mode === "two-prefix"
      ? "Two siblings: prefix; one or three+: shared parent"
      : mode === "family"
        ? "Siblings stay together within each tier"
        : mode === "runs"
          ? "Order stays intact; parent labels can repeat"
          : "Each workstream repeats its parent";
  for (const id of [
    "parentHeight",
    "parentBefore",
    "parentAfter",
    "parentInset",
    "parentInsetReference",
    "parentChevronWidth",
    "parentChevronGap",
    "disclosureParent",
    "parentChevronPlacement",
  ])
    $(id).disabled = mode === "prefix";
  for (const id of [
    "tierGap",
    "tierLabelTop",
    "tierLabelHeight",
    "tierLabelInset",
    "tierLabelInsetReference",
    "tierLabelBottom",
    ...fieldsFor({ id: "tier" }).map((field) => fontId({ id: "tier" }, field)),
  ])
    $(id).disabled = $("focus").value === "off";
  for (const field of fieldsFor({ id: "parent" }))
    $(fontId({ id: "parent" }, field)).disabled = mode === "prefix";
  for (const field of fieldsFor({ id: "prefix" }))
    $(fontId({ id: "prefix" }, field)).disabled =
      mode === "family" || mode === "runs";
  const prefixInactive = mode === "family" || mode === "runs";
  $("inlineFamilyGap").disabled = prefixInactive;
  $("collapsedInlineBoundaryMode").disabled = prefixInactive;
  $("collapsedInlineFamilyGap").disabled =
    prefixInactive || $("collapsedInlineBoundaryMode").value !== "separate";
  $("collapsedInlineFamilyGap").closest(".control").hidden =
    $("collapsedInlineBoundaryMode").value !== "separate";
  $("prefixGapMode").disabled = prefixInactive;
  $("prefixGap").disabled =
    prefixInactive || $("prefixGapMode").value !== "fixed";
  $("prefixGap").closest(".control").hidden =
    $("prefixGapMode").value !== "fixed";
  $("prefixHint").textContent = prefixInactive
    ? "Choose a prefix treatment in View to preview these controls."
    : mode === "two-prefix"
      ? "Shown for parents with exactly two visible workstreams."
      : "Shown before each workstream with a parent.";
  $("inlineWorkstreamHint").textContent = prefixInactive
    ? "Not shown with the current parent treatment."
    : "Shown when the parent and workstream share a heading.";
  $("groupedWorkstreamHint").textContent =
    mode === "prefix"
      ? "Not shown with the current parent treatment."
      : "Shown beneath a shared parent heading.";
  $("inlineWorkstreamStyle").disabled = false;
  for (const field of fieldsFor({ id: "inlineWorkstream" }))
    $(fontId({ id: "inlineWorkstream" }, field)).disabled = false;
  for (const [role, spec] of Object.entries(collapsedSpecs)) {
    const unavailable = role === "collapsedParent" && prefixInactive,
      mode = $(role + "Mode");
    mode.disabled = unavailable;
    for (const id of Object.keys(spec.spacing)) {
      $(id).disabled = unavailable;
      $(id).closest(".control").hidden = false;
    }
    for (const field of fieldsFor({ id: role }))
      $(fontId({ id: role }, field)).disabled = unavailable;
  }
  for (const spec of fontSpecs) {
    const colorId = fontId(spec, { key: "color" }),
      selection = effectiveValue(colorId),
      disabled = $(colorId).disabled || isLinked(colorId);
    const custom = $(fontId(spec, { key: "customColor" }));
    custom.disabled = disabled || selection !== "custom";
    custom.closest(".control").hidden =
      selection !== "custom" || isLinked(colorId);
    if (accentRoles.has(spec.id)) {
      const blend = $(fontId(spec, { key: "blend" })),
        mixing = selection.startsWith("accent-");
      blend.disabled = disabled || !mixing;
      blend.closest(".control").hidden = !mixing || isLinked(colorId);
    }
  }
  $("mix").disabled = $("font_category_color").value !== "default";
  $("mix").closest(".control").hidden = $("mix").disabled;
  for (const id of ["parentChevronPlacement", "workstreamChevronPlacement"]) {
    const hint = $(id).closest(".control").querySelector(".placement-hint"),
      placement = $(id).value;
    hint.hidden = placement === "inline";
    hint.textContent =
      placement === "hanging"
        ? "Hanging chevrons can clip at the sidebar edge; increase the row indent to make room."
        : "The chevron follows the label and keeps its space when hidden.";
  }
  const inheritCategory = $("categorizedSpacing").value === "inherit";
  for (const id of Object.keys(inheritedCategorySpacing))
    $(id).closest(".control").querySelector(".inherited-hint").hidden = true;
  for (const id of Object.keys(propertySources)) {
    if (linkKey(id) !== id) continue;
    const input = $(id),
      row = input.parentElement,
      wrap = row.parentElement,
      display = wrap.querySelector(".linked-value"),
      toggle = wrap.querySelector(".link-toggle"),
      linked = isLinked(id),
      unavailable =
        (id.startsWith("collapsedParent") ||
          id.startsWith("font_collapsedParent_")) &&
        prefixInactive,
      value = effectiveValue(id);
    input.disabled = unavailable || linked;
    row.hidden = linked;
    display.hidden = !linked;
    display.disabled = unavailable;
    toggle.disabled = unavailable;
    toggle.hidden = linked;
    toggle.textContent = "Link";
    toggle.setAttribute(
      "aria-label",
      "Use linked value for " + input.getAttribute("aria-label"),
    );
    toggle.setAttribute("aria-pressed", String(linked));
    const unit = input.dataset.unit ?? "px";
    let label =
      input.type === "number"
        ? value + (unit ? " " + unit : "")
        : input.type === "color"
          ? value
          : ([...input.options].find((option) => option.value === value)
              ?.textContent ?? value);
    if (id.endsWith("_color")) {
      const role = id.slice(5, -6);
      if (value === "custom")
        label += " · " + effectiveValue(`font_${role}_customColor`);
      else if (value.startsWith("accent-"))
        label += " · " + effectiveValue(`font_${role}_blend`) + "%";
    }
    if (
      linked &&
      !prefixInactive &&
      id.startsWith("font_collapsedWorkstream_")
    ) {
      const inlineId = id.replace(
          "font_collapsedWorkstream_",
          "font_inlineWorkstream_",
        ),
        colorDiff =
          id.endsWith("_color") &&
          ((value === "custom" &&
            effectiveValue("font_collapsedWorkstream_customColor") !==
              effectiveValue("font_inlineWorkstream_customColor")) ||
            (value.startsWith("accent-") &&
              effectiveValue("font_collapsedWorkstream_blend") !==
                effectiveValue("font_inlineWorkstream_blend")));
      if (effectiveValue(id) !== effectiveValue(inlineId) || colorDiff)
        label = "Varies by title";
    }
    display.textContent = "↳ " + label;
    const sourceId =
        variantFallback[id] && !isLinked(variantFallback[id])
          ? variantFallback[id]
          : propertySources[id],
      sourceLabel = id.startsWith("font_collapsedWorkstream_")
        ? "expanded workstream title"
        : $(sourceId).getAttribute("aria-label");
    display.title = "Linked to " + sourceLabel + ": " + label;
    display.setAttribute(
      "aria-label",
      "Linked to " +
        sourceLabel +
        ". Activate to override " +
        input.getAttribute("aria-label") +
        ": " +
        label,
    );
  }
  for (const button of document.querySelectorAll(".bulk-link")) {
    const ids = button.dataset.linkIds.split(","),
      linked = ids.every(isLinked);
    const side = button.dataset.linkLabel.startsWith("expanded ")
      ? "expanded"
      : button.dataset.linkLabel.startsWith("collapsed ")
        ? "collapsed"
        : "all";
    button.textContent = (linked ? "Separate " : "Link ") + side;
    button.setAttribute(
      "aria-label",
      (linked ? "Separate all " : "Link all ") + button.dataset.linkLabel,
    );
    button.disabled = ids.every(
      (id) =>
        $(id).closest(".linked-field").querySelector(".link-toggle").disabled,
    );
  }
  for (const output of document.querySelectorAll(".matrix output[data-source]"))
    output.textContent = valueOf(output.dataset.source) + " px";
  for (const tr of document.querySelectorAll(".matrix tr[data-pair-b]")) {
    const a = tr.dataset.pairA,
      b = tr.dataset.pairB;
    tr.hidden =
      Boolean(a) &&
      $(a).closest(".control").hidden &&
      $(b).closest(".control").hidden;
  }
  for (const id of Object.keys(defaults)) {
    const input = $(id),
      row = input.parentElement,
      reset = row.querySelector(".property-reset");
    reset.disabled =
      input.disabled ||
      (input.value === defaults[id] &&
        (input.type !== "number" || validNumber(input)));
    if (input.type === "number") {
      row.querySelector(".step-minus").disabled = input.disabled;
      row.querySelector(".step-plus").disabled = input.disabled;
    }
  }
  $("disclosureThreadHint").textContent =
    $("disclosureThreadPlacement").value === "right"
      ? "Right placement keeps the status mark visible."
      : "Current: status swaps to a chevron on hover";
  $("indentHint").textContent =
    mode === "prefix"
      ? "Available with a shared parent"
      : "Workstreams under a shared parent";
  $("orderNote").textContent =
    mode === "family"
      ? "Shared parent gathers siblings within each tier; the first sibling in the chosen order positions the family."
      : mode === "two-prefix"
        ? "Two visible siblings in a tier use prefixes; one or three or more use a shared parent. Siblings stay together."
        : mode === "runs"
          ? "Preserves the chosen workstream order; a parent label repeats if another family interrupts it."
          : "Preserves the chosen workstream order and repeats the parent prefix on each header.";
  renderPanel("before", "prefix");
  renderPanel("after", mode);
  const preset = Object.entries(presets).find(([, u]) =>
    Object.entries(presetValues(u)).every(
      ([id, value]) => effectiveValue(id) === String(value),
    ),
  );
  for (const button of document.querySelectorAll("[data-preset]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.preset === preset?.[0]),
    );
  const values = {
    theme,
    showBounds,
    spacingPreset: preset?.[0] ?? "custom",
    spacingUnitPx: preset?.[1] ?? null,
    units: {
      spacing: "px",
      mix: "percent",
      fontSize: "px",
      fontLineHeight: "percent",
      fontLetterSpacing: "px",
      fontWeight: "css",
    },
    ...Object.fromEntries(
      Object.keys(defaults).map((id) => [
        id,
        $(id).type === "number" ? Number(valueOf(id)) : valueOf(id),
      ]),
    ),
    totalParentGapPx: Number(valueOf("familyGap")) + Number(valueOf("itemGap")),
    totalInlineParentGapPx:
      Number(valueOf("inlineFamilyGap")) + Number(valueOf("itemGap")),
    collapsedInlineBoundaryExtraPx: Number(
      valueOf(
        valueOf("collapsedInlineBoundaryMode") === "separate"
          ? "collapsedInlineFamilyGap"
          : "inlineFamilyGap",
      ),
    ),
    effectiveCategorizedSpacing: Object.fromEntries(
      Object.keys(inheritedCategorySpacing).map((id) => [
        id,
        $(id).type === "number" ? Number(layoutValue(id)) : layoutValue(id),
      ]),
    ),
    propertyLinks: Object.fromEntries(
      Object.keys(propertySources)
        .filter((id) => linkKey(id) === id)
        .map((id) => {
          const value = effectiveValue(id),
            entry = {
              source: propertySources[id],
              linked: isLinked(id),
              value: $(id).type === "number" ? Number(value) : value,
            };
          if (id.startsWith("font_collapsedWorkstream_") && isLinked(id)) {
            const inlineValue = effectiveValue(
              id.replace("font_collapsedWorkstream_", "font_inlineWorkstream_"),
            );
            entry.inlineValue =
              $(id).type === "number" ? Number(inlineValue) : inlineValue;
          }
          return [id, entry];
        }),
    ),
    inactiveControls: Object.keys(defaults).filter((id) => $(id).disabled),
    collapsed: { trial: [...collapsed.after], current: [...collapsed.before] },
    otherWorkstreams: {
      trial: showLower.after,
      current: showLower.before,
      trialExpanded: [...lowerExpanded.after],
      currentExpanded: [...lowerExpanded.before],
    },
    collapsedThreads: {
      trial: [...childCollapsed.after],
      current: [...childCollapsed.before],
    },
    collapsedParents: { trial: [...parentCollapsed.after] },
  };
  $("values").value = JSON.stringify(values, null, 2);
  syncUrl();
}
function propertyChanged(id) {
  if (id === "collapsedInlineFamilyGap") collapsedInlineGapInitialized = true;
  if (id === "categorizedSpacing") {
    for (const target of Object.keys(inheritedCategorySpacing)) {
      linkExceptions.delete(target);
      linkMemory.add(target);
    }
  }
  if (
    id === "collapsedInlineBoundaryMode" &&
    $(id).value === "separate" &&
    !collapsedInlineGapInitialized
  ) {
    $("collapsedInlineFamilyGap").value = valueOf("inlineFamilyGap");
    lastValid.collapsedInlineFamilyGap = $("collapsedInlineFamilyGap").value;
    collapsedInlineGapInitialized = true;
  }
  for (const [role, spec] of Object.entries(collapsedSpecs))
    if (
      id === role + "Mode" &&
      $(id).value === "separate" &&
      !collapsedInitialized[role]
    ) {
      for (const [target, source] of Object.entries(spec.spacing)) {
        $(target).value = layoutValue(source);
        lastValid[target] = $(target).value;
      }
      for (const field of fieldsFor({ id: role })) {
        const source = fontId({ id: spec.base }, field),
          target = fontId({ id: role }, field);
        $(target).value = $(source).value;
        lastValid[target] = $(target).value;
      }
      collapsedInitialized[role] = true;
    }
  if (
    id === "inlineWorkstreamStyle" &&
    $("inlineWorkstreamStyle").value === "separate" &&
    !inlineWorkstreamInitialized
  ) {
    for (const field of fieldsFor({ id: "workstream" })) {
      const source = fontId({ id: "workstream" }, field),
        target = fontId({ id: "inlineWorkstream" }, field);
      $(target).value = $(source).value;
      lastValid[target] = $(target).value;
    }
    inlineWorkstreamInitialized = true;
  }
  if (id === "focus" && $("focus").value === "off") {
    for (const panel of ["before", "after"]) {
      showLower[panel] = false;
      lowerExpanded[panel].clear();
    }
    for (const key of parentCollapsed.after)
      if (key.includes(":other:")) parentCollapsed.after.delete(key);
  }
}
for (const id of Object.keys(defaults)) {
  const input = $(id);
  input.addEventListener("input", () => {
    if (input.type === "number" && !validNumber(input)) {
      input.setAttribute("aria-invalid", "true");
      return;
    }
    input.removeAttribute("aria-invalid");
    lastValid[id] = input.value;
    propertyChanged(id);
    render();
  });
  input.addEventListener("blur", () => {
    if (input.type === "number" && !validNumber(input)) {
      input.value = lastValid[id];
      input.removeAttribute("aria-invalid");
      render();
    }
  });
}
for (const button of document.querySelectorAll("[data-preset]"))
  button.addEventListener("click", () => {
    for (const [id, value] of Object.entries(
      presetValues(presets[button.dataset.preset]),
    )) {
      if (propertySources[id] && isLinked(id)) continue;
      $(id).value = String(value);
      $(id).removeAttribute("aria-invalid");
      lastValid[id] = $(id).value;
    }
    render();
  });
$("showBounds").addEventListener("click", () => {
  showBounds = !showBounds;
  render();
});
for (const t of ["dark", "light"])
  $(t).addEventListener("click", () => {
    theme = t;
    render();
  });
$("resetTheme").addEventListener("click", () => {
  theme = "dark";
  render();
});
$("reset").addEventListener("click", () => {
  for (const [id, value] of Object.entries(defaults)) {
    $(id).value = value;
    $(id).removeAttribute("aria-invalid");
    lastValid[id] = $(id).value;
  }
  theme = "dark";
  legacyPresentation = false;
  $("previewAction").hidden = true;
  $("previewAction").textContent = "";
  showBounds = false;
  previewMode = "both";
  previewWidth = null;
  linkExceptions.clear();
  for (const id of defaultLinkExceptions) linkExceptions.add(id);
  linkMemory.clear();
  for (const panel of ["before", "after"]) {
    collapsed[panel].clear();
    lowerExpanded[panel].clear();
    childCollapsed[panel].clear();
    showLower[panel] = false;
  }
  parentCollapsed.after.clear();
  inlineWorkstreamInitialized = false;
  collapsedInlineGapInitialized =
    defaults.collapsedInlineBoundaryMode === "separate";
  for (const role of Object.keys(collapsedSpecs))
    collapsedInitialized[role] = false;
  render();
});
window.addEventListener("hashchange", () => {
  restoreUrl();
  render();
});
restoreUrl();
render();
