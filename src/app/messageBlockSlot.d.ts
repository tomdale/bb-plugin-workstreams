/**
 * Types for `app.slots.experimental_messageBlock`, which only the
 * tomdale/bb fork provides (its plugin SDK 0.6.100). Workstreams builds
 * against the published SDK, so it declares the slot here as optional and
 * feature-detects it at load: on upstream bb the slot is absent and the
 * reply block registers nothing. The shapes copy the fork's
 * `packages/plugin-sdk/src/app-contract.ts`.
 */
import type { ComponentType } from "react";
import type { Root as MdastRoot } from "mdast";
import type {
  JsonValue,
  PluginMessageDirectiveMessage,
} from "@get-bb/plugin-sdk/app";

export {};

declare module "@get-bb/plugin-sdk/app" {
  /** `streaming` until the closing line or the message's end; then `closed` or `unclosed`. */
  export type ExperimentalMessageBlockStatus =
    "streaming" | "closed" | "unclosed";

  export interface ExperimentalMessageBlockInput {
    attributes: Readonly<Record<string, string>>;
    source: string;
    tree: MdastRoot;
  }

  export interface ExperimentalMessageBlockParseContext {
    version: number;
    status: ExperimentalMessageBlockStatus;
  }

  export type ExperimentalMessageBlockParseResult =
    { ok: true; data: JsonValue } | { ok: false; error: string };

  export interface ExperimentalMessageBlockProps {
    data: JsonValue | null;
    error: string | null;
    status: ExperimentalMessageBlockStatus;
    source: string;
    index: number;
    message: PluginMessageDirectiveMessage;
    /** bb's own rendering of the block, as Markdown between its marker lines. */
    Original: ComponentType;
  }

  export interface ExperimentalMessageBlockRegistration {
    name: string;
    versions: readonly number[];
    parse(
      input: ExperimentalMessageBlockInput,
      context: ExperimentalMessageBlockParseContext,
    ): ExperimentalMessageBlockParseResult;
    toText(data: JsonValue): string;
    component: ComponentType<ExperimentalMessageBlockProps>;
  }

  export interface PluginAppSlots {
    /** Fork-only; absent on upstream bb. */
    experimental_messageBlock?: (
      registration: ExperimentalMessageBlockRegistration,
    ) => void;
  }
}
