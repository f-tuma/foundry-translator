export interface TranslationPlan {
  totalDocuments: number;
  totalUnits: number;
}

export type ActiveTranslationState = "scanning" | "translating" | "done" | "error";

export interface TranslationRunIssue {
  type: "fallback" | "unresolved" | "unsupported" | "failed";
  documentName?: string;
  documentType?: string;
  sourceUuid?: string;
  parentUuid?: string;
  reason?: string;
  detail?: string;
  sourcePreview?: string;
  attempts?: number;
  occurrences?: number;
}

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
  issues: TranslationRunIssue[];
  /** Issues beyond the per-run cap are counted instead of stored. */
  droppedIssues?: number;
}

const FINISHED_RUN_RETENTION_MS = 10 * 60 * 1000;
const MAX_ISSUES_PER_RUN = 500;

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
      issues: [],
    });
    this.#notify();
    return id;
  }

  addIssue(id: number, issue: TranslationRunIssue): void {
    const run = this.#runs.get(id);
    if (!run) return;
    if (run.issues.length >= MAX_ISSUES_PER_RUN) {
      run.droppedIssues = (run.droppedIssues ?? 0) + 1;
      return;
    }
    run.issues.push(issue);
    this.#notify();
  }

  get(id: number): ActiveTranslationRun | undefined {
    return this.#runs.get(id);
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

function issueDescription(issue: TranslationRunIssue): string | null {
  switch (issue.type) {
    case "unresolved":
      return "The reference could not be resolved; it stays pointing at the source.";
    case "unsupported":
      return `Recursive translation of ${issue.documentType ?? "this"} documents is not supported yet; the reference stays at the source.`;
    case "failed":
      return "The dependent document failed to translate; its references stay at the source.";
    default:
      return issue.detail ?? null;
  }
}

/** Builds a plain-text, copy-friendly debug log for a translation run. */
export function formatRunLog(run: ActiveTranslationRun, moduleVersion: string): string {
  const lines: string[] = [
    `Foundry Translate ${moduleVersion} — translation log`,
    `Document: ${run.rootName} -> ${run.targetLanguage}`,
    `State: ${run.state}${run.error ? ` (${run.error})` : ""}`,
    `Started: ${new Date(run.startedAt).toISOString()}`,
    ...(run.finishedAt ? [`Finished: ${new Date(run.finishedAt).toISOString()}`] : []),
    ...(run.plan
      ? [`Scope: ${run.plan.totalDocuments} documents, ${run.plan.totalUnits} units; completed ${run.completedUnits} units in ${run.completedDocuments} documents`]
      : []),
    `Issues: ${run.issues.length}${run.droppedIssues ? ` (+${run.droppedIssues} more were not recorded)` : ""}`,
  ];
  run.issues.forEach((issue, index) => {
    const type = issue.documentType ? `${issue.type}:${issue.documentType}` : issue.type;
    const parts = [
      `${index + 1}. [${type}]`,
      issue.documentName ?? issue.sourceUuid ?? "",
      issue.reason ? `reason=${issue.reason}` : "",
      issue.attempts !== undefined ? `attempts=${issue.attempts}` : "",
      issue.occurrences !== undefined ? `occurrences=${issue.occurrences}` : "",
      issue.parentUuid ? `in=${issue.parentUuid}` : "",
    ].filter(Boolean);
    lines.push(parts.join(" "));
    if (issue.sourcePreview) lines.push(`   source: ${issue.sourcePreview}`);
    const description = issueDescription(issue);
    if (description) lines.push(`   detail: ${description}`);
  });
  return lines.join("\n");
}

export function estimateRemainingMs(run: ActiveTranslationRun, now: number): number | null {
  if (!run.plan || run.completedUnits <= 0 || run.finishedAt !== undefined) return null;
  const remainingUnits = run.plan.totalUnits - run.completedUnits;
  if (remainingUnits <= 0) return null;
  return ((now - run.startedAt) / run.completedUnits) * remainingUnits;
}

export const activeTranslations = new ActiveTranslationRegistry();
