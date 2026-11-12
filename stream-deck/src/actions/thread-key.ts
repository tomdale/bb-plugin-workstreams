import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { UpNextConnection, UpNextState } from "../connection.ts";
import {
  dataUrl,
  emptyKey,
  noticeKey,
  threadKey,
  upNextThreads,
} from "../render.ts";

type Settings = { position?: number | string };

/** Positions a key can take: Up Next's ten rows, then Show more's threads. */
export const POSITIONS = 20;

/** The key's 1-based position, or null when it hasn't been given one. */
export function positionOf(settings: Settings): number | null {
  const position = Number(settings.position);
  return Number.isInteger(position) && position >= 1 && position <= POSITIONS
    ? position
    : null;
}

/** The lowest position no other key holds, for a key just placed. */
export function firstFreePosition(taken: Iterable<number>): number {
  const used = new Set(taken);
  for (let position = 1; position < POSITIONS; position++)
    if (!used.has(position)) return position;
  return POSITIONS;
}

/** What a key at `position` draws in `state`. */
export function threadKeyImage(state: UpNextState, position: number): string {
  if (state.status === "connecting") return emptyKey();
  if (state.status !== "ready") return noticeKey(state.status);
  const thread = upNextThreads(state.snapshot)[position - 1];
  return thread ? threadKey(thread) : emptyKey();
}

type Key = { action: KeyAction<Settings>; position: number; image: string };

/**
 * A key showing one Up Next thread by position; pressing it opens that
 * thread in BB. A key placed without a position takes the first one free, so
 * a row of new keys lists Up Next in order.
 */
@action({ UUID: "com.tomdale.bb-workstreams.thread" })
export class ThreadKey extends SingletonAction<Settings> {
  private readonly keys = new Map<string, Key>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly connection: UpNextConnection) {
    super();
  }

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const saved = positionOf(ev.payload.settings);
    // Claimed before saving, so keys appearing together take different ones.
    const position =
      saved ??
      firstFreePosition([...this.keys.values()].map((key) => key.position));
    this.keys.set(ev.action.id, { action: ev.action, position, image: "" });
    this.unsubscribe ??= this.connection.subscribe(() => this.drawAll());
    this.draw(ev.action.id);
    if (saved === null) await ev.action.setSettings({ position });
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.keys.delete(ev.action.id);
    if (this.keys.size > 0) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    const key = this.keys.get(ev.action.id);
    if (!key) return;
    key.position = positionOf(ev.payload.settings) ?? key.position;
    this.draw(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const state = this.connection.current;
    const position = this.keys.get(ev.action.id)?.position;
    if (state.status !== "ready" || position === undefined) return;
    const thread = upNextThreads(state.snapshot)[position - 1];
    if (thread && !(await this.connection.open(thread.id)))
      await ev.action.showAlert();
  }

  private drawAll(): void {
    for (const id of this.keys.keys()) this.draw(id);
  }

  private draw(id: string): void {
    const key = this.keys.get(id);
    if (!key) return;
    const image = threadKeyImage(this.connection.current, key.position);
    if (image === key.image) return;
    key.image = image;
    void key.action.setImage(dataUrl(image));
  }
}
