import { logger } from "../logger";
import type { ChromeLocalProviderStatus } from "../providers/chrome-local";
import { getTranslatorSettings } from "../settings/settings";
import { JournalTranslationService } from "./journal-service";
import { renderJournalTranslationView } from "./journal-translation-view";

type TranslationState = "idle" | "testing" | "success" | "error";

export class JournalTranslationApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-translate-journal",
    classes: ["foundry-translate", "foundry-translate-journal-window"],
    position: { width: 620, height: "auto" },
    window: {
      icon: "fa-solid fa-book-open-reader",
      title: "FOUNDRY_TRANSLATE.JournalTranslation.WindowTitle",
      resizable: false,
    },
  };

  protected async _renderHTML(): Promise<HTMLFormElement> {
    const journals = [...game.journal.contents].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    return renderJournalTranslationView({ journals, settings: getTranslatorSettings() });
  }

  protected _replaceHTML(result: HTMLFormElement, content: HTMLElement): void {
    content.replaceChildren(result);
  }

  protected async _onRender(): Promise<void> {
    this.element
      .querySelector<HTMLFormElement>("form.ft-journal-translation")
      ?.addEventListener("submit", (event) => void this.#translate(event));
  }

  async #translate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const button = form.querySelector<HTMLButtonElement>("button[type='submit']");
    const journalId = String(new FormData(form).get("journalId") ?? "");
    const journal = game.journal.contents.find(({ id }) => id === journalId);
    if (!journal) {
      this.#setStatus("error", "FOUNDRY_TRANSLATE.JournalTranslation.Status.Missing");
      return;
    }

    button?.setAttribute("disabled", "");
    this.#setStatus("testing", "FOUNDRY_TRANSLATE.JournalTranslation.Status.Preparing");
    try {
      const service = new JournalTranslationService({
        onChromeStatus: (status) => this.#setChromeStatus(status),
        onProgress: (progress) => {
          const message = game.i18n
            .localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.Progress")
            .replace("{current}", String(progress.completedPages))
            .replace("{total}", String(progress.totalPages))
            .replace("{page}", progress.pageName);
          this.#setStatus("testing", message, false);
        },
      });
      const result = await service.translate(journal);
      const template = game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.Done");
      const message = template
        .replace("{pages}", String(result.translatedTextPages))
        .replace("{skipped}", String(result.skippedTextPages));
      this.#setStatus("success", message, false);
      ui.notifications.success(message);
      result.document.sheet?.render(true);
    } catch (error) {
      logger.error("Journal translation failed.", error);
      this.#setStatus(
        "error",
        error instanceof Error
          ? error.message
          : game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.Error"),
        false,
      );
    } finally {
      button?.removeAttribute("disabled");
    }
  }

  #setChromeStatus(status: ChromeLocalProviderStatus): void {
    if (status.phase === "download") {
      const message = game.i18n
        .localize("FOUNDRY_TRANSLATE.Settings.Status.DownloadingChrome")
        .replace("{progress}", String(Math.round(status.progress * 100)));
      this.#setStatus("testing", message, false);
    } else if (status.phase === "ready") {
      this.#setStatus("testing", "FOUNDRY_TRANSLATE.JournalTranslation.Status.Translating");
    }
  }

  #setStatus(state: TranslationState, message: string, localize = true): void {
    const status = this.element.querySelector<HTMLElement>(".ft-connection-status");
    const text = status?.querySelector<HTMLElement>("[data-status-text]");
    if (!status || !text) return;
    status.dataset.state = state;
    text.textContent = localize ? game.i18n.localize(message) : message;
  }
}
