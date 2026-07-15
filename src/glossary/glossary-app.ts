import { logger } from "../logger";
import { GlossaryCompendiumRepository } from "./compendium-repository";
import { discoverGlossaryEntries } from "./discovery";
import { planManualTerm } from "./sync";
import { renderGlossaryView } from "./glossary-view";
import type { GlossaryEntry } from "./types";
import { loadGlossaryCandidates, saveGlossaryCandidates } from "./candidate-store";
import type { GlossaryCandidate } from "./candidates";

type GlossaryStatus = "idle" | "testing" | "success" | "error";

export class GlossaryApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-translate-glossary",
    classes: ["foundry-translate", "foundry-translate-glossary-window"],
    position: { width: 760, height: "auto" },
    window: {
      icon: "fa-solid fa-book-bookmark",
      title: "FOUNDRY_TRANSLATE.Glossary.WindowTitle",
      resizable: true,
    },
  };

  readonly #repository = new GlossaryCompendiumRepository();
  #stored: GlossaryEntry[] = [];
  #candidates: GlossaryCandidate[] = [];
  #loadError = "";

  protected async _renderHTML(): Promise<HTMLElement> {
    try {
      this.#stored = await this.#repository.load();
      this.#candidates = loadGlossaryCandidates();
      this.#loadError = "";
    } catch (error) {
      logger.error("Glossary could not be loaded.", error);
      this.#loadError = this.#errorMessage(error);
    }

    return renderGlossaryView({
      discovered: this.#discover(),
      stored: this.#stored,
      candidates: this.#candidates,
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
      .querySelector<HTMLElement>("[data-action='save-edits']")
      ?.addEventListener("click", () => void this.#saveEdits());
    this.element
      .querySelector<HTMLElement>("[data-action='open-pack']")
      ?.addEventListener("click", () => void this.#openPack());
    for (const button of this.element.querySelectorAll<HTMLElement>("[data-action='accept-candidate']")) {
      button.addEventListener("click", () => void this.#acceptCandidate(button));
    }
    for (const button of this.element.querySelectorAll<HTMLElement>("[data-action='reject-candidate']")) {
      button.addEventListener("click", () => void this.#rejectCandidate(button));
    }
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

  async #saveEdits(): Promise<void> {
    const button = this.element.querySelector<HTMLButtonElement>("[data-action='save-edits']");
    const entriesBySource = new Map(this.#stored.map((entry) => [entry.source, entry]));
    const changed: GlossaryEntry[] = [];
    for (const input of this.element.querySelectorAll<HTMLInputElement>("[data-glossary-replacement]")) {
      const source = input.dataset.source ?? "";
      const entry = entriesBySource.get(source);
      if (!entry) continue;
      const replacement = input.value.normalize("NFC").trim() || entry.source;
      if (replacement !== entry.replacement) changed.push({ ...entry, replacement });
    }
    if (!changed.length) {
      this.#setStatus("idle", "FOUNDRY_TRANSLATE.Glossary.Status.NoEdits");
      return;
    }

    button?.setAttribute("disabled", "");
    this.#setStatus("testing", "FOUNDRY_TRANSLATE.Glossary.Status.SavingEdits");
    try {
      for (const entry of changed) await this.#repository.saveEntry(entry);
      const message = game.i18n
        .localize("FOUNDRY_TRANSLATE.Glossary.Status.EditsSaved")
        .replace("{count}", String(changed.length));
      ui.notifications.success(message);
      await this.render({ force: true });
    } catch (error) {
      logger.error("Glossary edits could not be saved.", error);
      this.#setStatus("error", this.#errorMessage(error), false);
    } finally {
      button?.removeAttribute("disabled");
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

  async #acceptCandidate(button: HTMLElement): Promise<void> {
    const row = button.closest<HTMLElement>("[data-candidate-id]");
    const id = row?.dataset.candidateId;
    const candidate = this.#candidates.find((item) => item.id === id);
    if (!row || !candidate) return;
    const source = row.querySelector<HTMLInputElement>("[data-candidate-source]")
      ?.value.normalize("NFC").trim() ?? "";
    const replacement = row.querySelector<HTMLInputElement>("[data-candidate-replacement]")
      ?.value.normalize("NFC").trim() ?? "";
    if (!source || !replacement) {
      this.#setStatus("error", "FOUNDRY_TRANSLATE.Glossary.Candidates.MissingFields");
      return;
    }

    button.setAttribute("disabled", "");
    try {
      const plan = planManualTerm(this.#stored, source, replacement);
      if (plan.action !== "duplicate") await this.#repository.saveEntry(plan.entry);
      await saveGlossaryCandidates(this.#candidates.filter((item) => item.id !== candidate.id));
      ui.notifications.success("FOUNDRY_TRANSLATE.Glossary.Candidates.Accepted", { localize: true });
      await this.render({ force: true });
    } catch (error) {
      logger.error("Glossary candidate could not be accepted.", error);
      this.#setStatus("error", this.#errorMessage(error), false);
    } finally {
      button.removeAttribute("disabled");
    }
  }

  async #rejectCandidate(button: HTMLElement): Promise<void> {
    const id = button.closest<HTMLElement>("[data-candidate-id]")?.dataset.candidateId;
    if (!id) return;
    try {
      await saveGlossaryCandidates(this.#candidates.filter((item) => item.id !== id));
      await this.render({ force: true });
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
