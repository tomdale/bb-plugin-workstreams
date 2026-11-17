// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  USAGE_RANGES,
  type UsageFlag,
  type UsageRange,
  type UsageReport,
} from "../../src/domain/usage.ts";
import { bucketText } from "../../src/app/usage/text.ts";
import { sidebarThread } from "./fixtures.ts";
import { chooseOption } from "./select.ts";
import {
  FLAGS,
  NOW,
  emptyUsageReport,
  spendState,
  usageReport,
} from "./usage-fixture.ts";
import { UsageView } from "./usage-mount.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

type Handlers = Record<string, (input: never) => unknown>;

async function mount(rpc: Handlers = {}) {
  return renderSlot(
    { component: UsageView },
    {},
    {
      sidebarThreads: {
        status: "ready",
        threads: [
          sidebarThread("thr_recaps", { title: "Rewriting recap reminders" }),
          sidebarThread("thr_ledger", { title: "Building the usage ledger" }),
          sidebarThread("thr_vertex", { title: "Migrating Vertex auth" }),
        ],
        sections: [],
        projects: [],
      },
      rpc: {
        usage: ({ range }: { range: UsageRange }) => usageReport(range),
        ...rpc,
      } as never,
    },
  );
}

const usageCalls = (slot: Awaited<ReturnType<typeof mount>>) =>
  slot.inspection.rpcCalls
    .filter((call) => call.method === "usage")
    .map((call) => (call.input as { range: UsageRange }).range);

/** The chart, once the report has loaded. */
const chartOf = (slot: Awaited<ReturnType<typeof mount>>) =>
  slot.findByRole("list", { name: /^Reported cost over/ });

/** The row of a breakdown table whose first cell begins with `name`. */
const rowOf = (slot: Awaited<ReturnType<typeof mount>>, name: string) =>
  slot.getByRole("row", { name: new RegExp(`^${name}`) });

it("asks for the last 24 hours first, then for each range chosen", async () => {
  const slot = await mount();
  await slot.findByRole("list", {
    name: "Reported cost over the last 24 hours",
  });
  const labels: Record<UsageRange, string> = {
    "1h": "Last hour",
    "24h": "Last 24 hours",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    "90d": "Last 90 days",
  };
  for (const range of USAGE_RANGES.filter((range) => range !== "24h")) {
    chooseOption(slot.getByRole("combobox", { name: "Range" }), labels[range]);
    await slot.findByRole("list", {
      name: `Reported cost over the ${labels[range].toLowerCase()}`,
    });
  }
  expect(usageCalls(slot)).toEqual(["24h", "1h", "7d", "30d", "90d"]);
});

it("keeps the chosen range for the session", async () => {
  const first = await mount();
  await chartOf(first);
  chooseOption(first.getByRole("combobox", { name: "Range" }), "Last 7 days");
  await waitFor(() => expect(usageCalls(first)).toEqual(["24h", "7d"]));
  first.lifecycle.unmount();
  const second = await mount();
  await second.findByRole("list", {
    name: "Reported cost over the last 7 days",
  });
  expect(usageCalls(second)).toEqual(["7d"]);
});

it("ignores a stored range it does not offer", async () => {
  sessionStorage.setItem("workstreams:usage-range", "1y");
  const slot = await mount();
  await chartOf(slot);
  expect(usageCalls(slot)).toEqual(["24h"]);
});

it("keeps an earlier range's late answer from replacing the chosen range", async () => {
  let answerDay!: (report: UsageReport) => void;
  const slot = await mount({
    usage: (({ range }: { range: UsageRange }) =>
      range === "24h"
        ? new Promise<UsageReport>((resolve) => (answerDay = resolve))
        : usageReport(range)) as never,
  });
  expect(slot.getByRole("status").textContent).toBe("Loading usage…");
  chooseOption(slot.getByRole("combobox", { name: "Range" }), "Last hour");
  await slot.findByRole("list", { name: "Reported cost over the last hour" });
  await act(async () => answerDay(usageReport("24h")));
  expect(
    slot.getByRole("list", { name: "Reported cost over the last hour" }),
  ).toBeTruthy();
});

it("says why calls are paused and when the pause ends, and resumes", async () => {
  let resumed = false;
  const slot = await mount({
    usage: (({ range }: { range: UsageRange }) =>
      usageReport(range, {
        ...spendState(
          { hour: { cost: 10.42, calls: 212, unmetered: 9 } },
          resumed ? { hourSpend: NOW + 3_600_000 } : {},
        ),
      })) as never,
    usageResume: (() => {
      resumed = true;
      return { state: spendState().state };
    }) as never,
  });
  const notice = await slot.findByText("Model calls are paused");
  expect(notice.parentElement!.textContent).toBe(
    "Model calls are pausedThe last hour's spend reached the $10.00 limit. Calls resume within the hour.",
  );
  expect(
    slot.getByRole("meter", { name: "Last hour" }).nextElementSibling!
      .textContent,
  ).toBe("Reached the $10.00 limit, calls are paused");
  fireEvent.click(slot.getByRole("button", { name: "Resume" }));
  expect(
    await slot.findByText(
      "The last hour's spend is past the $10.00 limit. Calls are resumed until 4:42 PM.",
    ),
  ).toBeTruthy();
  expect(slot.queryByText("Model calls are paused")).toBeNull();
  expect(slot.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(
    slot.inspection.rpcCalls.map((call) => call.method).filter(Boolean),
  ).toEqual(["usage", "usageResume", "usage"]);
});

it("reports a resume that failed and stays paused", async () => {
  const slot = await mount({
    usage: (() =>
      usageReport("24h", {
        ...spendState({ day: { cost: 30, calls: 900, unmetered: 71 } }),
      })) as never,
    usageResume: (() => {
      throw new Error("The server is restarting.");
    }) as never,
  });
  fireEvent.click(await slot.findByRole("button", { name: "Resume" }));
  expect((await slot.findByRole("alert")).textContent).toBe(
    "Usage could not be refreshed. The server is restarting.",
  );
  // A cap is reached at the threshold itself, and a day's pause ends at midnight.
  expect(
    slot.getByText("Model calls are paused").parentElement!.textContent,
  ).toContain(
    "Today's spend reached the $30.00 limit. Calls resume at midnight.",
  );
  expect(
    (slot.getByRole("button", { name: "Resume" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("says no cost was reported for a spend window whose requests reported none", async () => {
  const slot = await mount({
    usage: (() =>
      usageReport("24h", {
        ...spendState({
          hour: { cost: 0, calls: 12, unmetered: 12 },
          // Nothing spent and every request reported a cost.
          day: { cost: 0, calls: 40, unmetered: 0 },
          month: { cost: 0, calls: 0, unmetered: 0 },
        }),
      })) as never,
  });
  const heading = await slot.findByRole("heading", { name: "Limits" });
  const rows = within(heading.parentElement!)
    .getAllByRole("listitem")
    .map((row) => row.textContent);
  expect(rows).toEqual([
    "Last hourNo cost reportedWarns at $3.00, pauses at $10.0012 requests reported no cost",
    "Today$0.00Warns at $10.00, pauses at $30.00",
    "This month$0.00No limit set",
    "Requests in the last hour12Warns at 150, pauses at 500",
  ]);
});

it("gives a reached warning one line and no Resume", async () => {
  const slot = await mount({
    usage: (() =>
      usageReport("24h", {
        ...spendState({ day: { cost: 10, calls: 520, unmetered: 71 } }),
      })) as never,
  });
  expect(
    await slot.findByText(
      "Today's spend reached the $10.00 warning. Calls pause at $30.00.",
    ),
  ).toBeTruthy();
  expect(slot.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(slot.queryByText("Model calls are paused")).toBeNull();
});

it("shows no notice below every warning", async () => {
  const slot = await mount({
    usage: (() =>
      usageReport("24h", {
        ...spendState({ day: { cost: 9.99, calls: 149, unmetered: 0 } }),
      })) as never,
  });
  await chartOf(slot);
  expect(slot.queryByText(/warning/)).toBeNull();
  expect(slot.queryByText(/paused/)).toBeNull();
});

it("shows a dash and says so for a group that reported no cost, never $0.00", async () => {
  const slot = await mount();
  const worker = await waitFor(() => rowOf(slot, "Worker thread"));
  const cells = within(worker).getAllByRole("cell");
  expect(cells.at(-1)!.textContent).toBe("—");
  expect(within(worker).getByRole("rowheader").textContent).toBe(
    "Worker threadNo cost reported",
  );
  // A group that reported some cost shows it, and counts the requests it leaves out.
  const gateway = rowOf(slot, "AI Gateway");
  expect(within(gateway).getAllByRole("cell").at(-1)!.textContent).toMatch(
    /^\$\d+\.\d\d$/,
  );
  expect(within(gateway).getByRole("rowheader").textContent).toMatch(
    /^AI Gateway3 of [\d,]+ requests reported no cost$/,
  );
  // A fully reported group has no note.
  expect(within(rowOf(slot, "Vertex")).getByRole("rowheader").textContent).toBe(
    "Vertex",
  );
  expect(slot.container.textContent).not.toContain("$0.00");
});

it("totals only what was reported and counts the rest in words", async () => {
  const report = usageReport("24h");
  const slot = await mount();
  const metered = report.totals.calls - report.totals.unmetered;
  expect(
    await slot.findByText(
      (_, node) =>
        node?.tagName === "P" &&
        node.textContent ===
          `$${report.totals.cost.toFixed(2)} reported for ${metered} requests. ${report.totals.unmetered} more requests reported no cost.`,
    ),
  ).toBeTruthy();
});

it("names a range none of whose requests reported a cost", async () => {
  const base = usageReport("24h");
  const unreported = <T extends UsageReport["totals"]>(row: T): T => ({
    ...row,
    cost: 0,
    unmetered: row.calls,
    inputTokens: 0,
    outputTokens: 0,
  });
  const slot = await mount({
    usage: (() => ({
      ...base,
      totals: unreported(base.totals),
      buckets: base.buckets.map(unreported),
      byPath: base.byPath.map(unreported),
    })) as never,
  });
  expect(
    await slot.findByText(
      `No cost reported for ${base.totals.calls} requests.`,
    ),
  ).toBeTruthy();
  expect(slot.container.textContent).not.toContain("$0.00");
  expect(slot.queryByText(/tokens in/)).toBeNull();
});

it("lists critical flags first, then the newest, and opens a flag's thread", async () => {
  // A warning with newer evidence than the critical flag.
  const newest: UsageFlag = {
    ...FLAGS[1]!,
    id: "cost-unreported",
    kind: "cost-unreported",
    title: "3 gateway calls used tokens but reported no cost",
    at: NOW - 60_000,
  };
  const slot = await mount({
    // Whatever order the flags arrive in.
    usage: (() =>
      usageReport("24h", { flags: [FLAGS[1]!, newest, FLAGS[0]!] })) as never,
  });
  const heading = await slot.findByRole("heading", { name: "Flags" });
  const items = within(heading.parentElement!).getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining(
      "CriticalOne thread made 212 requests in an hourThread thr_recaps, 212 requests between 2:38 PM and 3:40 PM, $1.84 reported.",
    ),
    expect.stringContaining(
      "Warning3 gateway calls used tokens but reported no cost",
    ),
    expect.stringContaining(
      "Warning18% of requests in the last 24 hours reported no cost",
    ),
  ]);
  const link = within(items[0]!).getByRole("link", {
    name: "Rewriting recap reminders",
  });
  expect(link.getAttribute("href")).toBe("/projects/proj_1/threads/thr_recaps");
  fireEvent.click(link);
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "openUrl",
    url: "/projects/proj_1/threads/thr_recaps",
  });
  // A flag about no one thread offers no link.
  expect(within(items[2]!).queryByRole("link")).toBeNull();
});

it("names threads by title in the thread table and links each one", async () => {
  const slot = await mount();
  const listed = await waitFor(() => rowOf(slot, "Rewriting recap reminders"));
  expect(within(listed).getByRole("link").getAttribute("href")).toBe(
    "/projects/proj_1/threads/thr_recaps",
  );
  // A thread the sidebar does not list takes the server's name for it, or none.
  expect(
    within(rowOf(slot, "Tidying the dotfiles repo"))
      .getByRole("link")
      .getAttribute("href"),
  ).toBe("/threads/thr_archived");
  expect(
    within(rowOf(slot, "Unavailable thread"))
      .getByRole("link")
      .getAttribute("href"),
  ).toBe("/threads/thr_hidden");
});

it("omits Flags when there are none", async () => {
  const slot = await mount();
  await slot.findByRole("heading", { name: "Limits" });
  expect(slot.queryByRole("heading", { name: "Flags" })).toBeNull();
});

it("says an empty ledger has recorded nothing", async () => {
  const slot = await mount({ usage: (() => emptyUsageReport()) as never });
  expect(await slot.findByText("No model calls recorded yet.")).toBeTruthy();
  expect(slot.queryByRole("list")).toBeNull();
  expect(slot.queryByRole("table")).toBeNull();
  expect(slot.queryByRole("heading", { name: "Limits" })).toBeNull();
});

it("says a range has no calls and still shows the limits", async () => {
  const slot = await mount({
    usage: (() => ({
      ...emptyUsageReport("1h"),
      retainedSince: NOW - 3 * 86_400_000,
      ...spendState(),
    })) as never,
  });
  sessionStorage.setItem("workstreams:usage-range", "1h");
  expect(
    await slot.findByText("No model calls in the last hour."),
  ).toBeTruthy();
  expect(slot.queryByRole("list", { name: /Reported cost/ })).toBeNull();
  expect(slot.queryByRole("table")).toBeNull();
  expect(slot.getByRole("meter", { name: "Today" })).toBeTruthy();
});

it("says how far back the ledger goes when the range starts earlier", async () => {
  const within90 = await mount({
    usage: (() =>
      usageReport("90d", {
        retainedSince: new Date(2026, 6, 4, 9).getTime(),
      })) as never,
  });
  expect(
    await within90.findByText("The oldest recorded call is from Jul 4."),
  ).toBeTruthy();
  within90.lifecycle.unmount();
  // A ledger older than the range covers all of it.
  const covered = await mount({
    usage: (() =>
      usageReport("24h", { retainedSince: NOW - 40 * 86_400_000 })) as never,
  });
  await chartOf(covered);
  expect(covered.queryByText(/oldest recorded call/)).toBeNull();
});

it("reports a failed load and retries", async () => {
  let fail = true;
  const slot = await mount({
    usage: (({ range }: { range: UsageRange }) => {
      if (fail) throw new Error("Offline");
      return usageReport(range);
    }) as never,
  });
  expect((await slot.findByRole("alert")).textContent).toBe(
    "Usage could not be loaded. Offline",
  );
  expect(slot.queryByRole("list")).toBeNull();
  fail = false;
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  await slot.findByRole("list", {
    name: "Reported cost over the last 24 hours",
  });
  expect(slot.queryByRole("alert")).toBeNull();
  expect(usageCalls(slot)).toEqual(["24h", "24h"]);
});

it("keeps the report on screen when a refresh fails", async () => {
  let fail = false;
  const slot = await mount({
    usage: (({ range }: { range: UsageRange }) => {
      if (fail) throw new Error("Offline");
      return usageReport(range);
    }) as never,
  });
  await chartOf(slot);
  fail = true;
  await slot.behavior.emitRealtime("usage", { state: spendState().state });
  expect((await slot.findByRole("alert")).textContent).toBe(
    "Usage could not be refreshed. Offline",
  );
  expect(slot.getByRole("list", { name: /Reported cost/ })).toBeTruthy();
  // Another range's failure has no report to keep.
  chooseOption(slot.getByRole("combobox", { name: "Range" }), "Last 7 days");
  await waitFor(() =>
    expect(slot.getByRole("alert").textContent).toBe(
      "Usage could not be loaded. Offline",
    ),
  );
  expect(slot.queryByRole("list", { name: /Reported cost/ })).toBeNull();
});

it("refreshes on the server's usage signal and every 30 seconds", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let cost = 5;
  const slot = await mount({
    usage: (({ range }: { range: UsageRange }) => {
      const report = usageReport(range);
      return { ...report, totals: { ...report.totals, cost: cost++ } };
    }) as never,
  });
  await slot.findByText("$5.00");
  const chart = slot.getByRole("list", { name: /Reported cost/ });
  await slot.behavior.emitRealtime("usage", { state: spendState().state });
  await slot.findByText("$6.00");
  await act(async () => vi.advanceTimersByTime(29_999));
  expect(usageCalls(slot)).toHaveLength(2);
  await act(async () => vi.advanceTimersByTime(1));
  await slot.findByText("$7.00");
  // A refresh updates the page in place: the chart is the same element.
  expect(slot.getByRole("list", { name: /Reported cost/ })).toBe(chart);
  slot.lifecycle.unmount();
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(usageCalls(slot)).toHaveLength(3);
});

it("gives each bucket its time, cost, and requests as text", async () => {
  const report = usageReport("24h");
  const slot = await mount();
  const chart = await slot.findByRole("list", { name: /Reported cost/ });
  const bars = within(chart).getAllByRole("img");
  expect(bars.map((bar) => bar.getAttribute("aria-label"))).toEqual(
    report.buckets.map((bucket) => bucketText(bucket, report.bucketMs)),
  );
  const names = bars.map((bar) => bar.getAttribute("aria-label"));
  expect(names[0]).toBe(
    "Wed 3 PM to 4 PM: $0.23 reported, 15 requests, 3 with no cost reported",
  );
  // An empty bucket and one whose requests reported no cost each say so.
  expect(names).toContain("Wed 7 PM to 8 PM: No requests");
  expect(names).toContain("Wed 9 PM to 10 PM: No cost reported, 11 requests");
  expect(names.join(" ")).not.toContain("$0.00");
});

it("makes the chart one tab stop and moves between bars with the arrow keys", async () => {
  const slot = await mount();
  const chart = await slot.findByRole("list", { name: /Reported cost/ });
  const bars = within(chart).getAllByRole("img");
  const stops = () => bars.filter((bar) => bar.tabIndex === 0);
  expect(stops()).toEqual([bars.at(-1)]);
  act(() => bars.at(-1)!.focus());
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(bars.at(-2));
  expect(stops()).toEqual([bars.at(-2)]);
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(bars[0]);
  // The ends hold.
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(bars[0]);
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(bars.at(-1));
});

it("shows each window against its limits", async () => {
  const slot = await mount({
    usage: (() =>
      usageReport("24h", {
        ...spendState({ hour: { cost: 3, calls: 46, unmetered: 0 } }),
      })) as never,
  });
  const heading = await slot.findByRole("heading", { name: "Limits" });
  const rows = within(heading.parentElement!)
    .getAllByRole("listitem")
    .map((row) => row.textContent);
  expect(rows).toEqual([
    // A warning is reached at the threshold itself.
    "Last hour$3.00Past the $3.00 warning, pauses at $10.00",
    "Today$6.12Warns at $10.00, pauses at $30.0071 requests reported no cost",
    "This month$58.40No limit set912 requests reported no cost",
    "Requests in the last hour46Warns at 150, pauses at 500",
  ]);
  const hour = slot.getByRole("meter", { name: "Last hour" });
  expect(hour.getAttribute("aria-valuenow")).toBe("3");
  expect(hour.getAttribute("aria-valuemax")).toBe("10");
  expect(hour.getAttribute("aria-valuetext")).toBe("$3.00 of $10.00");
  expect(slot.queryByRole("meter", { name: "This month" })).toBeNull();
});
