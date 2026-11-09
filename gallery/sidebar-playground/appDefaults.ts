import { SIDEBAR_GEOMETRY as geometry } from "../../src/app/sidebar/tokens.ts";
import { rowGeometry } from "../../src/app/sidebar/rowGeometry.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { clearComponents, mountThread } from "./components.tsx";

/* The playground's row controls use the same geometry and typography as the
 * sidebar. Experimental controls without a production counterpart keep their
 * own defaults. */
function categoryMix(): number {
  const search = (rules: CSSRuleList): number | undefined => {
    for (const rule of rules) {
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText === ".ws-category-label"
      ) {
        const match = rule.cssText.match(/\)\s+(\d+(?:\.\d+)?)%/);
        if (match) return Number(match[1]);
      }
      if ("cssRules" in rule) {
        const nested = search((rule as CSSGroupingRule).cssRules);
        if (nested !== undefined) return nested;
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      const value = search(sheet.cssRules);
      if (value !== undefined) return value;
    } catch {
      // A cross-origin stylesheet does not expose its rules.
    }
  }
  throw new Error("The sidebar category color rule is unavailable");
}

export function appSidebarDefaults(): Record<string, string> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none";
  host.dataset.bbPlugin = "workstreams";
  host.innerHTML = `<div class="ws-text-section">Workstreams</div>
    <div class="ws-text-workstream"><span class="ws-text-prefix">Prefix</span><span class="ws-text-inline-workstream">Name</span></div>
    <div class="ws-text-category">Category</div>
    <div data-sample="root"></div><div data-sample="child"></div>`;
  document.body.append(host);
  try {
    mountThread("app-defaults", host.querySelector('[data-sample="root"]')!, {
      title: "Thread",
      kind: "none",
      depth: 0,
      categorized: false,
    });
    mountThread("app-defaults", host.querySelector('[data-sample="child"]')!, {
      title: "Child",
      kind: "none",
      depth: 1,
      categorized: false,
    });
    const style = (selector: string) =>
      getComputedStyle(host.querySelector(selector)!);
    const typography = (role: string, selector: string) => {
      const text = style(selector);
      const size = parseFloat(text.fontSize);
      const line = parseFloat(text.lineHeight);
      return {
        [`font_${role}_size`]: String(size),
        [`font_${role}_weight`]: text.fontWeight,
        [`font_${role}_line`]: String(Number(((line / size) * 100).toFixed(1))),
        [`font_${role}_spacing`]: String(parseFloat(text.letterSpacing) || 0),
        [`font_${role}_transform`]: text.textTransform,
      };
    };
    const root = rowGeometry({ depth: 0, inGroup: true }).paddingLeft;
    const categorized = geometry.category.indent;
    const child = rowGeometry({ depth: 1, inGroup: true }).paddingLeft - root;
    const childCategorized =
      rowGeometry({ depth: 1, inGroup: true, categorized: true }).paddingLeft -
      rowGeometry({ depth: 0, inGroup: true, categorized: true }).paddingLeft;
    const statusWidth = parseFloat(style(".ws-status-slot").width);
    const statusGap = parseFloat(style(".ws-row").columnGap);
    const sort = parsePrefs({}).sidebar.groupSort;
    const {
      container,
      sectionHeading,
      workstreamHeader,
      row,
      category,
      gaps,
      lowerToggle,
    } = geometry;
    return Object.fromEntries(
      Object.entries({
        grouping: "prefix",
        sort: sort === "alphabetical" ? "name" : sort,
        disclosureWorkstream: "hover",
        disclosureThread: "current",
        disclosureCategoryThread: "current",
        disclosureThreadPlacement: "left",
        disclosureCategoryThreadPlacement: "left",
        workstreamChevronPlacement: "hanging",
        inlineWorkstreamStyle: "inherit",
        rowHeight: row.rootHeight,
        catRowHeight: row.rootHeight,
        childRowHeight: row.childHeight,
        catChildRowHeight: row.childHeight,
        headerHeight: workstreamHeader.height,
        topWorkstreamIndent: workstreamHeader.indent,
        // The playground still offers a chevron hanging beside the name, so
        // its slot and gap are the playground's own; the sidebar keeps its
        // chevron inline, after the name.
        chevronWidth: 8,
        headerGap: 6,
        rowInset: root,
        rowInsetReference: "content",
        categoryIndent: category.indent,
        categoryIndentReference: "content",
        categoryRowIndent: categorized - category.indent,
        categoryRowIndentReference: "relative",
        childIndent: child,
        categoryChildIndent: childCategorized,
        childIndentReference: "relative",
        categoryChildIndentReference: "relative",
        statusWidth,
        catStatusWidth: statusWidth,
        childStatusWidth: statusWidth,
        catChildStatusWidth: statusWidth,
        statusGap,
        catStatusGap: statusGap,
        childStatusGap: statusGap,
        catChildStatusGap: statusGap,
        sideX: container.paddingX,
        sideY: container.paddingBottom,
        sectionHeight: sectionHeading.height,
        sectionTop: sectionHeading.topMargin,
        sectionGap: sectionHeading.bottomMargin,
        sectionInset: sectionHeading.leftInset,
        sectionInsetReference: "relative",
        categoryHeight: category.height,
        catGap: category.firstTopGap,
        categoryBetween: category.betweenGap - category.firstTopGap,
        catAfter: category.afterGap,
        font_prefix_color: "default",
        font_category_color: "default",
        mix: categoryMix(),
        itemGap: gaps.item,
        inlineFamilyGap: gaps.inlineBoundary - gaps.item,
        collapsedWorkstreamGap: gaps.sameParentCollapsed,
        collapsedInlineBoundaryMode: "separate",
        collapsedInlineFamilyGap:
          gaps.collapsedInlineBoundary - gaps.sameParentCollapsed,
        collapsedWorkstreamHeight: workstreamHeader.height,
        collapsedThreadHeight: row.rootHeight,
        collapsedCatThreadHeight: row.rootHeight,
        tierLabelHeight: lowerToggle.height,
        tierLabelTop: lowerToggle.topMargin,
        tierLabelBottom: lowerToggle.bottomMargin,
        tierLabelInset: lowerToggle.inset,
        ...typography("section", ".ws-text-section"),
        ...typography("workstream", ".ws-text-workstream"),
        ...typography("prefix", ".ws-text-prefix"),
        ...typography("inlineWorkstream", ".ws-text-inline-workstream"),
        ...typography("category", ".ws-text-category"),
        ...typography("thread", '[data-sample="root"] .ws-text-thread'),
        ...typography("catThread", '[data-sample="root"] .ws-text-thread'),
        ...typography("childThread", '[data-sample="child"] .ws-text-thread'),
        ...typography(
          "catChildThread",
          '[data-sample="child"] .ws-text-thread',
        ),
      }).map(([key, value]) => [key, String(value)]),
    );
  } finally {
    clearComponents("app-defaults");
    host.remove();
  }
}
