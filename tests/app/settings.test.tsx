// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ColorSettings } from "../../src/app/settings/ColorSettings.tsx";
import {
  AdvancedSettings,
  NewWorkSettings,
  OrganizeSettings,
  SidebarSettings,
  ThreadsSettings,
  WorkingIndicatorSettings,
} from "../../src/app/settings/FeatureSettings.tsx";
import { ColorTokenStyle } from "../../src/app/theme/ColorTokenStyle.tsx";
import { mergePrefs, parsePrefs } from "../../src/domain/prefs.ts";

/** What the debug UI shows, each with its own switch. */
const SURFACES = [
  "Inspect buttons",
  "Activity model calls",
  "Composer routing diagnostics",
  "Reply diagnostics",
  "Thread Info and context card",
];

afterEach(cleanup);

async function mount(
  sectionId: string,
  options: {
    machines?: { id: string; name: string }[];
    setPrefs?: (
      input: unknown,
    ) => { prefs: unknown } | Promise<{ prefs: unknown }>;
  } = {},
) {
  let prefs = parsePrefs({});
  const components = {
    sidebar: SidebarSettings,
    "working-indicator": WorkingIndicatorSettings,
    colors: ColorSettings,
    threads: ThreadsSettings,
    "new-work": NewWorkSettings,
    organize: OrganizeSettings,
    advanced: AdvancedSettings,
  };
  const section = {
    component: components[sectionId as keyof typeof components],
  };
  const slot = await renderSlot(
    section,
    {},
    {
      settings: { debug: true },
      rpc: {
        prefs: () => ({ prefs }),
        setPrefs: (input: unknown) => {
          if (options.setPrefs) return options.setPrefs(input);
          prefs = mergePrefs(
            prefs,
            (input as { patch: Parameters<typeof mergePrefs>[1] }).patch,
          );
          return { prefs };
        },
        machines: () => ({ machines: options.machines ?? [] }),
        spinner: () => ({
          spinner: { shape: "spokes", primary: "subtle", secondary: "auto" },
        }),
        setSpinner: (input: unknown) => input as { spinner: unknown },
      },
    },
  );
  return slot;
}

it("renders compact working styles and accessible colored swatches", async () => {
  const slot = await mount("working-indicator");
  const styles = await slot.findByRole("radiogroup", {
    name: "Working indicator style",
  });
  expect(styles.querySelectorAll("input[type=radio]")).toHaveLength(7);
  expect(
    slot.getByText("How a working thread is marked in the sidebar."),
  ).toBeTruthy();
  for (const color of ["Green", "Blue"]) {
    const swatch = slot.getByRole("radio", { name: color });
    expect(swatch.parentElement?.getAttribute("title")).toBe(color);
  }
  expect(
    styles.parentElement?.querySelector('input[type="color"]'),
  ).toBeTruthy();
});

it("renders four compact sidebar toggles and saves their preferences", async () => {
  const slot = await mount("sidebar");
  for (const label of ["Up Next", "Recent", "Snoozed", "Archived"]) {
    expect(await slot.findByRole("switch", { name: label })).toBeTruthy();
  }
  const sections = slot.getByRole("region", { name: "Sections" });
  for (const label of ["Timestamp", "Thread count", "Waiting count"])
    expect(
      within(sections).queryByRole("radiogroup", { name: label }),
    ).toBeNull();
  fireEvent.click(slot.getByRole("switch", { name: "Snoozed" }));
  fireEvent.click(slot.getByRole("switch", { name: "Archived" }));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(2),
  );
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => call.input),
  ).toEqual([
    { patch: { sidebar: { showSnoozed: false } } },
    { patch: { sidebar: { showArchived: false } } },
  ]);
});

it("saves the phone Home screen preference from its own group", async () => {
  const slot = await mount("sidebar");
  const group = await slot.findByRole("region", { name: "Home screen" });
  const toggle = within(group).getByRole("switch", {
    name: "Up Next and workstreams on phones",
  });
  // Home replaces BB's Recent list unless the user turns it off.
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(1),
  );
  expect(
    slot.inspection.rpcCalls.find((call) => call.method === "setPrefs")?.input,
  ).toEqual({ patch: { sidebar: { phoneHome: false } } });
});

it.each([
  [
    "Timestamp",
    "timestamps",
    [
      ["On hover", "hover"],
      ["Never", "hide"],
      ["Always", "show"],
    ],
  ],
  [
    "Thread count",
    "threadCount",
    [
      ["Always", "always"],
      ["Never", "never"],
      ["When collapsed", "collapsed"],
    ],
  ],
  [
    "Waiting count",
    "waitingCount",
    [
      ["Always", "always"],
      ["Never", "never"],
      ["When collapsed", "collapsed"],
    ],
  ],
] as const)(
  "saves %s from a segmented control in Details",
  async (label, key, choices) => {
    const slot = await mount("sidebar");
    const details = await slot.findByRole("region", { name: "Details" });
    const group = within(details).getByRole("radiogroup", { name: label });
    // Hidden radios stay inside positioned labels (see `SegmentedControl`).
    for (const radio of within(group).getAllByRole("radio"))
      expect(radio.closest("label")?.className).toMatch(/(^|\s)relative(\s|$)/);
    expect(within(details).queryByRole("switch")).toBeNull();
    expect(slot.queryByRole("searchbox")).toBeNull();
    expect(slot.queryByPlaceholderText(/search/i)).toBeNull();
    for (const [option, value] of choices) {
      fireEvent.click(within(group).getByRole("radio", { name: option }));
      await waitFor(() =>
        expect(
          (
            within(group).getByRole("radio", {
              name: option,
            }) as HTMLInputElement
          ).checked,
        ).toBe(true),
      );
      expect(
        slot.inspection.rpcCalls
          .filter((call) => call.method === "setPrefs")
          .at(-1)?.input,
      ).toEqual({ patch: { sidebar: { [key]: value } } });
    }
  },
);

it("clamps the Recent stepper to 1–20 and hides it when Recent is off", async () => {
  const slot = await mount("sidebar");
  const recent = await slot.findByRole("switch", { name: "Recent" });
  const plus = slot.getByRole("button", { name: "Increase threads shown" });
  for (let index = 0; index < 30; index++) fireEvent.click(plus);
  await waitFor(() =>
    expect(
      slot.getByLabelText("threads shown", { selector: "output" }).textContent,
    ).toBe("20"),
  );
  expect(
    slot
      .getByLabelText("threads shown", { selector: "output" })
      .getAttribute("aria-live"),
  ).toBe("polite");
  expect(plus).toHaveProperty("disabled", true);
  fireEvent.click(recent);
  await waitFor(() =>
    expect(
      slot.queryByRole("button", { name: "Increase threads shown" }),
    ).toBeNull(),
  );
  expect(
    slot.inspection.rpcCalls.some(
      (call) =>
        call.method === "setPrefs" &&
        JSON.stringify(call.input).includes('"showRecent":false'),
    ),
  ).toBe(true);
});

it("describes title locking accurately", async () => {
  const slot = await mount("threads");
  expect(
    await slot.findByText(
      "Title new threads promptly and update titles to follow their current substantive focus. Titles you edit outside Workstreams stay fixed until you clear them.",
    ),
  ).toBeTruthy();
});

it("chooses between fade and scroll title transitions", async () => {
  const slot = await mount("threads");
  const group = await slot.findByRole("radiogroup", {
    name: "Title transition",
  });
  const fade = within(group).getByRole("radio", {
    name: "Fade",
  }) as HTMLInputElement;
  const scroll = within(group).getByRole("radio", {
    name: "Scroll",
  }) as HTMLInputElement;
  expect(fade.checked).toBe(true);
  fireEvent.click(scroll);
  await waitFor(() => expect(scroll.checked).toBe(true));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(1),
  );
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs")[0]
      ?.input,
  ).toEqual({ patch: { threads: { headingTransition: "scroll" } } });
  fireEvent.click(fade);
  await waitFor(() => expect(fade.checked).toBe(true));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(2),
  );
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs")[1]
      ?.input,
  ).toEqual({ patch: { threads: { headingTransition: "fade" } } });
  expect(within(group).getAllByRole("radio")).toHaveLength(2);
});

it("chooses between minimizing the title and letting it float", async () => {
  const slot = await mount("threads");
  const group = await slot.findByRole("radiogroup", {
    name: "Title on scroll",
  });
  const minimize = within(group).getByRole("radio", {
    name: "Minimize",
  }) as HTMLInputElement;
  const float = within(group).getByRole("radio", {
    name: "Float",
  }) as HTMLInputElement;
  expect(minimize.checked).toBe(true);
  fireEvent.click(float);
  await waitFor(() => expect(float.checked).toBe(true));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(1),
  );
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs")[0]
      ?.input,
  ).toEqual({ patch: { threads: { headingScroll: "float" } } });
  fireEvent.click(minimize);
  await waitFor(() => expect(minimize.checked).toBe(true));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(2),
  );
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs")[1]
      ?.input,
  ).toEqual({ patch: { threads: { headingScroll: "minimize" } } });
});

it("shows the minimized title's settings only while the title minimizes", async () => {
  const slot = await mount("threads");
  const scrollRow = () =>
    slot.getByRole("radiogroup", { name: "Title on scroll" });
  const row = (name: string) => slot.queryAllByRole("radiogroup", { name });
  await slot.findByRole("radiogroup", { name: "Title on scroll" });
  await waitFor(() => expect(row("Title transition")).toHaveLength(1));
  expect(row("Title alignment")).toHaveLength(1);
  fireEvent.click(within(scrollRow()).getByRole("radio", { name: "Float" }));
  await waitFor(() => expect(row("Title transition")).toHaveLength(0));
  expect(row("Title alignment")).toHaveLength(0);
  // Their stored choices survive: floating only hides the settings.
  fireEvent.click(within(scrollRow()).getByRole("radio", { name: "Minimize" }));
  await waitFor(() => expect(row("Title transition")).toHaveLength(1));
  expect(row("Title alignment")).toHaveLength(1);
  expect(
    within(row("Title transition")[0]!).getByRole<HTMLInputElement>("radio", {
      name: "Fade",
    }).checked,
  ).toBe(true);
});

it("chooses between left aligned and centered titles", async () => {
  const slot = await mount("threads");
  const group = await slot.findByRole("radiogroup", {
    name: "Title alignment",
  });
  const left = within(group).getByRole("radio", {
    name: "Left",
  }) as HTMLInputElement;
  const centered = within(group).getByRole("radio", {
    name: "Centered",
  }) as HTMLInputElement;
  expect(left.checked).toBe(true);
  fireEvent.click(centered);
  await waitFor(() => expect(centered.checked).toBe(true));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(1),
  );
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs")[0]
      ?.input,
  ).toEqual({ patch: { threads: { headingAlign: "center" } } });
});

it("saves the Titles and parent-link switches", async () => {
  const slot = await mount("threads");
  fireEvent.click(
    await slot.findByRole("switch", { name: "Keep titles current" }),
  );
  fireEvent.click(
    slot.getByRole("switch", { name: "Show parent thread link" }),
  );
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(2),
  );
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => call.input),
  ).toEqual([
    { patch: { threads: { autoTitle: false } } },
    { patch: { threads: { showParentLink: true } } },
  ]);
  expect(slot.getByTestId("bb-provider-model-picker")).toBeTruthy();
});

it("surfaces settings save failures and reverts optimistic state", async () => {
  const slot = await mount("threads", {
    setPrefs: async () => {
      throw new Error("Save failed");
    },
  });
  const toggle = await slot.findByRole("switch", {
    name: "Keep titles current",
  });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(slot.getByRole("alert").textContent).toContain("Save failed"),
  );
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

it("saves the Show archive button switch, on by default", async () => {
  const slot = await mount("threads");
  const toggle = await slot.findByRole("switch", {
    name: "Show archive button",
  });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(toggle.getAttribute("aria-checked")).toBe("false"),
  );
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => call.input),
  ).toEqual([{ patch: { threads: { showArchiveButton: false } } }]);
});

it("saves New threads preferences, keeping the Quick analysis model when suggestions are off", async () => {
  const slot = await mount("new-work");
  await slot.findByRole("switch", { name: "Suggestions while typing" });
  expect(
    slot.getByText(
      "Preview a new thread's topic in the composer as you write, using the Quick analysis model.",
    ),
  ).toBeTruthy();
  fireEvent.click(await slot.findByRole("button", { name: "Home project" }));
  fireEvent.click(
    await slot.findByRole("option", { name: "Don't work in a project" }),
  );
  fireEvent.click(
    slot.getByRole("switch", { name: "Suggestions while typing" }),
  );
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "setPrefs"),
    ).toHaveLength(2),
  );
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => call.input),
  ).toEqual([
    { patch: { newWork: { homeProjectId: "" } } },
    { patch: { newWork: { suggestions: false } } },
  ]);
  // Quick analysis still titles new threads, so its model stays available.
  expect(
    slot.getByTestId("bb-provider-model-picker").getAttribute("data-disabled"),
  ).not.toBe("true");
});

it("shows the worker-thread note for a non-gateway analysis model", async () => {
  const slot = await mount("threads");
  await slot.findByTestId("bb-provider-model-picker");
  expect(
    slot.queryByText(/hidden worker thread and takes several seconds longer/i),
  ).toBeNull();
  const model = slot.getByLabelText("Model") as HTMLInputElement;
  const provider = slot.getByLabelText("Provider ID") as HTMLInputElement;
  fireEvent.change(provider, { target: { value: "openai" } });
  fireEvent.change(model, { target: { value: "gpt-4.1" } });
  fireEvent.click(
    slot.getByRole("button", { name: "Apply execution selection" }),
  );
  await waitFor(() =>
    expect(
      slot.getByText(/hidden worker thread and takes several seconds longer/i),
    ).toBeTruthy(),
  );
});

it("shows the Full analysis model with its eval-tested default", async () => {
  const slot = await mount("threads");
  const picker = await slot.findByTestId("bb-provider-model-picker");
  expect(picker).toBeTruthy();
  expect(
    (picker.querySelector('[aria-label="Model"]') as HTMLInputElement).value,
  ).toBe("vercel-ai-gateway/openai/gpt-6-sol-fast");
});

it("shows the Analysis machine only when more than one machine is connected", async () => {
  const alone = await mount("advanced", {
    machines: [{ id: "m1", name: "Laptop" }],
  });
  await alone.findByRole("switch", { name: "Debug UI" });
  expect(alone.queryByRole("button", { name: "Analysis machine" })).toBeNull();
  alone.lifecycle.unmount();
  const several = await mount("advanced", {
    machines: [
      { id: "m1", name: "Laptop" },
      { id: "m2", name: "Studio" },
    ],
  });
  expect(
    await several.findByRole("button", { name: "Analysis machine" }),
  ).toBeTruthy();
  fireEvent.click(several.getByRole("switch", { name: "Debug UI" }));
  await waitFor(() =>
    expect(
      several.inspection.rpcCalls.some(
        (call) =>
          call.method === "setPrefs" &&
          JSON.stringify(call.input).includes('"debugUi":true'),
      ),
    ).toBe(true),
  );
});

it("records on its own, and shows the debug UI only while its switch is on", async () => {
  const slot = await mount("advanced");
  // Recording is separate from the UI, and on by default.
  const recording = await slot.findByRole("switch", {
    name: "Record model calls",
  });
  expect(recording.getAttribute("aria-checked")).toBe("true");
  const master = slot.getByRole("switch", { name: "Debug UI" });
  expect(master.getAttribute("aria-checked")).toBe("false");
  for (const label of SURFACES)
    expect(slot.queryByRole("switch", { name: label })).toBeNull();

  fireEvent.click(master);
  for (const label of SURFACES) {
    const toggle = await slot.findByRole("switch", { name: label });
    // Turning the UI on leaves every surface on.
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  }

  // One panel holds recording, the debug UI, and the surfaces it turns on.
  const panel = recording.closest(".bg-card")!;
  expect(
    slot.getByRole("switch", { name: "Debug UI" }).closest(".bg-card"),
  ).toBe(panel);
  for (const label of SURFACES)
    expect(panel.contains(slot.getByRole("switch", { name: label }))).toBe(
      true,
    );

  fireEvent.click(slot.getByRole("switch", { name: "Reply diagnostics" }));
  await waitFor(() =>
    expect(
      slot
        .getByRole("switch", { name: "Reply diagnostics" })
        .getAttribute("aria-checked"),
    ).toBe("false"),
  );
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => call.input),
  ).toEqual([
    { patch: { advanced: { debugUi: true } } },
    { patch: { advanced: { debugReplies: false } } },
  ]);
  // The other surfaces keep the debug UI they were given.
  expect(
    slot
      .getByRole("switch", { name: "Inspect buttons" })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

it("lists every color token with what it draws with now", async () => {
  const slot = await mount("colors");
  for (const name of [
    "Complete",
    "Review",
    "Waiting",
    "Needs you",
    "Failure",
    "Suggestions",
  ])
    expect(
      await slot.findByRole("button", { name: `${name} color` }),
    ).toBeTruthy();
  expect(
    slot.container.querySelector('[data-ws-color-caption="complete"]')
      ?.textContent,
  ).toBe("Default");
  expect(
    slot.getByRole("radio", { name: "Workstreams" }).getAttribute("value"),
  ).toBe("workstreams");
  expect(slot.container.querySelector('input[type="color"]')).toBeNull();
});

/** Opens a token's swatch picker and returns it. */
async function openPicker(
  slot: Awaited<ReturnType<typeof mount>>,
  name: string,
) {
  fireEvent.click(await slot.findByRole("button", { name: `${name} color` }));
  return within(
    await screen.findByRole("radiogroup", { name: `${name} color` }),
  );
}

const setPrefsInputs = (slot: Awaited<ReturnType<typeof mount>>) =>
  slot.inspection.rpcCalls
    .filter((call) => call.method === "setPrefs")
    .map((call) => call.input);

it("picks a default, theme, or custom color from a token's swatches", async () => {
  const slot = await mount("colors");
  let picker = await openPicker(slot, "Review");
  expect(picker.getByRole("radio", { name: "Default" })).toHaveProperty(
    "checked",
    true,
  );
  fireEvent.click(picker.getByRole("radio", { name: "Destructive" }));
  await waitFor(() => expect(setPrefsInputs(slot)).toHaveLength(1));
  await waitFor(() =>
    expect(
      slot.container.querySelector('[data-ws-color-caption="review"]')
        ?.textContent,
    ).toBe("Destructive"),
  );
  fireEvent.click(picker.getByRole("radio", { name: "Custom color" }));
  const hex = await screen.findByLabelText("Review hex color");
  fireEvent.change(hex, { target: { value: "AA3366" } });
  fireEvent.keyDown(hex, { key: "Enter" });
  fireEvent.change(hex, { target: { value: "#12" } });
  fireEvent.blur(hex);
  expect((hex as HTMLInputElement).value).toBe("#aa3366");
  fireEvent.change(screen.getByLabelText("Review custom color"), {
    target: { value: "#336699" },
  });
  await waitFor(() => expect(setPrefsInputs(slot)).toHaveLength(4));
  picker = within(screen.getByRole("radiogroup", { name: "Review color" }));
  fireEvent.click(picker.getByRole("radio", { name: "Default" }));
  await waitFor(() => expect(setPrefsInputs(slot)).toHaveLength(5));
  expect(setPrefsInputs(slot)).toEqual([
    { patch: { colors: { review: { kind: "theme", color: "destructive" } } } },
    // jsdom can't paint, so the picker starts from the neutral fallback.
    { patch: { colors: { review: { kind: "custom", color: "#808080" } } } },
    { patch: { colors: { review: { kind: "custom", color: "#aa3366" } } } },
    { patch: { colors: { review: { kind: "custom", color: "#336699" } } } },
    { patch: { colors: { review: { kind: "default" } } } },
  ]);
});

it("switches the default set and names each defaulted token's theme color", async () => {
  const slot = await mount("colors");
  fireEvent.click(await slot.findByRole("radio", { name: "bb theme" }));
  await waitFor(() =>
    expect(
      slot.container.querySelector('[data-ws-color-caption="complete"]')
        ?.textContent,
    ).toBe("Default · Success"),
  );
  expect(setPrefsInputs(slot)).toEqual([
    { patch: { colors: { scheme: "theme" } } },
  ]);
  const picker = await openPicker(slot, "Needs you");
  // The Default swatch now names the theme color it stands for.
  expect(
    picker.getByRole("radio", { name: "Default · Attention" }),
  ).toHaveProperty("checked", true);
  expect(picker.getByRole("radio", { name: "Attention" })).toHaveProperty(
    "checked",
    false,
  );
});

it("writes the chosen colors over the token defaults, and nothing at the defaults", async () => {
  const overlay = { component: ColorTokenStyle };
  const styles = () =>
    document.head.querySelectorAll("style[data-ws-color-tokens]");
  let prefs = parsePrefs({});
  const atDefaults = renderSlot(
    overlay,
    {},
    { rpc: { prefs: () => ({ prefs }) } },
  );
  await waitFor(() =>
    expect(
      atDefaults.inspection.rpcCalls.some((call) => call.method === "prefs"),
    ).toBe(true),
  );
  expect(styles()).toHaveLength(0);
  atDefaults.lifecycle.unmount();

  prefs = mergePrefs(prefs, {
    colors: { complete: { kind: "custom", color: "#228833" } },
  });
  const custom = renderSlot(overlay, {}, { rpc: { prefs: () => ({ prefs }) } });
  await waitFor(() => expect(styles()).toHaveLength(1));
  expect(styles()[0]!.textContent).toContain("--ws-complete: #228833;");
  custom.lifecycle.unmount();
  expect(styles()).toHaveLength(0);
});
