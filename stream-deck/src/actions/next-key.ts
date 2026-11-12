import {
  action,
  SingletonAction,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { UpNextConnection, UpNextState } from "../connection.ts";
import { dataUrl, nextKey, noticeKey } from "../render.ts";

/** These actions have no settings of their own. */
type NoSettings = Record<string, never>;

export function nextKeyImage(state: UpNextState): string {
  if (state.status === "ready") return nextKey(state.snapshot);
  return state.status === "connecting"
    ? nextKey(null)
    : noticeKey(state.status);
}

/**
 * The next Up Next command on a key: pressing it opens the thread after the
 * one open in BB, wrapping to the top. The key counts the Up Next threads
 * that are unread or wait on you.
 */
@action({ UUID: "com.tomdale.bb-workstreams.next" })
export class NextKey extends SingletonAction<NoSettings> {
  private readonly keys = new Map<
    string,
    { action: KeyAction<NoSettings>; image: string }
  >();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly connection: UpNextConnection) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<NoSettings>): void {
    if (!ev.action.isKey()) return;
    this.keys.set(ev.action.id, { action: ev.action, image: "" });
    this.unsubscribe ??= this.connection.subscribe(() => this.drawAll());
    this.drawAll();
  }

  override onWillDisappear(ev: WillDisappearEvent<NoSettings>): void {
    this.keys.delete(ev.action.id);
    if (this.keys.size > 0) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  override async onKeyDown(ev: KeyDownEvent<NoSettings>): Promise<void> {
    if (!(await this.connection.next())) await ev.action.showAlert();
  }

  private drawAll(): void {
    const image = nextKeyImage(this.connection.current);
    for (const key of this.keys.values()) {
      if (image === key.image) continue;
      key.image = image;
      void key.action.setImage(dataUrl(image));
    }
  }
}
