export interface TranslationPlan {
  totalDocuments: number;
  totalUnits: number;
}

export type ActiveTranslationState = "scanning" | "translating" | "done" | "error";

export interface ActiveTranslationRun {
  id: number;
  rootName: string;
  targetLanguage: string;
  startedAt: number;
  finishedAt?: number;
  state: ActiveTranslationState;
  plan?: TranslationPlan;
  completedUnits: number;
  completedDocuments: number;
  currentDocument?: string;
  currentUnit?: string;
  error?: string;
}

const FINISHED_RUN_RETENTION_MS = 10 * 60 * 1000;

export class ActiveTranslationRegistry {
  #runs = new Map<number, ActiveTranslationRun>();
  #listeners = new Set<() => void>();
  #nextId = 1;
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  start(rootName: string, targetLanguage: string): number {
    const now = this.#now();
    for (const [id, run] of this.#runs) {
      if (run.finishedAt !== undefined && now - run.finishedAt > FINISHED_RUN_RETENTION_MS) {
        this.#runs.delete(id);
      }
    }
    const id = this.#nextId++;
    this.#runs.set(id, {
      id,
      rootName,
      targetLanguage,
      startedAt: now,
      state: "scanning",
      completedUnits: 0,
      completedDocuments: 0,
    });
    this.#notify();
    return id;
  }

  update(
    id: number,
    patch: Partial<Omit<ActiveTranslationRun, "id" | "startedAt" | "finishedAt">>,
  ): void {
    const run = this.#runs.get(id);
    if (!run || run.finishedAt !== undefined) return;
    Object.assign(run, patch);
    this.#notify();
  }

  finish(id: number, error?: string): void {
    const run = this.#runs.get(id);
    if (!run || run.finishedAt !== undefined) return;
    run.finishedAt = this.#now();
    run.state = error === undefined ? "done" : "error";
    if (error !== undefined) run.error = error;
    this.#notify();
  }

  list(): readonly ActiveTranslationRun[] {
    return [...this.#runs.values()].sort((left, right) => left.startedAt - right.startedAt);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export function estimateRemainingMs(run: ActiveTranslationRun, now: number): number | null {
  if (!run.plan || run.completedUnits <= 0 || run.finishedAt !== undefined) return null;
  const remainingUnits = run.plan.totalUnits - run.completedUnits;
  if (remainingUnits <= 0) return null;
  return ((now - run.startedAt) / run.completedUnits) * remainingUnits;
}

export const activeTranslations = new ActiveTranslationRegistry();
