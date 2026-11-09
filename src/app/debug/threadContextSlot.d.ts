/**
 * Types for `app.slots.experimental_threadInfoSection` and
 * `app.slots.experimental_threadContextCardSection`, which the published SDK
 * 0.6.5 predates. Workstreams builds against the published SDK, so it
 * declares the slots here as optional and feature-detects them at load: on
 * a bb build without them the debug section registers nothing. The bare
 * specifier stays external at build, so `experimental_InfoSection` resolves
 * against the host's SDK at runtime. The shapes copy the 0.6.132 SDK's
 * `app-contract.ts`.
 */
import type { ComponentType, ReactNode } from "react";

export {};

declare module "@get-bb/plugin-sdk/app" {
  /** Props passed to a thread Info tab or thread context card component. */
  export interface ExperimentalThreadContextCardProps {
    /**
     * The thread shown in the pane. Every thread pane of a split layout has
     * its own Info tab or context card, so the component mounts once per
     * visible thread; keep per-thread state in the component, never in a
     * module-level singleton.
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

  /** A section in the thread Info tab, below the details block. */
  export interface ExperimentalThreadInfoSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Sorts like the context card's sections. */
    group: string;
    order?: number;
    component: ComponentType<ExperimentalThreadContextCardProps>;
  }

  /** The section chrome bb's own Info tab sections use. */
  export interface ExperimentalInfoSectionProps {
    label: string;
    count?: number;
    accessory?: ReactNode;
    trailing?: ReactNode;
    children: ReactNode;
  }
  export const experimental_InfoSection: ComponentType<ExperimentalInfoSectionProps>;

  export interface PluginAppSlots {
    /** Absent on bb builds that predate the thread Info tab slots. */
    experimental_threadInfoSection?: (
      registration: ExperimentalThreadInfoSectionRegistration,
    ) => void;
    /** Absent on bb builds that predate the thread context card slots. */
    experimental_threadContextCardSection?: (
      registration: ExperimentalThreadContextCardSectionRegistration,
    ) => void;
  }
}
