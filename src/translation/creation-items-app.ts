import { getTranslatorSettings } from "../settings/settings";
import { openActiveTranslationsOverview } from "./active-translations-app";
import { collectEmberCreationItems, creationRuntimeGuard, creationSourceGuard, MAX_CREATION_ITEMS,
  planMissingCreationItems, type CreationItemsPlan } from "./ember-creation-items";
import { JournalTranslationService, TranslationCancelledError } from "./journal-service";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.CreationItems.${key}`);
export class CreationItemsApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "foundry-translate-creation-items", classes: ["foundry-translate"],
    position: { width: 560, height: "auto" }, window: { title: "FOUNDRY_TRANSLATE.CreationItems.Title", icon: "fa-solid fa-user-plus", resizable: false } };
  #plan: CreationItemsPlan | undefined;
  #assertRuntime?: () => void;
  #sourceChecks: (() => Promise<void>)[] = [];
  #busy = false;
  protected async _renderHTML(): Promise<HTMLElement> {
    const root = document.createElement("section"); root.className = "ft-settings";
    const hint = document.createElement("p"); hint.textContent = t("Scope").replace("{limit}", String(MAX_CREATION_ITEMS)); root.append(hint);
    const status = document.createElement("p"); status.dataset.creationItemsStatus = ""; status.setAttribute("role", "status"); root.append(status);
    const button = document.createElement("button"); button.type = "button"; button.dataset.creationItemsStart = "";
    button.className = "ft-button ft-button--primary"; button.textContent = t("Start"); button.disabled = true; root.append(button);
    try {
      if (!this.#busy) {
        this.#assertRuntime = creationRuntimeGuard();
        const sources = await collectEmberCreationItems(); this.#assertRuntime();
        this.#plan = await planMissingCreationItems(sources, getTranslatorSettings().targetLanguage); this.#assertRuntime();
        this.#sourceChecks = await Promise.all(sources.map(creationSourceGuard)); this.#assertRuntime();
      }
      if (this.#plan) {
        status.textContent = t("Plan").replace("{missing}", String(this.#plan.missing.length)).replace("{existing}", String(this.#plan.existing));
        button.disabled = this.#busy || !this.#plan.missing.length;
      }
    } catch (error) { this.#plan = undefined; status.textContent = error instanceof Error ? error.message : String(error); }
    return root;
  }
  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void { content.replaceChildren(result); }
  protected async _onRender(): Promise<void> {
    this.element.querySelector("[data-creation-items-start]")?.addEventListener("click", () => void this.#start());
  }
  async #start(): Promise<void> {
    if (this.#busy || !this.#plan?.missing.length) return;
    this.#busy = true;
    const root = this.element, button = root.querySelector<HTMLButtonElement>("[data-creation-items-start]");
    if (button) button.disabled = true;
    const update = (message: string) => {
      if (this.element !== root || !root.isConnected) return;
      const status = root.querySelector("[data-creation-items-status]"); if (status) status.textContent = message;
    };
    try {
      this.#assertRuntime?.();
      const currentSources = await collectEmberCreationItems(); this.#assertRuntime?.();
      if (JSON.stringify(currentSources.map(source => source.uuid)) !== JSON.stringify(this.#plan.sources.map(source => source.uuid))) {
        throw new Error(t("SourceChanged"));
      }
      for (const check of this.#sourceChecks) { await check(); this.#assertRuntime?.(); }
      update(t("Running"));
      const service = new JournalTranslationService({ onProgress: progress => update(`${t("Running")} ${progress.documentName ?? ""}`) });
      const pending = service.translateMissingItems(this.#plan.sources);
      openActiveTranslationsOverview();
      const result = await pending;
      update(t("Done").replace("{created}", String(result.createdDocuments)).replace("{existing}", String(result.skippedDocuments)));
      ui.notifications.info(t(result.fallbackTextSegments ? "Review" : "Complete"));
      this.#plan = undefined;
    } catch (error) {
      update(error instanceof Error ? error.message : String(error));
      if (!(error instanceof TranslationCancelledError)) ui.notifications.warn(error instanceof Error ? error.message : String(error));
    } finally {
      this.#busy = false;
      // A new render makes a fresh plan. Never reopen a dismissed window.
      if (this.element === root && root.isConnected) {
        const refresh = document.createElement("button"); refresh.type = "button"; refresh.textContent = t("Refresh");
        refresh.addEventListener("click", () => void this.render({ force: true })); root.querySelector("[data-creation-items-status]")?.parentElement?.append(refresh);
      }
    }
  }
}
