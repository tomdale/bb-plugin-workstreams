/**
 * The spend guard: enforces the hard caps in Settings → Usage and reports
 * which warnings and caps are reached (see `evaluateLimits`). A reached cap
 * pauses every Workstreams model call by making `admit` throw
 * `SpendCapError`; nothing is throttled below the cap.
 *
 * SKELETON: the lead fixed these signatures so the ledger, monitor, report,
 * and Settings can be built in parallel. Keep them; fill in the bodies.
 */
import type { Prefs } from "../domain/prefs.ts";
import type { SpendState, UsageSource } from "../domain/usage.ts";
import type { Database } from "./db.ts";
import { UserError } from "./service.ts";
import type { UsageReader } from "./usage.ts";

/** A model call refused because a hard cap is reached. Nothing was spent. */
export class SpendCapError extends UserError {
  constructor(
    message: string,
    readonly state: SpendState,
  ) {
    super(message);
    this.name = "SpendCapError";
  }
}

export class SpendGuard {
  constructor(
    private readonly deps: {
      /** Holds resumes, so a restart does not end one. */
      db: Database;
      ledger: UsageReader;
      /** Read on every check, so a change in Settings applies at once. */
      prefs: () => Prefs["usage"];
      now?: () => number;
      /** Fires when the overall level changes (ok, warning, capped). */
      onChange?: (state: SpendState) => void;
      log?: (message: string) => void;
    },
  ) {
    void this.deps;
  }

  /** Throws `SpendCapError` while a cap that has not been resumed is reached. */
  admit(_source: UsageSource): void {
    throw new Error("SpendGuard.admit is not implemented.");
  }

  /**
   * Re-evaluates after a row is recorded or the limits changed, firing
   * `onChange` on a level change and `onLift` listeners when calls resume.
   */
  observe(): void {
    throw new Error("SpendGuard.observe is not implemented.");
  }

  status(): SpendState {
    throw new Error("SpendGuard.status is not implemented.");
  }

  /**
   * Lets calls through past every cap reached now, until its window resets
   * (`windowResetsAt`; an hour for the rolling hour). Warnings still show.
   */
  resume(): SpendState {
    throw new Error("SpendGuard.resume is not implemented.");
  }

  /**
   * Listens for the moment a pause ends: a resume, a window rolling over, or a
   * limit changed to clear it. Work that a cap deferred restarts from here.
   * Returns a function that removes the listener.
   */
  onLift(_listener: () => void): () => void {
    throw new Error("SpendGuard.onLift is not implemented.");
  }

  dispose(): void {}
}
