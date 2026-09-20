import { GlossaryApplication } from "../glossary/glossary-app";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { TranslatorSettingsApplication } from "../settings/translator-settings-app";
import { getTranslatorSettings } from "../settings/settings";
import { BundleApplication } from "../bundles/bundle-app";
import { JournalTranslationApplication } from "../translation/journal-translation-app";
import { openActiveTranslationsOverview } from "../translation/active-translations-app";
import { TRANSLATIONS_PACK_ID, TRANSLATION_FLAG_PATH } from "../translation/compendium-translation-repository";
import { readJournalTranslationFlag } from "../translation/journal";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Desk.${key}`);
export class TranslationDesk extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "foundry-translate-desk", classes: ["foundry-translate", "foundry-translate-desk-window"],
    position: { width: 580, height: "auto" }, window: { title: "FOUNDRY_TRANSLATE.Desk.Title", icon: "fa-solid fa-language", resizable: true } };
  protected async _renderHTML(): Promise<HTMLElement> {
    const settings = getTranslatorSettings();
    const glossary = await new GlossaryCompendiumRepository().loadExisting();
    const index = await game.packs.get(TRANSLATIONS_PACK_ID)?.getIndex({ fields: [TRANSLATION_FLAG_PATH] });
    const count = [...(index?.values() ?? [])].filter((r) => readJournalTranslationFlag(r.flags)?.targetLanguage === settings.targetLanguage).length;
    const root = document.createElement("section");
    root.className = "ft-settings ft-desk";
    root.innerHTML = `<header class="ft-settings__intro"><span class="ft-settings__brand-icon"><i class="fa-solid fa-language" aria-hidden="true"></i></span><div><h2>${t("Heading")}</h2><p>${t("Intro")}</p></div></header>
      <div class="ft-desk__status"><strong data-desk-language></strong><span data-desk-provider></span></div>
      <p class="ft-desk__tip">${t("PageTip")}</p>
      <div class="ft-desk__actions">
        <button type="button" data-desk-action="settings"><i class="fa-solid fa-plug" aria-hidden="true"></i><span><strong>${t("Settings")}</strong><small>${t("SettingsHint")}</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
        <button type="button" data-desk-action="glossary"><i class="fa-solid fa-book-bookmark" aria-hidden="true"></i><span><strong>${t("Glossary")}</strong><small>${t("GlossaryHint").replace("{count}", String(glossary.filter((e) => e.enabled !== false).length))}</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
        <button type="button" data-desk-action="bundles"><i class="fa-solid fa-box-archive" aria-hidden="true"></i><span><strong>${t("Bundles")}</strong><small>${t("BundlesHint").replace("{count}", String(count))}</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
      </div>
      <footer class="ft-settings__actions"><button type="button" class="ft-button ft-button--secondary" data-desk-action="active">${t("Active")}</button><button type="button" class="ft-button ft-button--primary" data-desk-action="journal">${t("Journal")}</button></footer>`;
    root.querySelector("[data-desk-language]")!.textContent = settings.targetLanguage.toUpperCase();
    root.querySelector("[data-desk-provider]")!.textContent = settings.provider === "chrome-local" ? "Chrome · " + t("Local") : settings.provider === "openai-compatible" ? "LM Studio · " + (settings.openAiModel || t("NotConfigured")) : "Google Cloud";
    return root;
  }
  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void { content.replaceChildren(result); }
  protected async _onRender(): Promise<void> {
    const open = (child: FoundryApplicationV2) => {
      child.addEventListener("close", () => { if (this.element.isConnected) void this.render({ force: true }); }, { once: true });
      return child.render(true);
    };
    const actions: Record<string, () => unknown> = { settings: () => open(new TranslatorSettingsApplication()), glossary: () => open(new GlossaryApplication()),
      bundles: () => open(new BundleApplication()), active: openActiveTranslationsOverview, journal: () => open(new JournalTranslationApplication()) };
    for (const button of this.element.querySelectorAll<HTMLElement>("[data-desk-action]")) {
      button.addEventListener("click", () => actions[button.dataset.deskAction ?? ""]?.());
    }
  }
}
export function openTranslationDesk(): void { void new TranslationDesk().render(true); }

export function registerTranslationDesk(): void {
  Hooks.on("renderJournalDirectory", (app: { element?: HTMLElement }, html?: HTMLElement) => {
    if (!game.user?.isGM) return;
    const root = html instanceof HTMLElement ? html : app.element;
    if (!root || root.querySelector(".ft-desk-launcher")) return;
    const header = root.querySelector(".directory-header");
    if (!header) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ft-desk-launcher";
    button.innerHTML = '<i class="fa-solid fa-language" aria-hidden="true"></i>';
    button.append(document.createTextNode(t("Title")));
    button.addEventListener("click", openTranslationDesk);
    header.append(button);
  });
}
