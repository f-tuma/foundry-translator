import { logger } from "../logger";
import { ChromeLocalProvider } from "../providers/chrome-local";
import { GoogleCloudBasicProvider } from "../providers/google-cloud-basic";
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

type ConnectionState = "idle" | "testing" | "success" | "error";

export class TranslatorSettingsApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-translate-settings",
    classes: ["foundry-translate", "foundry-translate-settings-window"],
    position: {
      width: 620,
      height: "auto",
    },
    window: {
      icon: "fa-solid fa-language",
      title: "FOUNDRY_TRANSLATE.Settings.WindowTitle",
      resizable: false,
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
        : "FOUNDRY_TRANSLATE.Settings.Status.TestingGoogle",
    );

    try {
      const provider = this.#createProvider(settings, (progress) => {
        const template = game.i18n.localize(
          "FOUNDRY_TRANSLATE.Settings.Status.DownloadingChrome",
        );
        this.#setStatus(
          form,
          "testing",
          template.replace("{progress}", String(Math.round(progress * 100))),
          false,
        );
      });
      await provider.testConnection(settings.targetLanguage);
      this.#setStatus(
        form,
        "success",
        settings.provider === "chrome-local"
          ? "FOUNDRY_TRANSLATE.Settings.Status.ConnectedChrome"
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

  #createProvider(
    settings: TranslatorSettings,
    onDownloadProgress: (progress: number) => void,
  ): TranslationProvider {
    if (settings.provider === "chrome-local") {
      return new ChromeLocalProvider({ onDownloadProgress });
    }

    return new GoogleCloudBasicProvider(settings.apiKey);
  }

  #providerChanged(form: HTMLFormElement): void {
    const provider = this.#readProvider(form);
    updateProviderFields(form, provider);
    this.#setStatus(form, "idle", "FOUNDRY_TRANSLATE.Settings.Status.NotTested");
  }

  #toggleKey(event: Event, form: HTMLFormElement): void {
    const button = event.currentTarget;
    const input = form.elements.namedItem("apiKey");
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
