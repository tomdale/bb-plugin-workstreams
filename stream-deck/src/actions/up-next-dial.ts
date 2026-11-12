import {
  action,
  SingletonAction,
  type DialAction,
  type DialDownEvent,
  type DialRotateEvent,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { StreamDeckThread } from "../../../src/domain/streamDeck.ts";
import type { UpNextConnection } from "../connection.ts";
import { dataUrl, dialNotice, dialStrip, upNextThreads } from "../render.ts";

/** These actions have no settings of their own. */
type NoSettings = Record<string, never>;

/** How long a turned dial stays put before it returns to the top. */
export const DIAL_RETURN_MS = 20_000;

/**
 * Where a dial points: the thread it was turned to, while that thread is
 * still in Up Next, else the same place in the list. Null `selected` is
 * the top.
 */
export function dialIndex(
  threads: readonly StreamDeckThread[],
  selected: string | null,
  previous: number,
): number {
  if (threads.length === 0) return 0;
  if (selected === null) return 0;
  const found = threads.findIndex((thread) => thread.id === selected);
  return found >= 0 ? found : Math.min(previous, threads.length - 1);
}

type Dial = {
  action: DialAction<NoSettings>;
  selected: string | null;
  index: number;
  image: string;
  returnTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Up Next on a Stream Deck + dial: the touch strip shows one thread, turning
 * moves through the list, and pressing the dial or tapping the strip opens
 * the thread in BB. Left alone, the dial returns to the top of Up Next.
 */
@action({ UUID: "com.tomdale.bb-workstreams.dial" })
export class UpNextDial extends SingletonAction<NoSettings> {
  private readonly dials = new Map<string, Dial>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly connection: UpNextConnection) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<NoSettings>): void {
    if (!ev.action.isDial()) return;
    this.dials.set(ev.action.id, {
      action: ev.action,
      selected: null,
      index: 0,
      image: "",
      returnTimer: null,
    });
    this.unsubscribe ??= this.connection.subscribe(() => this.drawAll());
    this.draw(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<NoSettings>): void {
    const dial = this.dials.get(ev.action.id);
    if (dial?.returnTimer) clearTimeout(dial.returnTimer);
    this.dials.delete(ev.action.id);
    if (this.dials.size > 0) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  override onDialRotate(ev: DialRotateEvent<NoSettings>): void {
    const dial = this.dials.get(ev.action.id);
    const threads = this.threads();
    if (!dial || threads.length === 0) return;
    const at = dialIndex(threads, dial.selected, dial.index);
    const index = Math.min(
      threads.length - 1,
      Math.max(0, at + ev.payload.ticks),
    );
    dial.selected = threads[index]!.id;
    if (dial.returnTimer) clearTimeout(dial.returnTimer);
    dial.returnTimer = setTimeout(() => {
      dial.returnTimer = null;
      dial.selected = null;
      this.draw(ev.action.id);
    }, DIAL_RETURN_MS);
    this.draw(ev.action.id);
  }

  override onDialDown(ev: DialDownEvent<NoSettings>): Promise<void> {
    return this.open(ev.action.id);
  }

  override onTouchTap(ev: TouchTapEvent<NoSettings>): Promise<void> {
    return this.open(ev.action.id);
  }

  private threads(): readonly StreamDeckThread[] {
    const state = this.connection.current;
    return state.status === "ready" ? upNextThreads(state.snapshot) : [];
  }

  private async open(id: string): Promise<void> {
    const dial = this.dials.get(id);
    const threads = this.threads();
    const thread =
      dial && threads[dialIndex(threads, dial.selected, dial.index)];
    if (!dial || !thread) return;
    if (await this.connection.open(thread.id)) {
      // Opening it is the end of browsing: the next look starts at the top.
      if (dial.returnTimer) clearTimeout(dial.returnTimer);
      dial.returnTimer = null;
      dial.selected = null;
      this.draw(id);
    } else await dial.action.showAlert();
  }

  private drawAll(): void {
    for (const id of this.dials.keys()) this.draw(id);
  }

  private draw(id: string): void {
    const dial = this.dials.get(id);
    if (!dial) return;
    const state = this.connection.current;
    let image: string;
    if (state.status === "ready") {
      const threads = upNextThreads(state.snapshot);
      dial.index = dialIndex(threads, dial.selected, dial.index);
      image = dialStrip(threads, dial.index);
    } else image = dialNotice(state.status);
    if (image === dial.image) return;
    dial.image = image;
    void dial.action.setFeedback({ canvas: dataUrl(image) });
  }
}
