import { NamingCancelledError } from "./name-analysis";
import { logger } from "../logger";
import { GlossaryCompendiumRepository } from "./compendium-repository";
import { discoverWorldGlossary } from "./discovery";
import { planManualTerm } from "./sync";
import { hasGlossaryEdits, readGlossaryRow, refreshGlossaryRows, renderGlossaryView, updateGlossaryFilter } from "./glossary-view";
import { isGlossaryCategory, type GlossaryEntry } from "./types";
import { loadGlossaryCandidates, saveGlossaryCandidates } from "./candidate-store";
import type { GlossaryCandidate } from "./candidates";
import { glossaryLive, type GlossaryLiveState } from "./live";

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
  #syncCancelled = false;
  #syncing = false;
  #unsubscribe: (() => void) | undefined;
  #latest: readonly GlossaryEntry[] | undefined;
  #status: { state: GlossaryStatus; message: string; localize: boolean } | undefined;
  #loadedRevision = 0;

  override async close(options?: Record<string, unknown>): Promise<FoundryApplicationV2> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    return super.close(options);
  }

  protected async _renderHTML(): Promise<HTMLElement> {
    this.#loadedRevision = glossaryLive.revision;
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
    this.#unsubscribe ??= glossaryLive.subscribe((state) => this.#onLiveUpdate(state));
    // A freshly loaded pack may include edits from another client. Reuse the
    // live snapshot only when a local write happened during this render.
    this.#onLiveUpdate(glossaryLive.revision === this.#loadedRevision
      ? { ...glossaryLive.state, entries: this.#stored } : glossaryLive.state);
    if (this.#status) this.#setStatus(this.#status.state, this.#status.message, this.#status.localize);
    this.#updateSyncControls();
    this.element.querySelector(".ft-glossary__rows")?.addEventListener("focusout", () => {
      queueMicrotask(() => this.#refreshRows());
    });
    const manualTerm = this.element.querySelector<HTMLInputElement>("[name='manualTerm']");
    manualTerm?.addEventListener("input", () => {
      updateGlossaryFilter(this.element, manualTerm.value);
    });
    if (manualTerm) updateGlossaryFilter(this.element, manualTerm.value);
    for (const select of this.element.querySelectorAll("[name='categoryFilter'],[name='namingFilter']")) select.addEventListener("change", () => {
      updateGlossaryFilter(this.element, manualTerm?.value ?? "");
    });

    this.element.querySelector<HTMLButtonElement>("[data-action='cancel-sync']")?.addEventListener("click", (event) => {
      this.#syncCancelled = true;
      (event.currentTarget as HTMLButtonElement).disabled = true;
      this.#setStatus("testing", "FOUNDRY_TRANSLATE.ActiveTranslations.State.Cancelling");
    });
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
    return discoverWorldGlossary();
  }

  #onLiveUpdate(state: GlossaryLiveState): void {
    if (state.entries) { this.#latest = state.entries; this.#refreshRows(); }
    if (state.status) this.#setStatus(state.status.state, state.status.message, false);
    this.#updateSyncControls();
  }

  #refreshRows(): void {
    if (this.#latest && this.element?.isConnected) this.#stored = refreshGlossaryRows(this.element, this.#latest, this.#stored);
  }

  #updateSyncControls(): void {
    const button = this.element.querySelector<HTMLButtonElement>("[data-action='sync']");
    if (button) button.disabled = this.#syncing || glossaryLive.state.running;
    const cancel = this.element.querySelector<HTMLButtonElement>("[data-action='cancel-sync']");
    if (cancel) { cancel.hidden = !this.#syncing; cancel.disabled = this.#syncCancelled; }
  }

  async #sync(): Promise<void> {
    if (this.#syncing) return;
    this.#syncing = true;
    this.#syncCancelled = false;
    this.#updateSyncControls();
    this.#setStatus("testing", "FOUNDRY_TRANSLATE.Glossary.Status.Syncing");

    try {
      const result = await this.#repository.sync(this.#discover(), {
        shouldCancel: () => this.#syncCancelled,
        onProgress: ({ completed, total }) => this.#setStatus("testing", game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.AI.Progress")
          .replace("{completed}", String(completed)).replace("{total}", String(total)), false),
      });
      const template = game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Status.Synced");
      const message = template
        .replace("{created}", String(result.created))
        .replace("{updated}", String(result.updated))
        .replace("{unchanged}", String(result.unchanged));
      this.#setStatus(result.aiWarning ? "error" : "success", result.aiWarning ?? message, false);
      if (result.aiWarning) ui.notifications.warn(result.aiWarning);
      else ui.notifications.success(message + (result.aiTranslated !== undefined ? " " + game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.AI.Summary")
        .replace("{translated}", String(result.aiTranslated)).replace("{preserved}", String(result.aiPreserved ?? 0)) : ""));
      this.#refreshRows();
    } catch (error) {
      if (error instanceof NamingCancelledError) {
        this.#refreshRows();
        this.#setStatus("idle", "FOUNDRY_TRANSLATE.Glossary.AI.Cancelled");
        return;
      }
      logger.error("Glossary synchronization failed.", error);
      this.#setStatus("error", this.#errorMessage(error), false);
    } finally {
      this.#syncing = false;
      this.#updateSyncControls();
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
      const category = this.element.querySelector<HTMLSelectElement>("[name='manualCategory']")?.value;
      if (isGlossaryCategory(category)) plan.entry.category = category;
      plan.entry.customized = true;
      await this.#repository.saveEntry(plan.entry);
      ui.notifications.success(
        plan.action === "update"
          ? "FOUNDRY_TRANSLATE.Glossary.Status.ReplacementUpdated"
          : "FOUNDRY_TRANSLATE.Glossary.Status.Added",
        { localize: true },
      );
      if (input?.value.normalize("NFC").trim() === source) input.value = "";
      if (replacementInput?.value.normalize("NFC").trim() === replacement) replacementInput.value = "";
      this.#refreshRows();
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
      const row = input.closest<HTMLElement>("[data-glossary-row]");
      if (!row) continue;
      const edited = readGlossaryRow(row, entry);
      if (hasGlossaryEdits(edited, entry)) changed.push({ ...edited, customized: true });
    }
    if (!changed.length) {
      this.#setStatus("idle", "FOUNDRY_TRANSLATE.Glossary.Status.NoEdits");
      return;
    }

    button?.setAttribute("disabled", "");
    this.#setStatus("testing", "FOUNDRY_TRANSLATE.Glossary.Status.SavingEdits");
    try {
      await this.#repository.saveEntries(changed);
      const message = game.i18n
        .localize("FOUNDRY_TRANSLATE.Glossary.Status.EditsSaved")
        .replace("{count}", String(changed.length));
      ui.notifications.success(message);
      // Advance the edit baseline only to what was actually saved. Any typing
      // done while the write was in flight remains an unsaved draft.
      const saved = new Map(changed.map((entry) => [entry.source, entry]));
      this.#stored = this.#stored.map((entry) => saved.get(entry.source) ?? entry);
      for (const row of this.element.querySelectorAll<HTMLElement>("[data-glossary-row]")) {
        if (saved.has(row.querySelector<HTMLInputElement>("[data-source]")?.dataset.source ?? "")) row.dataset.refreshNeeded = "true";
      }
      this.#refreshRows();
      const live = glossaryLive.state;
      if (live.running && live.status) this.#setStatus(live.status.state, live.status.message, false);
      else this.#setStatus("success", message, false);
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
    this.#status = { state, message, localize };
    const status = this.element.querySelector<HTMLElement>(".ft-connection-status");
    const text = status?.querySelector<HTMLElement>("[data-status-text]");
    if (!status || !text) return;
    status.dataset.state = state;
    text.textContent = localize ? game.i18n.localize(message) : message;
  }
}
