import type { ProviderId, TranslatorSettings } from "./settings";

function localize(key: string): string {
  return game.i18n.localize(key);
}

export function updateProviderFields(form: HTMLFormElement, provider: ProviderId): void {
  for (const element of form.querySelectorAll<HTMLElement>("[data-provider-only]")) {
    element.hidden = element.dataset.providerOnly !== provider;
  }
}

export function renderTranslatorSettingsForm(
  settings: TranslatorSettings,
): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "ft-settings";
  form.autocomplete = "off";
  form.innerHTML = `
    <header class="ft-settings__intro">
      <span class="ft-settings__brand-icon" aria-hidden="true">
        <i class="fa-solid fa-language"></i>
      </span>
      <div>
        <h2>${localize("FOUNDRY_TRANSLATE.Settings.Heading")}</h2>
        <p>${localize("FOUNDRY_TRANSLATE.Settings.Intro")}</p>
      </div>
    </header>

    <div class="ft-settings__fields">
      <div class="ft-field">
        <label for="ft-provider">${localize("FOUNDRY_TRANSLATE.Settings.Provider.Name")}</label>
        <select id="ft-provider" name="provider">
          <option value="chrome-local">${localize("FOUNDRY_TRANSLATE.Settings.Provider.Chrome")}</option>
          <option value="google-cloud-basic">Google Cloud Translation — Basic v2</option>
        </select>
        <p class="ft-field__hint" data-provider-only="chrome-local">${localize("FOUNDRY_TRANSLATE.Settings.Provider.ChromeHint")}</p>
        <p class="ft-field__hint" data-provider-only="google-cloud-basic">${localize("FOUNDRY_TRANSLATE.Settings.Provider.GoogleHint")}</p>
      </div>

      <div class="ft-field" data-provider-only="google-cloud-basic">
        <label for="ft-api-key">${localize("FOUNDRY_TRANSLATE.Settings.ApiKey.Name")}</label>
        <div class="ft-secret-input">
          <input id="ft-api-key" name="apiKey" type="password" spellcheck="false" autocomplete="off">
          <button type="button" data-action="toggle-key" aria-pressed="false" title="${localize("FOUNDRY_TRANSLATE.Settings.ApiKey.Show")}">
            <i class="fa-solid fa-eye" aria-hidden="true"></i>
            <span class="sr-only">${localize("FOUNDRY_TRANSLATE.Settings.ApiKey.Show")}</span>
          </button>
        </div>
        <p class="ft-field__hint">${localize("FOUNDRY_TRANSLATE.Settings.ApiKey.Hint")}</p>
      </div>

      <div class="ft-settings__language-row">
        <div class="ft-field">
          <label for="ft-source-language">${localize("FOUNDRY_TRANSLATE.Settings.SourceLanguage.Name")}</label>
          <select id="ft-source-language" name="sourceLanguage">
            <option value="auto">${localize("FOUNDRY_TRANSLATE.Settings.SourceLanguage.Auto")}</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
            <option value="pl">Polski</option>
          </select>
        </div>

        <span class="ft-settings__language-arrow" aria-hidden="true">
          <i class="fa-solid fa-arrow-right"></i>
        </span>

        <div class="ft-field">
          <label for="ft-target-language">${localize("FOUNDRY_TRANSLATE.Settings.TargetLanguage.Name")}</label>
          <select id="ft-target-language" name="targetLanguage">
            <option value="cs">Čeština</option>
          </select>
        </div>
      </div>
    </div>

    <aside class="ft-settings__privacy" data-provider-only="chrome-local">
      <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
      <p>${localize("FOUNDRY_TRANSLATE.Settings.PrivacyChrome")}</p>
    </aside>

    <aside class="ft-settings__privacy" data-provider-only="google-cloud-basic">
      <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
      <p>${localize("FOUNDRY_TRANSLATE.Settings.PrivacyGoogle")}</p>
    </aside>

    <div class="ft-connection-status" data-state="idle" role="status" aria-live="polite">
      <span class="ft-connection-status__dot" aria-hidden="true"></span>
      <span data-status-text>${localize("FOUNDRY_TRANSLATE.Settings.Status.NotTested")}</span>
    </div>

    <footer class="ft-settings__actions">
      <a class="ft-settings__cloud-link" data-provider-only="chrome-local" href="https://developer.chrome.com/docs/ai/translator-api" target="_blank" rel="noreferrer">
        ${localize("FOUNDRY_TRANSLATE.Settings.OpenChromeHelp")}
        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
      </a>
      <a class="ft-settings__cloud-link" data-provider-only="google-cloud-basic" href="https://console.cloud.google.com/apis/library/translate.googleapis.com" target="_blank" rel="noreferrer">
        ${localize("FOUNDRY_TRANSLATE.Settings.OpenGoogleCloud")}
        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
      </a>
      <div>
        <button type="button" class="ft-button ft-button--secondary" data-action="test-connection">
          <i class="fa-solid fa-plug" aria-hidden="true"></i>
          <span>${localize("FOUNDRY_TRANSLATE.Settings.Test")}</span>
        </button>
        <button type="submit" class="ft-button ft-button--primary">
          <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
          <span>${localize("FOUNDRY_TRANSLATE.Settings.Save")}</span>
        </button>
      </div>
    </footer>
  `;

  const provider = form.elements.namedItem("provider");
  const apiKey = form.elements.namedItem("apiKey");
  const sourceLanguage = form.elements.namedItem("sourceLanguage");
  const targetLanguage = form.elements.namedItem("targetLanguage");

  if (provider instanceof HTMLSelectElement) provider.value = settings.provider;
  if (apiKey instanceof HTMLInputElement) apiKey.value = settings.apiKey;
  if (sourceLanguage instanceof HTMLSelectElement) sourceLanguage.value = settings.sourceLanguage;
  if (targetLanguage instanceof HTMLSelectElement) targetLanguage.value = settings.targetLanguage;

  updateProviderFields(form, settings.provider);
  return form;
}
