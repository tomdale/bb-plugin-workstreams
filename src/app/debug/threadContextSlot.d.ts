/**
 * Types for `app.slots.experimental_threadContextCardSection`, which the
 * published SDK 0.6.5 predates. Workstreams builds against the published
 * SDK, so it declares the slot here as optional and feature-detects it at
 * load: on a bb build without the slot the debug section registers nothing.
 * The shapes copy the 0.6.132 SDK's `app-contract.ts`.
 */
import type { ComponentType } from "react";

export {};

declare module "@get-bb/plugin-sdk/app" {
  /** Props passed to an `experimental_threadContextCardSection` component. */
  export interface ExperimentalThreadContextCardProps {
    /**
     * The thread shown in the pane. Every thread pane of a split layout has
     * its own thread context card, so the component mounts once per visible
     * thread; keep per-thread state in the component, never in a module-level
     * singleton.
     */
    threadId: string;
    projectId: string;
    /** The thread's environment; null only when the thread has none. */
    environment: unknown;
  }

  /** A titled section of the thread context card, below its rows. */
  export interface ExperimentalThreadContextCardSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Heading bb draws above the section's rows. */
    title: string;
    /**
     * Sections sort by `group` (string compare), then by `order` within a
     * group (unset sorts last), then by registration order, with bb's own
     * sections first on a tie.
     */
    group: string;
    order?: number;
    component: ComponentType<ExperimentalThreadContextCardProps>;
  }

  export interface PluginAppSlots {
    /** Absent on bb builds that predate the thread context card slots. */
    experimental_threadContextCardSection?: (
      registration: ExperimentalThreadContextCardSectionRegistration,
    ) => void;
  }
}
