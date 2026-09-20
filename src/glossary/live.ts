import { logger } from "../logger";
import type { NamingProgress } from "./name-analysis";
import type { GlossaryEntry } from "./types";

export interface GlossaryLiveState {
  entries?: readonly GlossaryEntry[];
  running: boolean;
  progress?: NamingProgress;
  status?: { state: "idle" | "testing" | "success" | "error"; message: string };
}

/** One feed for the glossary editor and preparation started by a translation. */
class GlossaryLiveUpdates {
  #state: GlossaryLiveState = { running: false };
  #revision = 0;
  readonly #listeners = new Set<(state: GlossaryLiveState) => void>();
  get state(): GlossaryLiveState { return this.#state; }
  get revision(): number { return this.#revision; }
  publish(update: Partial<GlossaryLiveState>): void {
    if (update.entries) this.#revision++;
    this.#state = { ...this.#state, ...update };
    for (const listener of this.#listeners) {
      try { listener(this.#state); }
      catch (error) { logger.warn("Glossary display could not refresh.", error); }
    }
  }
  subscribe(listener: (state: GlossaryLiveState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export const glossaryLive = new GlossaryLiveUpdates();
