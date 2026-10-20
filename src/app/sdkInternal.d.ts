/**
 * Types for SDK members that bb still ships at runtime but marks `@internal`,
 * so SDK builds from 0.6.60 on leave them out of their published types.
 * Workstreams still uses the sidebar thread actions, and its tests read the
 * calls the test host records for them. The declarations copy bb's
 * `packages/plugin-sdk/src/app-contract.ts` and `src/testing/app.tsx`; they
 * merge with the SDK's own where an older SDK still exports them.
 */
export {};

declare module "@get-bb/plugin-sdk/app" {
  export interface PluginSidebarThreadActions {
    open(threadId: string, options?: { split?: boolean }): void;
    openNewThread(options?: {
      projectId?: string;
      sectionId?: string;
      experimental_placement?: { sectionId: string | null; pinned: boolean };
      environmentId?: string;
      hostId?: string;
      focusPrompt?: boolean;
    }): void;
    setPinned(threadId: string, pinned: boolean): Promise<void>;
    setRead(threadId: string, read: boolean): Promise<void>;
    rename(threadId: string, title: string): Promise<void>;
    archive(threadId: string): void;
    experimental_archiveEnvironmentThreads(
      environmentId: string,
    ): Promise<void>;
    requestDelete(threadId: string): void;
  }
  export function experimental_useSidebarThreadActions(): PluginSidebarThreadActions;
}

declare module "@get-bb/plugin-sdk/testing/app" {
  export interface SidebarActionCall {
    method: keyof import("@get-bb/plugin-sdk/app").PluginSidebarThreadActions;
    threadId?: string;
    environmentId?: string;
    options?: Record<string, unknown>;
    title?: string;
    pinned?: boolean;
    read?: boolean;
  }
  export interface RenderedSlotInspectionState {
    readonly sidebarActionCalls: SidebarActionCall[];
  }
}
