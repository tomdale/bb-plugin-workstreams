// @vitest-environment jsdom
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FoldBody,
  rowsPhase,
  useCloseOnFoldLeave,
  useFoldPhase,
} from "../../../src/app/sidebar/Fold.tsx";
import type {
  FoldState,
  PresencePhase,
} from "../../../src/app/sidebar/motion.ts";
import { section, sidebarThread } from "../fixtures.ts";
import { mount } from "../sidebar-fixture.tsx";

/** A fold drawn at `phase`, which is the whole state a body reads. */
const fold = (phase: PresencePhase): FoldState & { ref: () => void } => ({
  render: true,
  phase,
  open: phase !== "leave",
  ref: () => {},
});

/** Reports the phase the folds around a row publish. */
function PhaseProbe() {
  return <li data-testid="phase">{useFoldPhase()}</li>;
}

/** A row whose menu reports whether it is open. */
function MenuProbe() {
  const [open, setOpen] = useState(true);
  useCloseOnFoldLeave(open, () => setOpen(false));
  return <li>{open ? "menu open" : "menu closed"}</li>;
}

const probe = () => screen.getByTestId("phase").textContent;

describe("rowsPhase", () => {
  it("keeps the fold's own phase while no fold around it is leaving", () => {
    expect(rowsPhase("idle", "idle")).toBe("idle");
    expect(rowsPhase("enter", "idle")).toBe("enter");
    expect(rowsPhase("leave", "idle")).toBe("leave");
  });

  it("turns leaving once any fold around the row is leaving", () => {
    expect(rowsPhase("idle", "leave")).toBe("leave");
    expect(rowsPhase("enter", "leave")).toBe("leave");
    expect(rowsPhase("leave", "enter")).toBe("leave");
  });
});

describe("a nested fold's rows", () => {
  it("see the phase of a fold they sit in, not only their own", () => {
    const tree = (outer: PresencePhase) => (
      <FoldBody fold={fold(outer)}>
        <li>
          <FoldBody fold={fold("idle")}>
            <PhaseProbe />
          </FoldBody>
        </li>
      </FoldBody>
    );
    const { rerender } = render(tree("idle"));
    expect(probe()).toBe("idle");
    // The inner fold stays open as its ancestor closes, so its rows are only
    // told about the ancestor through the phase they inherit.
    rerender(tree("leave"));
    expect(probe()).toBe("leave");
  });

  it("close their menu when an enclosing fold starts leaving", () => {
    const tree = (outer: PresencePhase, inner: PresencePhase) => (
      <FoldBody fold={fold(outer)}>
        <li>
          <FoldBody fold={fold(inner)}>
            <MenuProbe />
          </FoldBody>
        </li>
      </FoldBody>
    );
    const { rerender } = render(tree("idle", "enter"));
    expect(screen.getByText("menu open")).toBeTruthy();
    // A fold settling around the row is not closing it: the menu stays open.
    rerender(tree("idle", "idle"));
    expect(screen.getByText("menu open")).toBeTruthy();
    rerender(tree("leave", "idle"));
    expect(screen.getByText("menu closed")).toBeTruthy();
  });
});

describe("a nested row's menu when its outer workstream closes", () => {
  const topic = (id: string, name: string, parentId: string | null) => ({
    id,
    name,
    description: "",
    parentId,
    aliases: [],
  });
  const catalog = {
    entities: [
      topic("va", "Beacon", null),
      topic("auto", "Automations", "va"),
      topic("alerts", "Alert Investigations", "auto"),
      topic("cli", "CLI", "auto"),
    ],
    groups: { sec_alerts: "alerts", sec_cli: "cli" },
    layout: [
      {
        topicId: "auto",
        name: "Automations",
        prefix: ["Beacon"],
        lists: false,
        total: 6,
        children: [
          {
            topicId: "alerts",
            name: "Alert Investigations",
            prefix: [],
            lists: true,
            total: 3,
            children: [],
          },
          {
            topicId: "cli",
            name: "CLI",
            prefix: [],
            lists: true,
            total: 3,
            children: [],
          },
        ],
      },
    ],
  };
  // Each subgroup shows enough threads for its own header (`GROUP_MIN`).
  const threads = () => [
    sidebarThread("rebase", {
      sectionId: "sec_alerts",
      title: "Rebase alerts PR",
    }),
    sidebarThread("verify", {
      sectionId: "sec_alerts",
      title: "Verify alerts in staging",
    }),
    sidebarThread("triage", {
      sectionId: "sec_alerts",
      title: "Triage alert noise",
    }),
    sidebarThread("commands", {
      sectionId: "sec_cli",
      title: "Design CLI commands",
    }),
    sidebarThread("flags", { sectionId: "sec_cli", title: "Add CLI flags" }),
    sidebarThread("docs", { sectionId: "sec_cli", title: "Write CLI docs" }),
  ];

  beforeEach(() => {
    window.localStorage.clear();
    // `canAnimate` asks only whether Web Animations exist; the fold ends its
    // phases on timers, so a stub is enough to turn motion on.
    Element.prototype.animate ??= () => ({}) as Animation;
  });
  afterEach(cleanup);

  it("closes while the outer group is still closing", async () => {
    const slot = await mount(threads(), {
      activeThreadId: null,
      sections: [
        section("sec_alerts", "Beacon: Automations: Alert Investigations"),
        section("sec_cli", "Beacon: Automations: CLI"),
      ],
      catalog,
      settings: { showRecent: false, showForYou: false },
    });
    const outer = await waitFor(() =>
      slot.getByRole("region", { name: "Beacon: Automations" }),
    );
    const alerts = await waitFor(() =>
      within(outer).getByRole("region", {
        name: "Beacon: Automations: Alert Investigations",
      }),
    );
    // Taken before the menu opens: an open context menu hides the rest of the
    // page from the accessibility tree, so roles no longer find the sidebar.
    const collapse = within(outer).getByRole("button", {
      name: "Collapse Beacon: Automations",
    });
    fireEvent.contextMenu(
      within(alerts)
        .getByRole("link", { name: "Rebase alerts PR" })
        .closest("li")!,
    );
    await screen.findByRole("menu", {}, { timeout: 2000 });

    fireEvent.click(collapse);

    // The outer group's contents are still mounted, inert, while it closes,
    // and the subgroup inside them never changed phase itself.
    expect(outer.querySelector(".ws-fold")?.getAttribute("data-presence")).toBe(
      "leave",
    );
    expect(
      alerts.querySelector(".ws-fold")?.getAttribute("data-presence"),
    ).toBeNull();
    // Its rows left with the group above them, so the menu they opened is
    // gone rather than left floating over the closing contents.
    expect(screen.queryByRole("menu")).toBeNull();
    slot.lifecycle.unmount();
  });
});
