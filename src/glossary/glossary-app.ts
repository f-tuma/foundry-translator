import { logger } from "../logger";
import { GlossaryCompendiumRepository } from "./compendium-repository";
import { discoverGlossaryEntries } from "./discovery";
import { planManualTerm } from "./sync";
import { renderGlossaryView } from "./glossary-view";
import type { GlossaryEntry } from "./types";

type GlossaryStatus = "idle" | "testing" | "success" | "error";

export class GlossaryApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-translate-glossary",
    classes: ["foundry-translate", "foundry-translate-glossary-window"],
    position: { width: 680, height: "auto" },
    window: {
      icon: "fa-solid fa-book-bookmark",
      title: "FOUNDRY_TRANSLATE.Glossary.WindowTitle",
      resizable: true,
    },
  };

  readonly #repository = new GlossaryCompendiumRepository();
  #stored: GlossaryEntry[] = [];
  #loadError = "";

  protected async _renderHTML(): Promise<HTMLElement> {
    try {
      this.#stored = await this.#repository.load();
      this.#loadError = "";
    } catch (error) {
      logger.error("Glossary could not be loaded.", error);
      this.#loadError = this.#errorMessage(error);
    }

    return renderGlossaryView({
      discovered: this.#discover(),
      stored: this.#stored,
      ...(this.#loadError ? { error: this.#loadError } : {}),
    });
  }

  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void {
    content.replaceChildren(result);
  }

  protected async _onRender(): Promise<void> {
    this.element
      .querySelector<HTMLElement>("[data-action='sync']")
      ?.addEventListener("click", () => void this.#sync());
    this.element
      .querySelector<HTMLElement>("[data-action='add-term']")
      ?.addEventListener("click", () => void this.#addManualTerm());
    this.element
      .querySelector<HTMLElement>("[data-action='open-pack']")
      ?.addEventListener("click", () => void this.#openPack());
    for (const name of ["manualTerm", "manualReplacement"]) {
      this.element
        .querySelector<HTMLInputElement>(`[name='${name}']`)
        ?.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void this.#addManualTerm();
          }
        });
    }
  }

  #discover(): GlossaryEntry[] {
    return discoverGlossaryEntries({
      actors: game.actors.contents,
      scenes: game.scenes.contents,
    });
  }

  async #sync(): Promise<void> {
    const button = this.element.querySelector<HTMLButtonElement>("[data-action='sync']");
    button?.setAttribute("disabled", "");
    this.#setStatus("testing", "FOUNDRY_TRANSLATE.Glossary.Status.Syncing");

    try {
      const result = await this.#repository.sync(this.#discover());
      const template = game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Status.Synced");
      const message = template
        .replace("{created}", String(result.created))
        .replace("{updated}", String(result.updated))
        .replace("{unchanged}", String(result.unchanged));
      this.#setStatus("success", message, false);
      ui.notifications.success(message);
      await this.render({ force: true });
    } catch (error) {
      logger.error("Glossary synchronization failed.", error);
      this.#setStatus("error", this.#errorMessage(error), false);
    } finally {
      button?.removeAttribute("disabled");
    }
  }

  async #addManualTerm(): Promise<void> {
    const input = this.element.querySelector<HTMLInputElement>("[name='manualTerm']");
    const replacementInput =
      this.element.querySelector<HTMLInputElement>("[name='manualReplacement']");
    const source = input?.value.normalize("NFC").trim() ?? "";
    const replacement = replacementInput?.value.normalize("NFC").trim() ?? "";
    if (!source) return;

    const plan = planManualTerm(this.#stored, source, replacement);
    if (plan.action === "duplicate") {
      this.#setStatus("error", "FOUNDRY_TRANSLATE.Glossary.Status.Duplicate");
      return;
    }

    this.#setStatus("testing", "FOUNDRY_TRANSLATE.Glossary.Status.Adding");
    try {
      await this.#repository.saveEntry(plan.entry);
      ui.notifications.success(
        plan.action === "update"
          ? "FOUNDRY_TRANSLATE.Glossary.Status.ReplacementUpdated"
          : "FOUNDRY_TRANSLATE.Glossary.Status.Added",
        { localize: true },
      );
      await this.render({ force: true });
    } catch (error) {
      logger.error("Manual glossary term could not be added.", error);
      this.#setStatus("error", this.#errorMessage(error), false);
    }
  }

  async #openPack(): Promise<void> {
    try {
      const pack = await this.#repository.getPack();
      pack.render(true);
    } catch (error) {
      this.#setStatus("error", this.#errorMessage(error), false);
    }
  }

  #errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Status.Error");
  }

  #setStatus(state: GlossaryStatus, message: string, localize = true): void {
    const status = this.element.querySelector<HTMLElement>(".ft-connection-status");
    const text = status?.querySelector<HTMLElement>("[data-status-text]");
    if (!status || !text) return;
    status.dataset.state = state;
    text.textContent = localize ? game.i18n.localize(message) : message;
  }
}
