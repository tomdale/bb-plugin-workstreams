// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskIdentity } from "../../src/app/task/TaskIdentity.tsx";
import type {
  Workstream,
  WorkstreamState,
} from "../../src/domain/workstreams.ts";
import { emptyState, section, sidebarThread } from "./fixtures.ts";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

const workstreams: Workstream[] = [
  {
    id: "prod_platform",
    name: "Platform",
    description: "Core platform system",
    parentId: null,
    aliases: ["Core"],
  },
  {
    id: "feat_auth",
    name: "Auth",
    description: "Authentication and SSO",
    parentId: "prod_platform",
    aliases: ["Login"],
  },
  {
    id: "feat_billing",
    name: "Billing",
    description: "Invoicing and subscriptions",
    parentId: "prod_platform",
    aliases: ["Payments"],
  },
];

const treeState: WorkstreamState = {
  workstreams,
  groups: { sec_a: "prod_platform" },
  assignments: {
    "t-parent": {
      threadId: "t-parent",
      workstreamId: "feat_auth",
      status: "assigned",
      provenance: "manual",
      label: "Platform › Auth",
      ancestorIds: ["feat_auth", "prod_platform"],
      evidence: null,
      inheritedFrom: null,
    },
    "t-child": {
      threadId: "t-child",
      workstreamId: "feat_auth",
      status: "assigned",
      provenance: "automatic",
      label: "Platform › Auth",
      ancestorIds: ["feat_auth", "prod_platform"],
      evidence: "recap analysis",
      inheritedFrom: "t-parent",
    },
    "t-auto": {
      threadId: "t-auto",
      workstreamId: "feat_auth",
      status: "assigned",
      provenance: "automatic",
      label: "Platform › Auth",
      ancestorIds: ["feat_auth", "prod_platform"],
      evidence: "recap analysis",
      inheritedFrom: null,
    },
    "t-unresolved-in-workstream": {
      threadId: "t-unresolved-in-workstream",
      workstreamId: null,
      status: "none",
      provenance: null,
      label: null,
      ancestorIds: [],
      evidence: null,
      inheritedFrom: null,
    },
    "t-assigned-unfiled": {
      threadId: "t-assigned-unfiled",
      workstreamId: "feat_billing",
      status: "assigned",
      provenance: "manual",
      label: "Platform › Billing",
      ancestorIds: ["feat_billing", "prod_platform"],
      evidence: null,
      inheritedFrom: null,
    },
  },
  revision: 5,
};

/** Mounts the workstream control as the Workstreams page renders it. */
function WorkstreamControl({ threadId }: { threadId: string }) {
  return <TaskIdentity threadId={threadId} />;
}

async function mountTaskIdentity(
  threadId: string,
  options: {
    threads?: ReturnType<typeof sidebarThread>[];
    tree?: WorkstreamState;
    rpcCalls?: { method: string; args: unknown }[];
  } = {},
) {
  const workstreamControl = { component: WorkstreamControl };

  const currentTree = options.tree ?? treeState;
  const threads = options.threads ?? [
    sidebarThread("t-parent", { title: "Parent task", sectionId: "sec_a" }),
    sidebarThread("t-child", {
      title: "Child task",
      parentThreadId: "t-parent",
      sectionId: "sec_a",
    }),
    sidebarThread("t-auto", { title: "Automatic task", sectionId: "sec_a" }),
    sidebarThread("t-unresolved-in-workstream", {
      title: "Task without identity",
      sectionId: "sec_a",
    }),
    sidebarThread("t-assigned-unfiled", {
      title: "Unfiled task with identity",
      sectionId: null,
    }),
  ];

  return renderSlot(
    workstreamControl,
    { threadId },
    {
      sidebarThreads: {
        threads,
        sections: [section("sec_a", "Alpha Workstream")],
      },
      rpc: {
        state: () => ({
          ...emptyState(),
          tree: currentTree,
        }),
        threadMove: (args: unknown) => {
          options.rpcCalls?.push({ method: "threadMove", args });
          return {
            assignment: {
              threadId,
              workstreamId: (args as { workstreamId: string }).workstreamId,
              status: "assigned",
              provenance: "manual",
              label: "Platform › Billing",
              ancestorIds: ["feat_billing", "prod_platform"],
              evidence: null,
              inheritedFrom: null,
            },
          };
        },
        taskClear: (args: unknown) => {
          options.rpcCalls?.push({ method: "taskClear", args });
          return {
            assignment: {
              threadId,
              workstreamId: null,
              status: "none",
              provenance: null,
              label: null,
              ancestorIds: [],
              evidence: null,
              inheritedFrom: null,
            },
          };
        },
        threadAutomatic: (args: unknown) => {
          options.rpcCalls?.push({ method: "threadAutomatic", args });
          return {
            assignment: {
              threadId,
              workstreamId: "feat_auth",
              status: "assigned",
              provenance: "automatic",
              label: "Platform › Auth",
              ancestorIds: ["feat_auth", "prod_platform"],
              evidence: "model reclassify",
              inheritedFrom: null,
            },
          };
        },
      },
    },
  );
}

describe("Workstream control", () => {
  it("shows a workstream the user chose", async () => {
    const slot = await mountTaskIdentity("t-parent");
    const button = await slot.findByRole("button", {
      name: "Workstream: Platform › Auth (moved there by you)",
    });
    expect(button.textContent).toBe("Platform › Auth");
    fireEvent.click(button);
    const automatic = await screen.findByRole("button", { name: /^Automatic/ });
    expect(automatic.getAttribute("aria-pressed")).toBe("false");
    expect(automatic.textContent).toContain(
      "Workstreams chooses from your requests",
    );
    const chosen = screen.getByRole("button", { name: /^Platform › Auth/ });
    expect(chosen.getAttribute("aria-pressed")).toBe("true");
    slot.lifecycle.unmount();
  });

  it("defaults to Automatic and shows the classifier result below it", async () => {
    const slot = await mountTaskIdentity("t-auto");
    const button = await slot.findByRole("button", {
      name: "Workstream: Platform › Auth (automatic)",
    });
    fireEvent.click(button);
    const automatic = await screen.findByRole("button", { name: /^Automatic/ });
    expect(automatic.getAttribute("aria-pressed")).toBe("true");
    expect(automatic.textContent).toBe("AutomaticPlatform › Auth");
    expect(
      screen
        .getByRole("button", { name: /^Platform › Auth/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    slot.lifecycle.unmount();
  });

  it("shows No workstream when Workstreams found none", async () => {
    const slot = await mountTaskIdentity("t-unresolved-in-workstream");
    const button = await slot.findByRole("button", {
      name: "Workstream: No workstream (automatic)",
    });
    expect(button.className).toContain("ws-task-identity-none");
    fireEvent.click(button);
    const automatic = await screen.findByRole("button", { name: /^Automatic/ });
    expect(automatic.textContent).toBe("AutomaticNo workstream");
    slot.lifecycle.unmount();
  });

  it("shows a fork's parent workstream without letting it change", async () => {
    const slot = await mountTaskIdentity("t-child");
    const button = (await slot.findByRole("button", {
      name: "Workstream: Platform › Auth (follows its parent thread)",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).not.toContain("inherited");
    slot.lifecycle.unmount();
  });

  it("picking a workstream saves it as the user's choice", async () => {
    const rpcCalls: { method: string; args: unknown }[] = [];
    const slot = await mountTaskIdentity("t-auto", { rpcCalls });
    fireEvent.click(
      await slot.findByRole("button", { name: /^Workstream: Platform › Auth/ }),
    );
    fireEvent.change(screen.getByLabelText("Search workstreams"), {
      target: { value: "Payments" },
    });
    fireEvent.click(await screen.findByText("Platform › Billing"));
    await waitFor(() => {
      expect(rpcCalls).toEqual([
        {
          method: "threadMove",
          args: { threadId: "t-auto", workstreamId: "feat_billing" },
        },
      ]);
    });
    slot.lifecycle.unmount();
  });

  it("choosing Automatic hands the thread back to the classifier", async () => {
    const rpcCalls: { method: string; args: unknown }[] = [];
    const slot = await mountTaskIdentity("t-parent", { rpcCalls });
    fireEvent.click(
      await slot.findByRole("button", { name: /^Workstream: Platform › Auth/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Automatic/ }));
    await waitFor(() => {
      expect(rpcCalls).toEqual([
        { method: "threadAutomatic", args: { threadId: "t-parent" } },
      ]);
    });
    slot.lifecycle.unmount();
  });

  it("Automatic can't be chosen again while it's already on", async () => {
    const slot = await mountTaskIdentity("t-auto");
    fireEvent.click(
      await slot.findByRole("button", { name: /^Workstream: Platform › Auth/ }),
    );
    const automatic = (await screen.findByRole("button", {
      name: /^Automatic/,
    })) as HTMLButtonElement;
    expect(automatic.disabled).toBe(true);
    slot.lifecycle.unmount();
  });
});
