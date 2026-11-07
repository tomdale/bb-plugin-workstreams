import { act, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";

/** Reads and closes a hint while the caller controls timeout timers. */
export async function hintText(target: HTMLElement): Promise<string | null> {
  fireEvent.pointerMove(target, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  const text = screen.getByRole("tooltip").textContent;
  fireEvent.pointerLeave(target, { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(200));
  return text;
}
