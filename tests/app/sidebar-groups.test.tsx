// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workstreamHue } from "../../src/domain/workstreamHue.ts";
import { section, sidebarThread } from "./fixtures.ts";
import { groupRows, mount } from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("nested workstreams", () => {
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
    groups: {
      sec_alerts: "alerts",
      sec_cli: "cli",
    },
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
  const nestedSections = [
    section("sec_alerts", "Beacon: Automations: Alert Investigations"),
    section("sec_cli", "Beacon: Automations: CLI"),
  ];
  // Each subgroup shows enough threads for its own header (`GROUP_MIN`).
  const nestedThreads = () => [
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
  const options = {
    activeThreadId: null,
    sections: nestedSections,
    catalog,
    settings: { showRecent: false, showForYou: false },
  };

  it("draws a topic's workstreams as subgroups of its group", async () => {
    const slot = await mount(nestedThreads(), options);
    // The catalog arrives after the first frame, which draws flat groups.
    const top = () => slot.getByRole("region", { name: "Beacon: Automations" });
    const alerts = () =>
      within(top()).getByRole("region", {
        name: "Beacon: Automations: Alert Investigations",
      });
    await waitFor(() => alerts());
    // One top-level group holds both subgroups.
    expect(
      slot
        .getAllByRole("region")
        .filter((region) => !region.parentElement?.closest("section"))
        .map((region) => region.getAttribute("aria-label")),
    ).toEqual(["Beacon: Automations"]);
    expect(within(alerts()).getByText("Alert Investigations")).toBeTruthy();
    expect(groupRows(slot, "Beacon: Automations")).toEqual([
      "Rebase alerts PR",
      "Triage alert noise",
      "Verify alerts in staging",
      "Design CLI commands",
      "Write CLI docs",
      "Add CLI flags",
    ]);
    // Collapsing a subgroup leaves its parent's other threads showing.
    fireEvent.click(
      within(alerts()).getByRole("button", { name: "Alert Investigations" }),
    );
    await waitFor(() =>
      expect(groupRows(slot, "Beacon: Automations")).toEqual([
        "Design CLI commands",
        "Write CLI docs",
        "Add CLI flags",
      ]),
    );
    slot.lifecycle.unmount();
  });

  it.each([false, true])(
    "uses the leaf workstream's hue for categories when inline is %s",
    async (inline) => {
      const threads = inline
        ? nestedThreads().filter((thread) => thread.id !== "flags")
        : nestedThreads();
      const slot = await mount(threads, {
        ...options,
        catalog: {
          ...catalog,
          categories: {
            alerts: {
              id: "generation",
              categories: [
                { id: "empty", name: "Empty", threadIds: ["absent"] },
                {
                  id: "triage",
                  name: "Triage",
                  threadIds: ["rebase", "verify", "triage"],
                },
              ],
            },
          },
        },
      });
      const heading = await slot.findByRole("heading", {
        name: inline ? "Alert Investigations · Triage" : "Triage",
      });
      expect(heading.children).toHaveLength(0);
      expect(Number(heading.style.getPropertyValue("--ws-hue"))).toBe(
        workstreamHue("sec_alerts"),
      );
      const row = slot
        .getByRole("link", { name: "Rebase alerts PR" })
        .closest(".ws-row")!;
      expect(
        row.closest("li")!.parentElement!.closest("li")?.className,
      ).toContain("pl-3");
      if (!inline) {
        const subgroup = slot.getByRole("region", {
          name: "Beacon: Automations: Alert Investigations",
        });
        expect(subgroup.querySelector(".ws-workstream-name")?.textContent).toBe(
          "Alert Investigations",
        );
      }
      slot.lifecycle.unmount();
    },
  );

  it("flattens subgroup headers when the parent also holds threads", async () => {
    const slot = await mount(
      [
        sidebarThread("mvp", { sectionId: "sec_auto", title: "Design MVP" }),
        ...nestedThreads(),
      ],
      {
        ...options,
        sections: [
          section("sec_auto", "Beacon: Automations"),
          ...nestedSections,
        ],
        catalog: {
          ...catalog,
          groups: { ...catalog.groups, sec_auto: "auto" },
          layout: [{ ...catalog.layout[0]!, lists: true, total: 7 }],
        },
      },
    );
    await waitFor(() =>
      expect(groupRows(slot, "Beacon: Automations")).toHaveLength(7),
    );
    expect(
      within(
        slot.getByRole("region", { name: "Beacon: Automations" }),
      ).queryAllByRole("region"),
    ).toEqual([]);
    expect(
      within(
        slot.getByRole("region", { name: "Beacon: Automations" }),
      ).getByRole("link", { name: "Design MVP" }),
    ).toBeTruthy();
    for (const name of [
      "Design CLI commands",
      "Add CLI flags",
      "Write CLI docs",
    ]) {
      const row = within(
        slot.getByRole("region", { name: "Beacon: Automations" }),
      )
        .getByRole("link", { name })
        .closest("li")!;
      fireEvent.click(
        within(row).getByRole("button", { name: /^Snooze until/ }),
      );
    }
    await waitFor(() =>
      expect(groupRows(slot, "Beacon: Automations")).toHaveLength(4),
    );
    const top = slot.getByRole("region", { name: "Beacon: Automations" });
    expect(within(top).queryAllByRole("region")).toEqual([]);
    expect(within(top).queryByText("CLI")).toBeNull();
    fireEvent.contextMenu(top.querySelector(".group\\/row")!);
    await screen.findByRole("menuitem", { name: "New work" });
    expect(
      screen.queryByRole("menuitem", {
        name: "New work in Beacon: Automations: CLI",
      }),
    ).toBeNull();
    slot.lifecycle.unmount();
  });

  it("snoozes a top-level group with its subgroups, and a subgroup alone", async () => {
    const slot = await mount(nestedThreads(), options);
    const top = () => slot.getByRole("region", { name: "Beacon: Automations" });
    await waitFor(() =>
      within(top()).getByRole("region", { name: "Beacon: Automations: CLI" }),
    );
    fireEvent.click(
      within(top()).getByRole("button", {
        name: /^Snooze 3 threads in Beacon: Automations: CLI until/,
      }),
    );
    await waitFor(() =>
      expect(
        slot.queryByRole("region", { name: "Beacon: Automations: CLI" }),
      ).toBeNull(),
    );
    expect(
      within(top()).queryByRole("button", {
        name: "New work in Beacon: Automations: CLI",
      }),
    ).toBeNull();
    fireEvent.click(
      within(top()).getByRole("button", {
        name: /^Snooze 3 threads in Beacon: Automations until/,
      }),
    );
    await waitFor(() =>
      expect(
        slot.queryByRole("region", { name: "Beacon: Automations" }),
      ).toBeNull(),
    );
    expect(
      slot.inspection.rpcCalls
        .filter((call) => call.method === "snooze")
        .map((call) => [...(call.input as { threadIds: string[] }).threadIds]),
    ).toEqual([
      ["commands", "docs", "flags"],
      ["rebase", "triage", "verify"],
    ]);
    slot.lifecycle.unmount();
  });

  it("removes an archived subgroup and its parent without waiting for the grace period", async () => {
    const threads = nestedThreads();
    const slot = await mount(threads, options);
    await slot.findByRole("region", { name: "Beacon: Automations" });
    await waitFor(() =>
      slot.getByRole("region", { name: "Beacon: Automations: CLI" }),
    );
    for (let i = 0; i < threads.length; i++) {
      if (threads[i]!.sectionId === "sec_cli")
        threads[i] = { ...threads[i]!, isArchived: true };
    }
    slot.selectThread("rebase");
    await waitFor(() =>
      expect(
        slot.queryByRole("region", { name: "Beacon: Automations: CLI" }),
      ).toBeNull(),
    );
    expect(groupRows(slot, "Beacon: Automations")).toHaveLength(3);
    for (let i = 0; i < threads.length; i++)
      threads[i] = { ...threads[i]!, isArchived: true };
    slot.selectThread("rebase");
    await waitFor(() =>
      expect(
        slot.queryByRole("region", { name: "Beacon: Automations" }),
      ).toBeNull(),
    );
    slot.lifecycle.unmount();
  });

  it("focuses a top-level group with all its subgroups", async () => {
    const slot = await mount(nestedThreads(), options);
    await waitFor(() =>
      within(
        slot.getByRole("region", { name: "Beacon: Automations" }),
      ).getByRole("region", { name: "Beacon: Automations: CLI" }),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Focus on Beacon: Automations" }),
    );
    await waitFor(() =>
      expect(
        slot.getByRole("button", {
          name: "Stop focusing on Beacon: Automations",
        }),
      ).toBeTruthy(),
    );
    expect(
      slot.queryByRole("button", {
        name: "Focus on Beacon: Automations: CLI",
      }),
    ).toBeNull();
    slot.lifecycle.unmount();
  });
});

describe("small groups", () => {
  it.each([0, 3])(
    "keeps sibling headers together with %i review threads",
    async (reviewCount) => {
      const topic = (id: string, name: string, parentId: string | null) => ({
        id,
        name,
        description: "",
        parentId,
        aliases: [],
      });
      const node = (topicId: string, name: string, total: number) => ({
        topicId,
        name,
        prefix: [],
        lists: true,
        total,
        children: [],
      });
      const slot = await mount(
        [
          sidebarThread("a1", { sectionId: "sec_alerts", title: "Rebase PR" }),
          sidebarThread("a2", { sectionId: "sec_alerts", title: "Verify" }),
          sidebarThread("a3", { sectionId: "sec_alerts", title: "Triage" }),
          sidebarThread("c1", { sectionId: "sec_cli", title: "Add flags" }),
          ...Array.from({ length: reviewCount }, (_, i) =>
            sidebarThread(`r${i}`, {
              sectionId: "sec_review",
              title: `Review ${i}`,
            }),
          ),
        ],
        {
          sections: [
            section("sec_alerts", "Automations: Alert Investigations"),
            section("sec_cli", "Automations: CLI"),
            ...(reviewCount
              ? [section("sec_review", "Automations: Review")]
              : []),
          ],
          catalog: {
            entities: [
              topic("auto", "Automations", null),
              topic("alerts", "Alert Investigations", "auto"),
              topic("cli", "CLI", "auto"),
              topic("review", "Review", "auto"),
            ],
            groups: {
              sec_alerts: "alerts",
              sec_cli: "cli",
              sec_review: "review",
            },
            layout: [
              {
                ...node("auto", "Automations", 4 + reviewCount),
                lists: false,
                children: [
                  node("alerts", "Alert Investigations", 3),
                  node("cli", "CLI", 1),
                  ...(reviewCount
                    ? [node("review", "Review", reviewCount)]
                    : []),
                ],
              },
            ],
          },
          settings: { showRecent: false, showForYou: false },
        },
      );
      const top = () => slot.getByRole("region", { name: "Automations" });
      await waitFor(() =>
        expect(groupRows(slot, "Automations")).toEqual([
          "Rebase PR",
          "Verify",
          "Triage",
          "Add flags",
          ...Array.from({ length: reviewCount }, (_, i) => `Review ${i}`),
        ]),
      );
      expect(
        within(top())
          .queryAllByRole("region")
          .map((r) => r.getAttribute("aria-label")),
      ).toEqual(
        reviewCount
          ? [
              "Automations: Alert Investigations",
              "Automations: CLI",
              "Automations: Review",
            ]
          : [],
      );
      const row = within(top())
        .getByRole("link", { name: "Add flags" })
        .closest("li")!;
      if (reviewCount) {
        expect(row.closest("section")).toBe(
          slot.getByRole("region", { name: "Automations: CLI" }),
        );
        expect(within(row).queryByText("CLI")).toBeNull();
      } else {
        expect(row.closest("section")).toBe(top());
        expect(within(row).getByText("CLI")).toBeTruthy();
        expect(row.querySelector("[data-timestamp]")?.textContent).toBe("now");
      }
      slot.lifecycle.unmount();
    },
  );

  it("renders categories as row headings within the same workstream and keeps delegates with their roots", async () => {
    const threads = Array.from({ length: 7 }, (_, i) =>
      sidebarThread(`t${i}`, { title: `Task ${i}`, sectionId: "sec_vertex" }),
    );
    threads.push(
      sidebarThread("delegate", {
        title: "Delegated task",
        parentThreadId: "t0",
        sectionId: "sec_vertex",
      }),
    );
    const slot = await mount(threads, {
      sections: [section("sec_vertex", "Vertex")],
      settings: { showRecent: false, showForYou: false },
      catalog: {
        entities: [
          {
            id: "vertex",
            name: "Vertex",
            description: "Product",
            parentId: null,
            aliases: [],
          },
        ],
        groups: { sec_vertex: "vertex" },
        categories: {
          vertex: {
            id: "generation",
            categories: [
              { id: "billing", name: "Billing", threadIds: ["t0", "t1", "t2"] },
              {
                id: "access",
                name: "Access Control",
                threadIds: ["t3", "t4", "t5"],
              },
            ],
          },
        },
      },
    });
    await slot.findByRole("heading", { name: "Billing" });
    expect(slot.getByRole("heading", { name: "Access Control" })).toBeTruthy();
    expect(slot.queryByRole("region", { name: "Billing" })).toBeNull();
    const group = slot.getByRole("region", { name: "Vertex" });
    expect(
      within(group).getByRole("link", { name: "Delegated task" }),
    ).toBeTruthy();
    expect(within(group).getByRole("link", { name: "Task 6" })).toBeTruthy();
    expect(within(group).getAllByRole("link")).toHaveLength(8);
    const root = within(group)
      .getByRole("link", { name: "Task 0" })
      .closest(".ws-row") as HTMLElement;
    const delegate = within(group)
      .getByRole("link", { name: "Delegated task" })
      .closest(".ws-row") as HTMLElement;
    const arrival = within(group)
      .getByRole("link", { name: "Task 6" })
      .closest(".ws-row") as HTMLElement;
    const tree = (row: HTMLElement) =>
      row.closest("li")!.parentElement!.closest("li")!;
    expect(tree(root).className).toContain("pl-3");
    expect(tree(delegate)).toBe(tree(root));
    expect(tree(arrival).className).not.toContain("pl-3");
    expect(
      parseFloat(delegate.style.paddingLeft) -
        parseFloat(root.style.paddingLeft),
    ).toBe(20);
    slot.lifecycle.unmount();
  });

  it("colors the workstream name and category labels without pills or markers", async () => {
    const threads = Array.from({ length: 6 }, (_, i) =>
      sidebarThread(`t${i}`, { title: `Task ${i}`, sectionId: "sec_ws" }),
    );
    const slot = await mount(threads, {
      sections: [section("sec_ws", "bb: Workstreams Plugin")],
      settings: { showRecent: false, showForYou: false },
      catalog: {
        entities: [
          {
            id: "ws",
            name: "bb",
            description: "Product",
            parentId: null,
            aliases: [],
          },
        ],
        groups: { sec_ws: "ws" },
        categories: {
          ws: {
            id: "generation",
            categories: [
              {
                id: "replies",
                name: "Reply Block",
                threadIds: ["t0", "t1", "t2"],
              },
              { id: "sidebar", name: "Sidebar", threadIds: ["t3", "t4", "t5"] },
            ],
          },
        },
      },
    });
    await slot.findByRole("heading", { name: "Reply Block" });
    const group = slot.getByRole("region", { name: "bb: Workstreams Plugin" });
    const header = within(group).getByRole("button", {
      name: "bb: Workstreams Plugin",
    });
    expect(header.querySelector(".ws-workstream-name")?.textContent).toBe(
      "Workstreams Plugin",
    );
    expect(
      header.querySelector(".text-muted-foreground\\/60")?.textContent,
    ).toBe("bb");
    expect(
      Number((group as HTMLElement).style.getPropertyValue("--ws-hue")),
    ).toBe(workstreamHue("sec_ws"));
    expect(group.querySelector(".ws-workstream-tile")).toBeNull();
    expect(
      [...group.querySelectorAll(".ws-category-label")].every(
        (heading) => heading.children.length === 0,
      ),
    ).toBe(true);
    expect(group.querySelector(".ws-category-label")?.textContent).toBe(
      "Reply Block",
    );
    slot.lifecycle.unmount();
  });

  it("colors a one-level workstream's name", async () => {
    const slot = await mount(
      [sidebarThread("v1", { sectionId: "sec_vertex", title: "Vertex task" })],
      {
        sections: [section("sec_vertex", "Vertex")],
        settings: { showRecent: false, showForYou: false },
      },
    );
    const group = await slot.findByRole("region", { name: "Vertex" });
    expect(group.querySelector(".ws-workstream-name")?.textContent).toBe(
      "Vertex",
    );
    expect(group.querySelector(".ws-workstream-tile")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("keeps small top-level workstreams under their own headers", async () => {
    const slot = await mount(
      [
        sidebarThread("b1", { sectionId: "sec_big", title: "Big one" }),
        sidebarThread("b2", { sectionId: "sec_big", title: "Big two" }),
        sidebarThread("b3", { sectionId: "sec_big", title: "Big three" }),
        sidebarThread("x1", { sectionId: "sec_x", title: "X task" }),
        sidebarThread("y1", { sectionId: "sec_y", title: "Y task" }),
        sidebarThread("z1", { sectionId: "sec_z", title: "Z task" }),
      ],
      {
        sections: [
          section("sec_big", "Big"),
          section("sec_x", "Xylophone"),
          section("sec_y", "Yak"),
          section("sec_z", "Zebra"),
        ],
        settings: { showRecent: false, showForYou: false },
      },
    );
    await waitFor(() => expect(groupRows(slot, "Yak")).toEqual(["Y task"]));
    expect(
      slot
        .getAllByRole("region")
        .filter((region) => !region.parentElement?.closest("section"))
        .map((region) => region.getAttribute("aria-label")),
    ).toEqual(["Big", "Xylophone", "Yak", "Zebra"]);
    expect(slot.queryByRole("region", { name: "Other" })).toBeNull();
    expect(groupRows(slot, "Xylophone")).toEqual(["X task"]);
    expect(groupRows(slot, "Zebra")).toEqual(["Z task"]);
    const row = within(slot.getByRole("region", { name: "Yak" }))
      .getByRole("link", { name: "Y task" })
      .closest("li")!;
    expect(within(row).queryByText("Yak")).toBeNull();
    expect(row.querySelector("[data-timestamp]")?.textContent).toBe("now");
    expect(slot.getByRole("button", { name: "Focus on Yak" })).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
