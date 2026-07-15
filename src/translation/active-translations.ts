export interface TranslationPlan {
  totalDocuments: number;
  totalUnits: number;
}

export type ActiveTranslationState =
  | "scanning"
  | "translating"
  | "done"
  | "error"
  | "cancelled";

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
  /** Set by the UI; the service stops at the next safe point. */
  cancelRequested?: boolean;
  providerModel?: string;
  providerRequestCount?: number;
  providerRequestActive?: boolean;
  providerRequestStartedAt?: number;
  providerInputTokens?: number;
  providerOutputTokens?: number;
  providerReasoningTokens?: number;
  providerGenerationMs?: number;
  providerTokensPerSecond?: number;
  providerFinishReason?: string;
  providerStreamedCharacters?: number;
  providerBatchFallbacks?: number;
  providerSequentialFallbackTexts?: number;
  providerResponseRetries?: number;
  providerNativeFallbacks?: number;
  /** Stored root Journal checkpoint available for live reading. */
  translatedDocumentUuid?: string;
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

  recordProviderMetrics(
    id: number,
    metrics: import("../providers/types").ProviderRequestMetrics,
  ): void {
    const run = this.#runs.get(id);
    if (!run || run.finishedAt !== undefined) return;
    run.providerModel = metrics.model;
    if (metrics.phase === "started") {
      run.providerRequestCount = (run.providerRequestCount ?? 0) + 1;
      run.providerRequestActive = true;
      run.providerRequestStartedAt = this.#now();
      delete run.providerStreamedCharacters;
    } else if (metrics.phase === "progress") {
      run.providerRequestActive = true;
      if (metrics.streamedCharacters !== undefined) {
        run.providerStreamedCharacters = metrics.streamedCharacters;
      }
      // The overview has its own one-second ticker. Avoid re-rendering the
      // entire Foundry window for every SSE chunk, which made the UI flicker.
      return;
    } else if (metrics.phase === "diagnostic") {
      run.providerBatchFallbacks = (run.providerBatchFallbacks ?? 0) +
        (metrics.batchFallbacks ?? 0);
      run.providerSequentialFallbackTexts = (run.providerSequentialFallbackTexts ?? 0) +
        (metrics.sequentialFallbackTexts ?? 0);
      run.providerResponseRetries = (run.providerResponseRetries ?? 0) +
        (metrics.responseRetries ?? 0);
      run.providerNativeFallbacks = (run.providerNativeFallbacks ?? 0) +
        (metrics.nativeFallbacks ?? 0);
    } else {
      run.providerRequestActive = false;
      delete run.providerRequestStartedAt;
      run.providerInputTokens = (run.providerInputTokens ?? 0) + (metrics.inputTokens ?? 0);
      run.providerOutputTokens = (run.providerOutputTokens ?? 0) + (metrics.outputTokens ?? 0);
      run.providerReasoningTokens = (run.providerReasoningTokens ?? 0) + (metrics.reasoningTokens ?? 0);
      run.providerGenerationMs = (run.providerGenerationMs ?? 0) + (metrics.durationMs ?? 0);
      if (metrics.tokensPerSecond !== undefined) {
        run.providerTokensPerSecond = metrics.tokensPerSecond;
      }
      if (metrics.finishReason) run.providerFinishReason = metrics.finishReason;
    }
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

  requestCancel(id: number): void {
    const run = this.#runs.get(id);
    if (!run || run.finishedAt !== undefined || run.cancelRequested) return;
    run.cancelRequested = true;
    this.#notify();
  }

  isCancelRequested(id: number): boolean {
    return this.#runs.get(id)?.cancelRequested === true;
  }

  finishCancelled(id: number): void {
    const run = this.#runs.get(id);
    if (!run || run.finishedAt !== undefined) return;
    run.finishedAt = this.#now();
    run.state = "cancelled";
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
      return issue.detail ??
        "The dependent document failed to translate; its references stay at the source.";
    default:
      return issue.detail ?? null;
  }
}

/** Builds a plain-text, copy-friendly debug log for a translation run. */
export function formatRunLog(run: ActiveTranslationRun, moduleVersion: string): string {
  const loggedState = run.state === "done" && run.issues.length
    ? "done-with-issues"
    : run.state;
  const lines: string[] = [
    `Foundry Translate ${moduleVersion} — translation log`,
    `Document: ${run.rootName} -> ${run.targetLanguage}`,
    `State: ${loggedState}${run.error ? ` (${run.error})` : ""}`,
    `Started: ${new Date(run.startedAt).toISOString()}`,
    ...(run.finishedAt ? [`Finished: ${new Date(run.finishedAt).toISOString()}`] : []),
    ...(run.plan
      ? [`Scope: ${run.plan.totalDocuments} documents, ${run.plan.totalUnits} units; completed ${run.completedUnits} units in ${run.completedDocuments} documents`]
      : []),
    ...(run.providerRequestCount
      ? [`Provider: ${run.providerModel ?? "unknown"}; ${run.providerRequestCount} requests; ${run.providerInputTokens ?? 0} input tokens; ${run.providerOutputTokens ?? 0} output tokens; ${run.providerReasoningTokens ?? 0} reasoning tokens; ${run.providerGenerationMs ?? 0} ms`]
      : []),
    ...(run.providerBatchFallbacks || run.providerResponseRetries || run.providerNativeFallbacks
      ? [`Provider fallbacks: ${run.providerBatchFallbacks ?? 0} malformed batches; ${run.providerSequentialFallbackTexts ?? 0} texts sent sequentially; ${run.providerResponseRetries ?? 0} response retries; ${run.providerNativeFallbacks ?? 0} native API fallbacks`]
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
