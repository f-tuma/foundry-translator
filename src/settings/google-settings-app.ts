import { GoogleCloudBasicProvider } from "../providers/google-cloud-basic";
import { getGoogleSettings, saveGoogleSettings, type GoogleSettings } from "./settings";
import { renderGoogleSettingsForm } from "./google-settings-view";

type ConnectionState = "idle" | "testing" | "success" | "error";

export class GoogleSettingsApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-translate-google-settings",
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
    return renderGoogleSettingsForm(getGoogleSettings());
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
  }

  async #save(event: SubmitEvent, form: HTMLFormElement): Promise<void> {
    event.preventDefault();
    const settings = this.#readForm(form);

    try {
      await saveGoogleSettings(settings);
      ui.notifications.success("FOUNDRY_TRANSLATE.Settings.Status.Saved", { localize: true });
    } catch (error) {
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
    this.#setStatus(form, "testing", "FOUNDRY_TRANSLATE.Settings.Status.Testing");

    try {
      const provider = new GoogleCloudBasicProvider(settings.apiKey);
      await provider.testConnection(settings.targetLanguage);
      this.#setStatus(form, "success", "FOUNDRY_TRANSLATE.Settings.Status.Connected");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : game.i18n.localize("FOUNDRY_TRANSLATE.Settings.Status.UnknownError");
      this.#setStatus(form, "error", message, false);
    } finally {
      button?.removeAttribute("disabled");
    }
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

  #readForm(form: HTMLFormElement): GoogleSettings {
    const data = new FormData(form);
    return {
      provider: "google-cloud-basic",
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
