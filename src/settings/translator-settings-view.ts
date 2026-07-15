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
          <option value="openai-compatible">${localize("FOUNDRY_TRANSLATE.Settings.Provider.OpenAI")}</option>
          <option value="google-cloud-basic">Google Cloud Translation — Basic v2</option>
        </select>
        <p class="ft-field__hint" data-provider-only="chrome-local">${localize("FOUNDRY_TRANSLATE.Settings.Provider.ChromeHint")}</p>
        <p class="ft-field__hint" data-provider-only="google-cloud-basic">${localize("FOUNDRY_TRANSLATE.Settings.Provider.GoogleHint")}</p>
        <p class="ft-field__hint" data-provider-only="openai-compatible">${localize("FOUNDRY_TRANSLATE.Settings.Provider.OpenAIHint")}</p>
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

      <div class="ft-settings__local-model" data-provider-only="openai-compatible">
        <div class="ft-field">
          <label for="ft-openai-base-url">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.BaseUrl")}</label>
          <input id="ft-openai-base-url" name="openAiBaseUrl" type="url" spellcheck="false" autocomplete="off" placeholder="http://localhost:1234">
          <p class="ft-field__hint">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.BaseUrlHint")}</p>
        </div>
        <div class="ft-field">
          <label for="ft-openai-model">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.Model")}</label>
          <input id="ft-openai-model" name="openAiModel" type="text" spellcheck="false" autocomplete="off" placeholder="google/translategemma-12b-it">
          <p class="ft-field__hint">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.ModelHint")}</p>
        </div>
        <div class="ft-field">
          <label for="ft-openai-api-key">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.ApiKey")}</label>
          <div class="ft-secret-input">
            <input id="ft-openai-api-key" name="openAiApiKey" type="password" spellcheck="false" autocomplete="off">
            <button type="button" data-action="toggle-openai-key" data-secret-target="openAiApiKey" aria-pressed="false" title="${localize("FOUNDRY_TRANSLATE.Settings.ApiKey.Show")}">
              <i class="fa-solid fa-eye" aria-hidden="true"></i>
              <span class="sr-only">${localize("FOUNDRY_TRANSLATE.Settings.ApiKey.Show")}</span>
            </button>
          </div>
          <p class="ft-field__hint">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.ApiKeyHint")}</p>
        </div>
        <div class="ft-field">
          <label for="ft-world-context">${localize("FOUNDRY_TRANSLATE.Settings.WorldContext.Name")}</label>
          <textarea id="ft-world-context" name="worldContext" rows="7" maxlength="6000" placeholder="${localize("FOUNDRY_TRANSLATE.Settings.WorldContext.Placeholder")}"></textarea>
          <p class="ft-field__hint">${localize("FOUNDRY_TRANSLATE.Settings.WorldContext.Hint")}</p>
          <button type="button" class="ft-button ft-button--secondary ft-settings__generate-context" data-action="generate-world-context">
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            <span>${localize("FOUNDRY_TRANSLATE.Settings.WorldContext.Generate")}</span>
          </button>
          <p class="ft-field__hint">${localize("FOUNDRY_TRANSLATE.Settings.WorldContext.GenerateHint")}</p>
        </div>
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

    <aside class="ft-settings__privacy" data-provider-only="openai-compatible">
      <i class="fa-solid fa-server" aria-hidden="true"></i>
      <p>${localize("FOUNDRY_TRANSLATE.Settings.PrivacyOpenAI")}</p>
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
      <a class="ft-settings__cloud-link" data-provider-only="openai-compatible" href="https://lmstudio.ai/docs/developer/openai-compat" target="_blank" rel="noreferrer">
        ${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.Help")}
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

  const provider = form.querySelector("[name='provider']");
  const apiKey = form.querySelector("[name='apiKey']");
  const sourceLanguage = form.querySelector("[name='sourceLanguage']");
  const targetLanguage = form.querySelector("[name='targetLanguage']");
  const openAiBaseUrl = form.querySelector("[name='openAiBaseUrl']");
  const openAiModel = form.querySelector("[name='openAiModel']");
  const openAiApiKey = form.querySelector("[name='openAiApiKey']");
  const worldContext = form.querySelector("[name='worldContext']");

  if (provider instanceof HTMLSelectElement) provider.value = settings.provider;
  if (apiKey instanceof HTMLInputElement) apiKey.value = settings.apiKey;
  if (sourceLanguage instanceof HTMLSelectElement) sourceLanguage.value = settings.sourceLanguage;
  if (targetLanguage instanceof HTMLSelectElement) targetLanguage.value = settings.targetLanguage;
  if (openAiBaseUrl instanceof HTMLInputElement) openAiBaseUrl.value = settings.openAiBaseUrl;
  if (openAiModel instanceof HTMLInputElement) openAiModel.value = settings.openAiModel;
  if (openAiApiKey instanceof HTMLInputElement) openAiApiKey.value = settings.openAiApiKey;
  if (worldContext instanceof HTMLTextAreaElement) worldContext.value = settings.worldContext;

  updateProviderFields(form, settings.provider);
  return form;
}
