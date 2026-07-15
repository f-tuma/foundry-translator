import { logger } from "../logger";
import {
  ChromeLocalProvider,
  type ChromeLocalProviderStatus,
} from "../providers/chrome-local";
import { GoogleCloudBasicProvider } from "../providers/google-cloud-basic";
import { OpenAiCompatibleProvider } from "../providers/openai-compatible";
import type { TranslationProvider } from "../providers/types";
import {
  getTranslatorSettings,
  isProviderId,
  saveTranslatorSettings,
  type ProviderId,
  type TranslatorSettings,
} from "./settings";
import {
  renderTranslatorSettingsForm,
  updateProviderFields,
} from "./translator-settings-view";
import { collectWorldContextSource } from "./world-context";

type ConnectionState = "idle" | "testing" | "success" | "error";

export class TranslatorSettingsApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-translate-settings",
    classes: ["foundry-translate", "foundry-translate-settings-window"],
    position: {
      width: 620,
      height: 760,
    },
    window: {
      icon: "fa-solid fa-language",
      title: "FOUNDRY_TRANSLATE.Settings.WindowTitle",
      resizable: true,
    },
  };

  protected async _renderHTML(): Promise<HTMLFormElement> {
    return renderTranslatorSettingsForm(getTranslatorSettings());
  }

  protected _replaceHTML(result: HTMLFormElement, content: HTMLElement): void {
    content.replaceChildren(result);
  }

  protected async _onRender(): Promise<void> {
    const form = this.element.querySelector<HTMLFormElement>("form.ft-settings");
    if (!form) return;

    form.addEventListener("submit", (event) => void this.#save(event, form));
    form
      .querySelector<HTMLElement>("[data-action='test-connection']")
      ?.addEventListener("click", () => void this.#testConnection(form));
    form
      .querySelector<HTMLElement>("[data-action='toggle-key']")
      ?.addEventListener("click", (event) => this.#toggleKey(event, form));
    form
      .querySelector<HTMLElement>("[data-action='toggle-openai-key']")
      ?.addEventListener("click", (event) => this.#toggleKey(event, form));
    form
      .querySelector<HTMLElement>("[data-action='generate-world-context']")
      ?.addEventListener("click", () => void this.#generateWorldContext(form));
    const providerSelect = form.elements.namedItem("provider");
    if (providerSelect instanceof HTMLSelectElement) {
      providerSelect.addEventListener("change", () => this.#providerChanged(form));
    }
  }

  async #save(event: SubmitEvent, form: HTMLFormElement): Promise<void> {
    event.preventDefault();
    const settings = this.#readForm(form);

    try {
      await saveTranslatorSettings(settings);
      ui.notifications.success("FOUNDRY_TRANSLATE.Settings.Status.Saved", { localize: true });
    } catch (error) {
      logger.error("Translator settings could not be saved.", error);
      const message =
        error instanceof Error
          ? error.message
          : game.i18n.localize("FOUNDRY_TRANSLATE.Settings.Status.SaveError");
      this.#setStatus(form, "error", message, false);
      ui.notifications.error(message);
    }
  }

  async #testConnection(form: HTMLFormElement): Promise<void> {
    const settings = this.#readForm(form);
    const button = form.querySelector<HTMLButtonElement>("[data-action='test-connection']");

    button?.setAttribute("disabled", "");
    this.#setStatus(
      form,
      "testing",
      settings.provider === "chrome-local"
        ? "FOUNDRY_TRANSLATE.Settings.Status.TestingChrome"
        : settings.provider === "openai-compatible"
          ? "FOUNDRY_TRANSLATE.Settings.Status.TestingOpenAI"
          : "FOUNDRY_TRANSLATE.Settings.Status.TestingGoogle",
    );

    try {
      const provider = this.#createProvider(settings, (status) => {
        this.#setChromeStatus(form, status);
      });
      await provider.testConnection(settings.targetLanguage);
      this.#setStatus(
        form,
        "success",
        settings.provider === "chrome-local"
          ? "FOUNDRY_TRANSLATE.Settings.Status.ConnectedChrome"
          : settings.provider === "openai-compatible"
            ? "FOUNDRY_TRANSLATE.Settings.Status.ConnectedOpenAI"
            : "FOUNDRY_TRANSLATE.Settings.Status.ConnectedGoogle",
      );
    } catch (error) {
      logger.error("Translation provider test failed.", error);
      const message =
        error instanceof Error
          ? error.message
          : game.i18n.localize("FOUNDRY_TRANSLATE.Settings.Status.UnknownError");
      this.#setStatus(form, "error", message, false);
    } finally {
      button?.removeAttribute("disabled");
    }
  }

  async #generateWorldContext(form: HTMLFormElement): Promise<void> {
    const settings = this.#readForm(form);
    const button = form.querySelector<HTMLButtonElement>("[data-action='generate-world-context']");
    const input = form.elements.namedItem("worldContext");
    if (!(input instanceof HTMLTextAreaElement)) return;
    button?.setAttribute("disabled", "");
    this.#setStatus(form, "testing", "FOUNDRY_TRANSLATE.Settings.Status.GeneratingContext");
    try {
      const provider = new OpenAiCompatibleProvider({
        baseUrl: settings.openAiBaseUrl,
        model: settings.openAiModel,
        apiKey: settings.openAiApiKey,
        worldContext: settings.worldContext,
      });
      input.value = await provider.generateWorldContext(
        collectWorldContextSource(),
        settings.targetLanguage,
      );
      this.#setStatus(form, "success", "FOUNDRY_TRANSLATE.Settings.Status.ContextGenerated");
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : game.i18n.localize("FOUNDRY_TRANSLATE.Settings.Status.UnknownError");
      logger.error("World context generation failed.", error);
      this.#setStatus(form, "error", message, false);
    } finally {
      button?.removeAttribute("disabled");
    }
  }

  #createProvider(
    settings: TranslatorSettings,
    onStatus: (status: ChromeLocalProviderStatus) => void,
  ): TranslationProvider {
    if (settings.provider === "chrome-local") {
      return new ChromeLocalProvider({ onStatus });
    }

    if (settings.provider === "openai-compatible") {
      return new OpenAiCompatibleProvider({
        baseUrl: settings.openAiBaseUrl,
        model: settings.openAiModel,
        apiKey: settings.openAiApiKey,
        worldContext: settings.worldContext,
      });
    }

    return new GoogleCloudBasicProvider(settings.apiKey);
  }

  #setChromeStatus(form: HTMLFormElement, status: ChromeLocalProviderStatus): void {
    if (status.component !== "translator") return;

    if (status.phase === "download") {
      const template = game.i18n.localize(
        "FOUNDRY_TRANSLATE.Settings.Status.DownloadingChrome",
      );
      this.#setStatus(
        form,
        "testing",
        template.replace("{progress}", String(Math.round(status.progress * 100))),
        false,
      );
      return;
    }

    if (status.phase === "ready") {
      this.#setStatus(
        form,
        "testing",
        "FOUNDRY_TRANSLATE.Settings.Status.ChromeModelReady",
      );
      return;
    }

    const statusKey = {
      available: "FOUNDRY_TRANSLATE.Settings.Status.ChromeModelAvailable",
      downloadable: "FOUNDRY_TRANSLATE.Settings.Status.ChromeDownloadStarting",
      downloading: "FOUNDRY_TRANSLATE.Settings.Status.ChromeDownloading",
      unavailable: "FOUNDRY_TRANSLATE.Settings.Status.ChromeUnavailable",
    }[status.availability];
    this.#setStatus(
      form,
      status.availability === "unavailable" ? "error" : "testing",
      statusKey,
    );
  }

  #providerChanged(form: HTMLFormElement): void {
    const provider = this.#readProvider(form);
    updateProviderFields(form, provider);
    this.#setStatus(form, "idle", "FOUNDRY_TRANSLATE.Settings.Status.NotTested");
  }

  #toggleKey(event: Event, form: HTMLFormElement): void {
    const button = event.currentTarget;
    const inputName = button instanceof HTMLElement
      ? button.dataset.secretTarget ?? "apiKey"
      : "apiKey";
    const input = form.elements.namedItem(inputName);
    if (!(button instanceof HTMLButtonElement) || !(input instanceof HTMLInputElement)) return;

    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.setAttribute("aria-pressed", String(!showing));
    button.title = game.i18n.localize(
      showing
        ? "FOUNDRY_TRANSLATE.Settings.ApiKey.Show"
        : "FOUNDRY_TRANSLATE.Settings.ApiKey.Hide",
    );
    button.querySelector("i")?.classList.toggle("fa-eye", showing);
    button.querySelector("i")?.classList.toggle("fa-eye-slash", !showing);
    const accessibleLabel = button.querySelector<HTMLElement>(".sr-only");
    if (accessibleLabel) accessibleLabel.textContent = button.title;
  }

  #readProvider(form: HTMLFormElement): ProviderId {
    const data = new FormData(form);
    const provider = String(data.get("provider") ?? "chrome-local");
    return isProviderId(provider) ? provider : "chrome-local";
  }

  #readForm(form: HTMLFormElement): TranslatorSettings {
    const data = new FormData(form);
    return {
      provider: this.#readProvider(form),
      apiKey: String(data.get("apiKey") ?? "").trim(),
      openAiBaseUrl: String(data.get("openAiBaseUrl") ?? "").trim(),
      openAiModel: String(data.get("openAiModel") ?? "").trim(),
      openAiApiKey: String(data.get("openAiApiKey") ?? "").trim(),
      worldContext: String(data.get("worldContext") ?? "").trim(),
      sourceLanguage: String(data.get("sourceLanguage") ?? "auto"),
      targetLanguage: String(data.get("targetLanguage") ?? "cs"),
    };
  }

  #setStatus(
    form: HTMLFormElement,
    state: ConnectionState,
    message: string,
    localize = true,
  ): void {
    const status = form.querySelector<HTMLElement>(".ft-connection-status");
    const text = status?.querySelector<HTMLElement>("[data-status-text]");
    if (!status || !text) return;

    status.dataset.state = state;
    text.textContent = localize ? game.i18n.localize(message) : message;
  }
}
