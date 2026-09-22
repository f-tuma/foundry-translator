import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import type { TranslatorSettings } from "./settings";

function localize(key: string): string {
  return game.i18n.localize(key);
}

const help = (key: string, topic: string) => renderHelpTooltip(localize(key), localize(topic));

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
        <div class="ft-heading-with-help"><h2>${localize("FOUNDRY_TRANSLATE.Settings.Heading")}</h2>${help("FOUNDRY_TRANSLATE.Settings.Intro", "FOUNDRY_TRANSLATE.Settings.Heading")}</div>
      </div>
    </header>

    <div class="ft-settings__fields">
      <div class="ft-field">
        <div class="ft-field__label"><span>${localize("FOUNDRY_TRANSLATE.Settings.Provider.Name")}</span>
          ${help("FOUNDRY_TRANSLATE.Settings.Provider.OpenAIHint", "FOUNDRY_TRANSLATE.Settings.Provider.Name")}
        </div>
        <strong>${localize("FOUNDRY_TRANSLATE.Settings.Provider.OpenAI")}</strong>
      </div>

      <div class="ft-settings__local-model">
        <div class="ft-field">
          <div class="ft-field__label"><label for="ft-openai-base-url">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.BaseUrl")}</label>${help("FOUNDRY_TRANSLATE.Settings.OpenAI.BaseUrlHint", "FOUNDRY_TRANSLATE.Settings.OpenAI.BaseUrl")}</div>
          <input id="ft-openai-base-url" name="openAiBaseUrl" type="url" spellcheck="false" autocomplete="off" placeholder="http://localhost:1234">
        </div>
        <div class="ft-field">
          <div class="ft-field__label"><label for="ft-openai-model">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.Model")}</label>${help("FOUNDRY_TRANSLATE.Settings.OpenAI.ModelHint", "FOUNDRY_TRANSLATE.Settings.OpenAI.Model")}</div>
          <input id="ft-openai-model" name="openAiModel" type="text" spellcheck="false" autocomplete="off" placeholder="hy-mt2-30b-a3b-apex">
        </div>
        <div class="ft-field">
          <div class="ft-field__label"><label for="ft-openai-api-key">${localize("FOUNDRY_TRANSLATE.Settings.OpenAI.ApiKey")}</label>${help("FOUNDRY_TRANSLATE.Settings.OpenAI.ApiKeyHint", "FOUNDRY_TRANSLATE.Settings.OpenAI.ApiKey")}</div>
          <div class="ft-secret-input">
            <input id="ft-openai-api-key" name="openAiApiKey" type="password" spellcheck="false" autocomplete="off">
            <button type="button" data-action="toggle-openai-key" data-secret-target="openAiApiKey" aria-pressed="false" title="${localize("FOUNDRY_TRANSLATE.Settings.ApiKey.Show")}">
              <i class="fa-solid fa-eye" aria-hidden="true"></i>
              <span class="sr-only">${localize("FOUNDRY_TRANSLATE.Settings.ApiKey.Show")}</span>
            </button>
          </div>
        </div>
        <div class="ft-field">
          <div class="ft-field__label"><label for="ft-world-context">${localize("FOUNDRY_TRANSLATE.Settings.WorldContext.Name")}</label>${help("FOUNDRY_TRANSLATE.Settings.WorldContext.Hint", "FOUNDRY_TRANSLATE.Settings.WorldContext.Name")}</div>
          <textarea id="ft-world-context" name="worldContext" rows="7" maxlength="6000" placeholder="${localize("FOUNDRY_TRANSLATE.Settings.WorldContext.Placeholder")}"></textarea>
          <div class="ft-help-row"><button type="button" class="ft-button ft-button--secondary ft-settings__generate-context" data-action="generate-world-context">
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            <span>${localize("FOUNDRY_TRANSLATE.Settings.WorldContext.Generate")}</span>
          </button>
          ${help("FOUNDRY_TRANSLATE.Settings.WorldContext.GenerateHint", "FOUNDRY_TRANSLATE.Settings.WorldContext.Generate")}</div>
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

    <div class="ft-help-row ft-settings__privacy-summary">
      <span>${localize("FOUNDRY_TRANSLATE.Settings.PrivacyLabel")}</span>
      ${help("FOUNDRY_TRANSLATE.Settings.PrivacyOpenAI", "FOUNDRY_TRANSLATE.Settings.PrivacyLabel")}
    </div>

    <div class="ft-connection-status" data-state="idle" role="status" aria-live="polite">
      <span class="ft-connection-status__dot" aria-hidden="true"></span>
      <span data-status-text>${localize("FOUNDRY_TRANSLATE.Settings.Status.NotTested")}</span>
    </div>

    <footer class="ft-settings__actions">
      <a class="ft-settings__cloud-link" href="https://lmstudio.ai/docs/developer/openai-compat" target="_blank" rel="noreferrer">
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

  const sourceLanguage = form.querySelector("[name='sourceLanguage']");
  const targetLanguage = form.querySelector("[name='targetLanguage']");
  const openAiBaseUrl = form.querySelector("[name='openAiBaseUrl']");
  const openAiModel = form.querySelector("[name='openAiModel']");
  const openAiApiKey = form.querySelector("[name='openAiApiKey']");
  const worldContext = form.querySelector("[name='worldContext']");

  if (sourceLanguage instanceof HTMLSelectElement) sourceLanguage.value = settings.sourceLanguage;
  if (targetLanguage instanceof HTMLSelectElement) targetLanguage.value = settings.targetLanguage;
  if (openAiBaseUrl instanceof HTMLInputElement) openAiBaseUrl.value = settings.openAiBaseUrl;
  if (openAiModel instanceof HTMLInputElement) openAiModel.value = settings.openAiModel;
  if (openAiApiKey instanceof HTMLInputElement) openAiApiKey.value = settings.openAiApiKey;
  if (worldContext instanceof HTMLTextAreaElement) worldContext.value = settings.worldContext;

  activateHelpTooltips(form);
  return form;
}
