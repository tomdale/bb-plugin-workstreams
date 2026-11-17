// @vitest-environment jsdom
import { useState } from "react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkstreamsPage } from "../../src/app/page/Page.tsx";
import { pullRequestSubPath } from "../../src/app/pullRequests/model.ts";
import { PullRequestsRealtime } from "../../src/app/pullRequests/store.ts";
import {
  setOpenPullRequest,
  useOpenPullRequest,
} from "../../src/app/pullRequests/route.ts";
import type { TrackedPullRequest } from "../../src/domain/pullRequests.ts";
import { emptyState, sidebarThread } from "./fixtures.ts";
import {
  NOW,
  check,
  minutesAgo,
  trackedPullRequest as pr,
} from "./pull-request-fixtures.ts";

beforeEach(() => {
  opened.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  setOpenPullRequest(null);
  vi.useRealTimers();
});

type Handlers = {
  items?: () => TrackedPullRequest[];
  refresh?: (id: string) => TrackedPullRequest | null;
  machines?: { id: string; name: string }[];
  trackedFails?: boolean;
  /** Draws a button that moves the page to this pull request's view. */
  switchTo?: TrackedPullRequest;
};

/** What `useOpenPullRequest` reports for the open pull request, as the sidebar reads it. */
const opened: boolean[] = [];
function OpenProbe() {
  opened.push(useOpenPullRequest(open.id));
  return null;
}

function mount(target: TrackedPullRequest | string, handlers: Handlers = {}) {
  const id = typeof target === "string" ? target : target.id;
  const items =
    handlers.items ?? (() => (typeof target === "string" ? [] : [target]));
  const openUrl = vi.fn(() => true);
  const slot = renderSlot(
    {
      component: function Host(props: { subPath?: string }) {
        const [subPath, setSubPath] = useState(props.subPath);
        const next = handlers.switchTo;
        return (
          <>
            {next ? (
              <button
                type="button"
                onClick={() => setSubPath(pullRequestSubPath(next.id))}
              >
                Show the other
              </button>
            ) : null}
            <WorkstreamsPage subPath={subPath} />
            <OpenProbe />
            <PullRequestsRealtime />
          </>
        );
      },
    },
    { subPath: pullRequestSubPath(id) },
    {
      context: { projectId: null, threadId: null },
      openUrl,
      sidebarThreads: {
        status: "ready",
        threads: [
          sidebarThread("thread_author", { title: "Add the harbor lights" }),
        ],
        sections: [],
        projects: [],
      },
      rpc: {
        state: () => ({ ...emptyState() }),
        prefs: () => ({ prefs: {} }),
        machines: () => ({
          machines: handlers.machines ?? [
            { id: "host_one", name: "Dock Mini" },
          ],
        }),
        trackedPullRequests: () => {
          if (handlers.trackedFails) throw new Error("server down");
          return { items: items() };
        },
        refreshTrackedPullRequest: (input: unknown) => ({
          item:
            handlers.refresh?.((input as { id: string }).id) ??
            items().find((p) => p.id === (input as { id: string }).id) ??
            null,
        }),
      } as never,
    },
  );
  return { slot, openUrl };
}

const open = pr({
  number: 46,
  title: "Serve the dial from a token route",
  body: "Reads the **ready** list from one route.",
  status: "running",
  reason: "Two checks are still running",
  checks: [
    check("typecheck", "passed", {
      startedAt: minutesAgo(10),
      completedAt: new Date(NOW - 10 * 60_000 + 43_000).toISOString(),
    }),
    check("test", "running", {
      startedAt: minutesAgo(2),
      url: "https://ci.example/runs/9",
    }),
    check("lint", "failed", {
      startedAt: minutesAgo(10),
      completedAt: new Date(NOW - 10 * 60_000 + 9_000).toISOString(),
      url: "javascript:alert(1)",
    }),
    check("smoke", "unknown"),
  ],
  headRefName: "feature/dial",
  baseRefName: "main",
  additions: 310,
  deletions: 41,
  changedFiles: 9,
});

describe("the pull request view", () => {
  it("shows the title, repository, number, status, and reason", async () => {
    const { slot } = mount(open);
    const view = await slot.findByRole("article");
    expect(within(view).getByRole("heading", { level: 1 }).textContent).toBe(
      "Serve the dial from a token route",
    );
    expect(view.textContent).toContain("tidewater/harbor #46");
    expect(view.textContent).toContain("Checks running");
    expect(view.textContent).toContain("Two checks are still running.");
    expect(view.textContent).toContain("1 of 4 checks passed.");
  });

  it("moves focus to the title when it opens", async () => {
    const { slot } = mount(open);
    const heading = await slot.findByRole("heading", { level: 1 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("lists every check with its result and duration, failures first", async () => {
    const { slot } = mount(open);
    const list = await slot.findByRole("list", { name: "Checks" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "lintFailed 9s",
      "testRunning 2m 00s",
      "smokeNo result",
      "typecheckPassed 43s",
    ]);
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual([
      "failed",
      "running",
      "unknown",
      "passed",
    ]);
  });

  it("links a check only when its address is safe", async () => {
    const { slot, openUrl } = mount(open);
    const list = await slot.findByRole("list", { name: "Checks" });
    const test = within(list).getByRole("link", { name: "test" });
    expect(test.getAttribute("href")).toBe("https://ci.example/runs/9");
    // The unsafe address on "lint" draws no link.
    expect(within(list).queryByRole("link", { name: "lint" })).toBeNull();
    expect(within(list).getAllByRole("link")).toHaveLength(1);
    fireEvent.click(test);
    expect(openUrl).toHaveBeenCalledWith("https://ci.example/runs/9");
  });

  it("opens the canonical address through BB and offers no way to change the pull request", async () => {
    const { slot, openUrl } = mount(open);
    const github = await slot.findByRole("link", { name: /Open on GitHub/ });
    expect(github.getAttribute("href")).toBe(open.url);
    fireEvent.click(github);
    expect(openUrl).toHaveBeenCalledWith(open.url);
    const buttons = slot
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());
    expect(buttons).not.toContain("Merge");
    expect(buttons.join(" ")).not.toMatch(
      /merge|close|approve|review|comment/i,
    );
  });

  it("draws no GitHub link for an address that isn't http or https", async () => {
    const { slot } = mount(pr({ ...open, url: "javascript:alert(1)" }));
    await slot.findByRole("article");
    expect(slot.queryByRole("link", { name: /Open on GitHub/ })).toBeNull();
  });

  it("shows the description as plain text, with no links or images made from it", async () => {
    const body = [
      "Reads the **ready** list from one route.",
      "[docs](docs/readme.md) and [secrets](/etc/passwd) and [x](javascript:alert(1))",
      "![pixel](https://tracker.example/p.png)",
    ].join("\n");
    const { slot } = mount(pr({ ...open, body }));
    const view = await slot.findByRole("article");
    const description = within(view).getByRole("heading", {
      name: "Description",
    }).nextElementSibling as HTMLElement;
    expect(description.textContent).toBe(body);
    expect(description.querySelector("a, img, strong, code")).toBeNull();
    // Only the view's own links remain: GitHub, the safe check, and nothing from the body.
    expect(
      within(view)
        .queryAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "https://github.example/tidewater/harbor/pull/46",
      "https://ci.example/runs/9",
    ]);
    expect(view.querySelector("img")).toBeNull();
  });

  it("says when there is no description", async () => {
    const { slot } = mount(pr({ body: "  \n" }));
    await slot.findByRole("article");
    expect(slot.getByText("No description.")).toBeTruthy();
  });

  it("gives the branch, the changes, the tracking thread, and when it was checked", async () => {
    const { slot } = mount(open);
    const view = await slot.findByRole("article");
    expect(within(view).getByText("feature/dial")).toBeTruthy();
    expect(view.textContent).toContain("9 files, +310 −41");
    expect(view.textContent).toContain("Checkedjust now");
    fireEvent.click(
      within(view).getByRole("button", { name: "Add the harbor lights" }),
    );
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thread_author",
    });
  });

  it("says so when the tracking thread is gone", async () => {
    const { slot } = mount(pr({ threadId: "thread_missing" }));
    const view = await slot.findByRole("article");
    expect(view.textContent).toContain("A thread that’s no longer listed");
  });

  it("marks the pull request open for the sidebar and clears it on leaving", async () => {
    const { slot } = mount(open);
    await slot.findByRole("article");
    expect(opened.at(-1)).toBe(true);
    // Back to the queue: the page no longer shows the pull request.
    fireEvent.click(slot.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(opened.at(-1)).toBe(false));
  });

  it("goes back through BB's navigation, so the same pull request can be opened again", async () => {
    const { slot } = mount(open);
    await slot.findByRole("article");
    fireEvent.click(slot.getByRole("button", { name: "Back" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "home",
    });
  });

  it("shows the other pull request when the page moves to it", async () => {
    const other = pr({ number: 47, title: "Retire the old dial" });
    const { slot } = mount(open, {
      items: () => [open, other],
      switchTo: other,
    });
    await slot.findByText("Serve the dial from a token route");
    fireEvent.click(slot.getByRole("button", { name: "Show the other" }));
    await slot.findByText("Retire the old dial");
    expect(slot.queryByText("Serve the dial from a token route")).toBeNull();
  });

  it("asks the server to read the pull request when it opens", async () => {
    const { slot } = mount(open);
    await slot.findByRole("article");
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({
          method: "refreshTrackedPullRequest",
          input: { id: open.id },
        }),
      ),
    );
  });
});

describe("a pull request that can't refresh", () => {
  const stale = pr({
    ...open,
    status: "ready",
    reason: "All checks passed",
    checks: [check("build", "passed")],
    error: "gh isn’t signed in",
    lastSuccessAt: NOW - 90 * 60_000,
  });

  it("keeps the last status and names the machine and the reason", async () => {
    const { slot } = mount(stale);
    const alert = await slot.findByRole("alert");
    await waitFor(() => expect(alert.textContent).toContain("Dock Mini"));
    expect(alert.textContent).toMatch(/Can’t refresh since /);
    expect(alert.textContent).toContain("gh isn’t signed in");
    const view = slot.getByRole("article");
    expect(view.textContent).toContain("Ready to merge");
    expect(view.textContent).toContain("All checks passed.");
    // The freshness row gives way to the banner.
    expect(within(view).queryByText("Checked")).toBeNull();
  });

  it("leaves the machine unnamed when it isn't among the connected ones", async () => {
    const { slot } = mount(stale, { machines: [] });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).not.toContain("reads this pull request");
    expect(alert.textContent).toContain("gh isn’t signed in");
  });

  it("shows no banner for a pull request that read fine", async () => {
    const { slot } = mount(open);
    await slot.findByRole("article");
    expect(slot.queryByRole("alert")).toBeNull();
  });
});

describe("a merged or closed pull request", () => {
  it("says when it settled and when it leaves the sidebar", async () => {
    const { slot } = mount(
      pr({
        status: "merged",
        mergedAt: minutesAgo(14),
        expiresAt: NOW + 46 * 60_000,
        reason: "Merged by a maintainer",
        checks: [check("build", "passed")],
      }),
    );
    const view = await slot.findByRole("article");
    expect(view.textContent).toContain("Merged 14 minutes ago");
    expect(view.textContent).toContain("Leaves the sidebar in 46 minutes.");
    expect(within(view).queryByText("Checked")).toBeNull();
  });

  it("reads a closed one the same way", async () => {
    const { slot } = mount(
      pr({
        status: "closed",
        closedAt: minutesAgo(41),
        expiresAt: NOW + 19 * 60_000,
      }),
    );
    const view = await slot.findByRole("article");
    expect(view.textContent).toContain("Closed 41 minutes ago");
    expect(view.textContent).toContain("Leaves the sidebar in 19 minutes.");
  });
});

describe("a pull request the view can't show", () => {
  it("says it is loading until the server answers", async () => {
    const { slot } = mount("github.example/tidewater/harbor#1", {
      items: () => [],
    });
    expect(slot.getByRole("status").textContent).toBe("Loading pull request…");
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toContain(
        "no longer tracked",
      ),
    );
  });

  it("says an expired or removed one is no longer tracked, with a way back", async () => {
    const { slot } = mount("github.example/tidewater/harbor#1", {
      items: () => [],
    });
    const status = await waitFor(() => {
      const el = slot.getByRole("status");
      expect(el.textContent).toContain("no longer tracked");
      return el;
    });
    expect(status.textContent).toContain("after an hour");
    expect(slot.getByRole("button", { name: "Back" })).toBeTruthy();
  });

  it("says so when the list can't be read", async () => {
    const { slot } = mount("github.example/tidewater/harbor#1", {
      trackedFails: true,
    });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load pull requests.");
  });

  it("does not show one pull request as the whole list when the list can't be read", async () => {
    const { slot } = mount(open, {
      trackedFails: true,
      refresh: () => open,
    });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toBe("Couldn’t load pull requests.");
    expect(slot.queryByRole("article")).toBeNull();
  });

  it("keeps showing a pull request that expires while it is open, then says it is gone", async () => {
    let items = [open];
    const { slot } = mount(open, { items: () => items });
    await slot.findByRole("article");
    items = [];
    await act(async () => {
      await slot.emitRealtime("pull-requests-changed", {});
    });
    await waitFor(() => expect(slot.queryByRole("article")).toBeNull());
    expect(slot.getByRole("status").textContent).toContain("no longer tracked");
  });
});
