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

export function renderJournalTranslationView(
  data: JournalTranslationViewData,
): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "ft-settings ft-journal-translation";
  const providerName = localize(
    data.settings.provider === "chrome-local"
      ? "FOUNDRY_TRANSLATE.Settings.Provider.Chrome"
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
        <h2>${localize("FOUNDRY_TRANSLATE.JournalTranslation.Heading")}</h2>
        <p>${localize("FOUNDRY_TRANSLATE.JournalTranslation.Intro")}</p>
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
      <label for="ft-journal-source">${localize("FOUNDRY_TRANSLATE.JournalTranslation.Source")}</label>
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
      <p class="ft-field__hint">${localize("FOUNDRY_TRANSLATE.JournalTranslation.SourceHint")}</p>
    </div>

    <aside class="ft-settings__privacy">
      <i class="fa-solid fa-box-archive" aria-hidden="true"></i>
      <p>${localize("FOUNDRY_TRANSLATE.JournalTranslation.CopyHint")}</p>
    </aside>

    <aside class="ft-journal-translation__notice">
      <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
      <p>${localize("FOUNDRY_TRANSLATE.JournalTranslation.LimitHint")}</p>
    </aside>

    <div class="ft-connection-status" data-state="idle" role="status" aria-live="polite">
      <span class="ft-connection-status__dot" aria-hidden="true"></span>
      <span data-status-text>${localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.Ready")}</span>
    </div>

    <footer class="ft-settings__actions ft-journal-translation__actions">
      <span>${localize("FOUNDRY_TRANSLATE.JournalTranslation.CacheHint")}</span>
      <button type="submit" class="ft-button ft-button--primary" ${data.journals.length ? "" : "disabled"}>
        <i class="fa-solid fa-language" aria-hidden="true"></i>
        <span>${localize("FOUNDRY_TRANSLATE.JournalTranslation.Translate")}</span>
      </button>
    </footer>
  `;
  return form;
}
