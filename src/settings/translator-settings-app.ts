import { logger } from "../logger";
import { OpenAiCompatibleProvider } from "../providers/openai-compatible";
import { createTranslationProvider } from "../providers/factory";
import {
  getTranslatorSettings,
  saveTranslatorSettings,
  type TranslatorSettings,
} from "./settings";
import { renderTranslatorSettingsForm } from "./translator-settings-view";
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
      .querySelector<HTMLElement>("[data-action='toggle-openai-key']")
      ?.addEventListener("click", (event) => this.#toggleKey(event, form));
    form
      .querySelector<HTMLElement>("[data-action='generate-world-context']")
      ?.addEventListener("click", () => void this.#generateWorldContext(form));
  }

  async #save(event: SubmitEvent, form: HTMLFormElement): Promise<void> {
    event.preventDefault();
    const settings = this.#readForm(form);

    try {
      await saveTranslatorSettings(settings);
      ui.notifications.success("FOUNDRY_TRANSLATE.Settings.Status.Saved", { localize: true });
      await this.close();
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
      "FOUNDRY_TRANSLATE.Settings.Status.TestingOpenAI",
    );

    try {
      const provider = createTranslationProvider(settings);
      await provider.testConnection(settings.targetLanguage);
      this.#setStatus(
        form,
        "success",
        "FOUNDRY_TRANSLATE.Settings.Status.ConnectedOpenAI",
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

  #toggleKey(event: Event, form: HTMLFormElement): void {
    const button = event.currentTarget;
    const inputName = button instanceof HTMLElement
      ? button.dataset.secretTarget ?? "openAiApiKey"
      : "openAiApiKey";
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

  #readForm(form: HTMLFormElement): TranslatorSettings {
    const data = new FormData(form);
    return {
      provider: "openai-compatible",
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
