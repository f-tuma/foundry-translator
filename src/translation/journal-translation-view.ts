import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import type { TranslatorSettings } from "../settings/settings";

export interface JournalTranslationViewData {
  journals: readonly FoundryJournalWorldDocument[];
  settings: TranslatorSettings;
}

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

const help = (key: string, topic: string) => renderHelpTooltip(localize(key), localize(topic));

export function renderJournalTranslationView(
  data: JournalTranslationViewData,
): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "ft-settings ft-journal-translation";
  const providerName = localize(
    data.settings.provider === "chrome-local"
      ? "FOUNDRY_TRANSLATE.Settings.Provider.Chrome"
      : data.settings.provider === "openai-compatible"
        ? "FOUNDRY_TRANSLATE.JournalTranslation.OpenAIProvider"
        : "FOUNDRY_TRANSLATE.JournalTranslation.GoogleProvider",
  );
  const sourceLanguage =
    data.settings.sourceLanguage === "auto"
      ? localize("FOUNDRY_TRANSLATE.Settings.SourceLanguage.Auto")
      : data.settings.sourceLanguage.toUpperCase();

  form.innerHTML = `
    <header class="ft-settings__intro">
      <span class="ft-settings__brand-icon" aria-hidden="true">
        <i class="fa-solid fa-book-open-reader"></i>
      </span>
      <div>
        <div class="ft-heading-with-help"><h2>${localize("FOUNDRY_TRANSLATE.JournalTranslation.Heading")}</h2>${renderHelpTooltip(
          ["Intro", "CopyHint", "LimitHint"].map((key) => localize(`FOUNDRY_TRANSLATE.JournalTranslation.${key}`)).join("\n\n"),
          localize("FOUNDRY_TRANSLATE.JournalTranslation.Heading"),
        )}</div>
      </div>
    </header>

    <div class="ft-journal-translation__provider">
      <i class="fa-solid fa-language" aria-hidden="true"></i>
      <div>
        <span>${escapeHtml(providerName)}</span>
        <small>${escapeHtml(sourceLanguage)} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${data.settings.targetLanguage.toUpperCase()}</small>
      </div>
    </div>

    <div class="ft-field">
      <div class="ft-field__label"><label for="ft-journal-source">${localize("FOUNDRY_TRANSLATE.JournalTranslation.Source")}</label>${help("FOUNDRY_TRANSLATE.JournalTranslation.SourceHint", "FOUNDRY_TRANSLATE.JournalTranslation.Source")}</div>
      <select id="ft-journal-source" name="journalId" ${data.journals.length ? "" : "disabled"}>
        ${
          data.journals.length
            ? data.journals
                .map(
                  (journal) =>
                    `<option value="${escapeHtml(journal.id ?? "")}">${escapeHtml(journal.name)}</option>`,
                )
                .join("")
            : `<option value="">${localize("FOUNDRY_TRANSLATE.JournalTranslation.Empty")}</option>`
        }
      </select>
    </div>

    <div class="ft-connection-status" data-state="idle" role="status" aria-live="polite">
      <span class="ft-connection-status__dot" aria-hidden="true"></span>
      <span data-status-text>${localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.Ready")}</span>
    </div>

    <footer class="ft-settings__actions ft-journal-translation__actions">
      <div class="ft-help-row"><span>${localize("FOUNDRY_TRANSLATE.JournalTranslation.Scope")}</span>${help("FOUNDRY_TRANSLATE.JournalTranslation.CacheHint", "FOUNDRY_TRANSLATE.JournalTranslation.Heading")}</div>
      <button type="submit" class="ft-button ft-button--primary" ${data.journals.length ? "" : "disabled"}>
        <i class="fa-solid fa-language" aria-hidden="true"></i>
        <span>${localize("FOUNDRY_TRANSLATE.JournalTranslation.Translate")}</span>
      </button>
    </footer>
  `;
  activateHelpTooltips(form);
  return form;
}
