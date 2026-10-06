import { getTranslatorSettings } from "../settings/settings";
import { openActiveTranslationsOverview } from "./active-translations-app";
import { collectEmberCreationItems, collectCrucibleCreationEquipment, creationRuntimeGuard, creationSourceGuard, MAX_CREATION_ITEMS,
  planMissingCreationItems, type CreationItemsPlan, type CreationItemsScope } from "./ember-creation-items";
import { JournalTranslationService, TranslationCancelledError } from "./journal-service";
import { planMissingEquipmentAffixes, equipmentAffixSourceGuard, type EquipmentAffixesPlan } from "./equipment-affixes";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.CreationItems.${key}`);
export class CreationItemsApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "foundry-translate-creation-items", classes: ["foundry-translate"],
    position: { width: 560, height: "auto" }, window: { title: "FOUNDRY_TRANSLATE.CreationItems.Title", icon: "fa-solid fa-user-plus", resizable: false } };
  #plan: CreationItemsPlan | undefined;
  #affixPlan: EquipmentAffixesPlan | undefined;
  #affixChecks: (() => Promise<void>)[] = [];
  #assertRuntime: (() => void) | undefined;
  #sourceChecks: (() => Promise<void>)[] = [];
  #busy = false;
  #scope: CreationItemsScope = "creation";
  #preview = 0;
  protected async _renderHTML(): Promise<HTMLElement> {
    const root = document.createElement("section"); root.className = "ft-settings";
    const scope = this.#scope, preview = ++this.#preview;
    const scopeLabel = document.createElement("label"); scopeLabel.textContent = t("Selection");
    const selection = document.createElement("select"); selection.dataset.creationItemsScope = ""; selection.disabled = true;
    for (const [value, key] of [["creation", "CharacterChoice"], ["equipment", "EquipmentChoice"]]) {
      const option = document.createElement("option"); option.value = value!; option.textContent = t(key!); option.selected = value === scope; selection.append(option);
    }
    scopeLabel.append(selection); root.append(scopeLabel);
    const hint = document.createElement("p"); hint.textContent = t(scope === "equipment" ? "EquipmentScope" : "Scope").replace("{limit}", String(MAX_CREATION_ITEMS)); root.append(hint);
    const status = document.createElement("p"); status.dataset.creationItemsStatus = ""; status.setAttribute("role", "status"); root.append(status);
    const button = document.createElement("button"); button.type = "button"; button.dataset.creationItemsStart = "";
    button.className = "ft-button ft-button--primary"; button.textContent = t("Start"); button.disabled = true; root.append(button);
    const affixStatus = document.createElement("p"), affixButton = document.createElement("button");
    if (scope === "equipment") {
      affixStatus.dataset.creationAffixesStatus = ""; affixStatus.setAttribute("role", "status");
      affixButton.type = "button"; affixButton.dataset.creationAffixesStart = ""; affixButton.className = "ft-button";
      affixButton.textContent = t("AffixStart"); affixButton.disabled = true;
      const affixHint = document.createElement("p"); affixHint.textContent = t("AffixScope");
      root.append(affixHint, affixStatus, affixButton);
    }
    try {
      if (!this.#busy) {
        const assertRuntime = creationRuntimeGuard(scope);
        const sources = await (scope === "equipment" ? collectCrucibleCreationEquipment() : collectEmberCreationItems()); assertRuntime();
        const plan = await planMissingCreationItems(sources, getTranslatorSettings().targetLanguage, scope); assertRuntime();
        const affixPlan = scope === "equipment" ? await planMissingEquipmentAffixes(sources, getTranslatorSettings().targetLanguage) : undefined; assertRuntime();
        const sourceChecks = await Promise.all(sources.map(source => creationSourceGuard(source, scope))); assertRuntime();
        const affixChecks = await Promise.all((affixPlan?.sources ?? []).map(source => equipmentAffixSourceGuard(source))); assertRuntime();
        if (preview !== this.#preview || scope !== this.#scope) return root;
        this.#assertRuntime = () => { if (scope !== this.#scope) throw new Error(t("SourceChanged")); assertRuntime(); };
        this.#plan = plan; this.#sourceChecks = sourceChecks;
        this.#affixPlan = affixPlan; this.#affixChecks = affixChecks;
      }
      if (this.#plan) {
        status.textContent = t("Plan").replace("{missing}", String(this.#plan.missing.length)).replace("{existing}", String(this.#plan.existing));
        button.disabled = this.#busy || !this.#plan.missing.length;
      }
      if (this.#affixPlan && scope === "equipment") {
        affixStatus.textContent = t("AffixPlan").replace("{missing}", String(this.#affixPlan.missing.length))
          .replace("{extendable}", String(this.#affixPlan.extendable.length)).replace("{existing}", String(this.#affixPlan.existing));
        affixButton.disabled = this.#busy || !(this.#affixPlan.missing.length + this.#affixPlan.extendable.length);
      }
    } catch (error) { if (preview === this.#preview) { this.#plan = undefined; this.#affixPlan = undefined; } status.textContent = error instanceof Error ? error.message : String(error); }
    selection.disabled = this.#busy;
    return root;
  }
  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void { content.replaceChildren(result); }
  protected async _onRender(): Promise<void> {
    this.element.querySelector<HTMLSelectElement>("[data-creation-items-scope]")?.addEventListener("change", event => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (this.#busy || !["creation", "equipment"].includes(value) || value === this.#scope) return;
      this.#scope = value as CreationItemsScope; this.#plan = undefined; this.#sourceChecks = []; this.#assertRuntime = undefined;
      this.#affixPlan = undefined; this.#affixChecks = [];
      (event.currentTarget as HTMLSelectElement).disabled = true;
      const start = this.element.querySelector<HTMLButtonElement>("[data-creation-items-start]"); if (start) start.disabled = true;
      const affixes = this.element.querySelector<HTMLButtonElement>("[data-creation-affixes-start]"); if (affixes) affixes.disabled = true;
      void this.render({ force: true });
    });
    this.element.querySelector("[data-creation-items-start]")?.addEventListener("click", () => void this.#start());
    this.element.querySelector("[data-creation-affixes-start]")?.addEventListener("click", () => void this.#start(true));
  }
  async #start(affixes = false): Promise<void> {
    if (this.#busy || !this.#plan || (affixes ? this.#scope !== "equipment" || !this.#affixPlan
      || !(this.#affixPlan.missing.length + this.#affixPlan.extendable.length) : !this.#plan.missing.length)) return;
    const scope = this.#scope;
    this.#busy = true;
    const root = this.element, button = root.querySelector<HTMLButtonElement>("[data-creation-items-start]");
    if (button) button.disabled = true;
    const affixButton = root.querySelector<HTMLButtonElement>("[data-creation-affixes-start]"); if (affixButton) affixButton.disabled = true;
    const selection = root.querySelector<HTMLSelectElement>("[data-creation-items-scope]"); if (selection) selection.disabled = true;
    const update = (message: string) => {
      if (this.element !== root || !root.isConnected) return;
      const status = root.querySelector(affixes ? "[data-creation-affixes-status]" : "[data-creation-items-status]"); if (status) status.textContent = message;
    };
    try {
      this.#assertRuntime?.();
      const currentSources = await (scope === "equipment" ? collectCrucibleCreationEquipment() : collectEmberCreationItems()); this.#assertRuntime?.();
      if (JSON.stringify(currentSources.map(source => source.uuid)) !== JSON.stringify(this.#plan.sources.map(source => source.uuid))) {
        throw new Error(t("SourceChanged"));
      }
      for (const check of this.#sourceChecks) { await check(); this.#assertRuntime?.(); }
      if (affixes) {
        for (const check of this.#affixChecks) { await check(); this.#assertRuntime?.(); }
        const current = await planMissingEquipmentAffixes(currentSources, getTranslatorSettings().targetLanguage); this.#assertRuntime?.();
        if (JSON.stringify(current.sources.map(source => source.uuid)) !== JSON.stringify(this.#affixPlan!.sources.map(source => source.uuid))) throw new Error(t("SourceChanged"));
      }
      const running = t(affixes ? "AffixRunning" : "Running"); update(running);
      const service = new JournalTranslationService({ onProgress: progress => update(`${running} ${progress.documentName ?? ""}`) });
      const pending = affixes ? service.translateMissingEquipmentAffixes(this.#plan.sources)
        : scope === "equipment" ? service.translateMissingItems(this.#plan.sources, scope) : service.translateMissingItems(this.#plan.sources);
      openActiveTranslationsOverview();
      const result = await pending;
      update(t("Done").replace("{created}", String(result.createdDocuments)).replace("{existing}", String(result.skippedDocuments)));
      ui.notifications.info(t(result.fallbackTextSegments ? "Review" : "Complete"));
      this.#plan = undefined;
      this.#affixPlan = undefined;
    } catch (error) {
      update(error instanceof Error ? error.message : String(error));
      if (!(error instanceof TranslationCancelledError)) ui.notifications.warn(error instanceof Error ? error.message : String(error));
    } finally {
      this.#busy = false;
      if (selection) selection.disabled = false;
      // A new render makes a fresh plan. Never reopen a dismissed window.
      if (this.element === root && root.isConnected) {
        const refresh = document.createElement("button"); refresh.type = "button"; refresh.textContent = t("Refresh");
        refresh.addEventListener("click", () => void this.render({ force: true })); root.querySelector("[data-creation-items-status]")?.parentElement?.append(refresh);
      }
    }
  }
}
