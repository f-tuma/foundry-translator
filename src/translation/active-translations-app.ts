import { MODULE_VERSION } from "../constants";
import {
  activeTranslations,
  estimateRemainingMs,
  formatRunLog,
  type ActiveTranslationRun,
} from "./active-translations";

function localize(key: string): string {
  return game.i18n.localize(key);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 90) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

function formatTokenSpeed(run: ActiveTranslationRun): string {
  if (run.providerTokensPerSecond !== undefined) {
    return `${run.providerTokensPerSecond.toFixed(1)} tok/s`;
  }
  if (!run.providerOutputTokens || !run.providerGenerationMs) return "—";
  return `${((run.providerOutputTokens * 1000) / run.providerGenerationMs).toFixed(1)} tok/s`;
}

function renderRun(run: ActiveTranslationRun, now: number): string {
  const stateKey = run.cancelRequested && run.finishedAt === undefined
    ? "FOUNDRY_TRANSLATE.ActiveTranslations.State.Cancelling"
    : {
        scanning: "FOUNDRY_TRANSLATE.ActiveTranslations.State.Scanning",
        translating: "FOUNDRY_TRANSLATE.ActiveTranslations.State.Translating",
        done: "FOUNDRY_TRANSLATE.ActiveTranslations.State.Done",
        error: "FOUNDRY_TRANSLATE.ActiveTranslations.State.Error",
        cancelled: "FOUNDRY_TRANSLATE.ActiveTranslations.State.Cancelled",
      }[run.state];
  const percent = run.plan?.totalUnits
    ? Math.min(100, Math.round((run.completedUnits / run.plan.totalUnits) * 100))
    : 0;
  const counts = run.plan
    ? localize("FOUNDRY_TRANSLATE.ActiveTranslations.Counts")
        .replace("{units}", String(run.completedUnits))
        .replace("{totalUnits}", String(run.plan.totalUnits))
        .replace("{documents}", String(run.completedDocuments))
        .replace("{totalDocuments}", String(run.plan.totalDocuments))
    : localize("FOUNDRY_TRANSLATE.ActiveTranslations.Scanning");
  const remaining = estimateRemainingMs(run, now);
  const eta = remaining === null
    ? ""
    : localize("FOUNDRY_TRANSLATE.ActiveTranslations.Eta")
        .replace("{eta}", formatDuration(remaining));
  const current = run.finishedAt === undefined && run.currentDocument
    ? `${escapeHtml(run.currentDocument)}${run.currentUnit ? ` — ${escapeHtml(run.currentUnit)}` : ""}`
    : "";
  const providerElapsed = run.providerRequestActive && run.providerRequestStartedAt !== undefined
    ? now - run.providerRequestStartedAt
    : run.providerGenerationMs ?? 0;
  const providerMetrics = run.providerRequestCount
    ? `<div class="ft-active-translations__metrics">
        <span><strong>${formatTokenSpeed(run)}</strong>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.Metrics.Speed")}</span>
        <span><strong>${run.providerOutputTokens ?? 0}</strong>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.Metrics.Output")}</span>
        <span><strong>${run.providerInputTokens ?? 0}</strong>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.Metrics.Input")}</span>
        <span><strong>${run.providerReasoningTokens ?? 0}</strong>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.Metrics.Reasoning")}</span>
        <span><strong>${run.providerRequestCount}</strong>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.Metrics.Requests")}</span>
        <span><strong>${formatDuration(providerElapsed)}</strong>${run.providerRequestActive
          ? localize("FOUNDRY_TRANSLATE.ActiveTranslations.Metrics.CurrentRequest")
          : localize("FOUNDRY_TRANSLATE.ActiveTranslations.Metrics.GenerationTime")}</span>
      </div>
      <span class="ft-active-translations__model">${escapeHtml(run.providerModel ?? "")}</span>
      ${run.providerRequestActive && run.providerOutputPreview
        ? `<div class="ft-active-translations__preview">
            <span>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.StreamPreview")}</span>
            <p>${escapeHtml(run.providerOutputPreview)}</p>
          </div>`
        : ""}`
    : "";
  const issues = run.issues.length
    ? localize("FOUNDRY_TRANSLATE.ActiveTranslations.Issues").replace("{count}", String(run.issues.length))
    : "";
  const copyLog = run.issues.length || run.error
    ? `<button type="button" class="ft-button ft-active-translations__copy" data-run-log="${run.id}">
        <i class="fa-solid fa-copy" aria-hidden="true"></i>
        <span>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.CopyLog")}</span>
      </button>`
    : "";
  const cancel = run.finishedAt === undefined
    ? `<button type="button" class="ft-button ft-active-translations__cancel" data-run-cancel="${run.id}" ${run.cancelRequested ? "disabled" : ""}>
        <i class="fa-solid fa-stop" aria-hidden="true"></i>
        <span>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.Cancel")}</span>
      </button>`
    : "";
  return `
    <li class="ft-active-translations__run" data-state="${run.state}">
      <div class="ft-active-translations__title">
        <strong>${escapeHtml(run.rootName)}</strong>
        <span class="ft-active-translations__state">${localize(stateKey)} · ${run.targetLanguage.toUpperCase()}</span>
      </div>
      <div class="ft-progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
        <div class="ft-progress__fill" style="width: ${run.state === "done" ? 100 : percent}%"></div>
      </div>
      <div class="ft-active-translations__detail">
        <span>${counts}${eta ? ` · ${eta}` : ""}${issues ? ` · ${issues}` : ""}</span>
        ${providerMetrics}
        ${run.error ? `<span class="ft-active-translations__error">${escapeHtml(run.error)}</span>` : ""}
        ${current ? `<span class="ft-active-translations__current">${current}</span>` : ""}
        <div class="ft-active-translations__actions">${cancel}${copyLog}</div>
      </div>
    </li>
  `;
}

let sharedInstance: ActiveTranslationsApplication | undefined;

/** Opens (or focuses) the shared active-translations overview window. */
export function openActiveTranslationsOverview(): void {
  sharedInstance ??= new ActiveTranslationsApplication();
  void sharedInstance.render(true);
}

export class ActiveTranslationsApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-translate-active-translations",
    classes: ["foundry-translate", "foundry-translate-active-translations"],
    position: { width: 480, height: "auto" },
    window: {
      icon: "fa-solid fa-list-check",
      title: "FOUNDRY_TRANSLATE.ActiveTranslations.WindowTitle",
      resizable: false,
    },
  };

  #unsubscribe: (() => void) | undefined;
  #ticker: ReturnType<typeof setInterval> | undefined;

  protected async _renderHTML(): Promise<HTMLElement> {
    const runs = activeTranslations.list();
    const container = document.createElement("div");
    container.className = "ft-settings ft-active-translations";
    container.innerHTML = runs.length
      ? `<ul class="ft-active-translations__list">
          ${runs.map((run) => renderRun(run, Date.now())).join("")}
        </ul>`
      : `<p class="ft-active-translations__empty">${localize("FOUNDRY_TRANSLATE.ActiveTranslations.Empty")}</p>`;
    return container;
  }

  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void {
    content.replaceChildren(result);
  }

  protected _onRender(): void {
    this.#unsubscribe ??= activeTranslations.subscribe(() => void this.render());
    this.#ticker ??= setInterval(() => {
      if (activeTranslations.list().some(({ providerRequestActive }) => providerRequestActive)) {
        void this.render();
      }
    }, 1_000);
    for (const button of this.element.querySelectorAll<HTMLButtonElement>("[data-run-log]")) {
      button.addEventListener("click", () => {
        const run = activeTranslations.get(Number(button.dataset.runLog));
        if (!run) return;
        void navigator.clipboard.writeText(formatRunLog(run, MODULE_VERSION)).then(() => {
          ui.notifications.info(localize("FOUNDRY_TRANSLATE.ActiveTranslations.LogCopied"));
        });
      });
    }
    for (const button of this.element.querySelectorAll<HTMLButtonElement>("[data-run-cancel]")) {
      button.addEventListener("click", () => {
        activeTranslations.requestCancel(Number(button.dataset.runCancel));
      });
    }
  }

  override async close(options?: Record<string, unknown>): Promise<FoundryApplicationV2> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (this.#ticker !== undefined) clearInterval(this.#ticker);
    this.#ticker = undefined;
    return super.close(options);
  }
}
