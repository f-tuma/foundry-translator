import { MODULE_ID } from "../constants";
import { GlossaryApplication } from "../glossary/glossary-app";
import { SETTINGS } from "./settings";
import { TranslatorSettingsApplication } from "./translator-settings-app";
import { JournalTranslationApplication } from "../translation/journal-translation-app";

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.PROVIDER, {
    name: "FOUNDRY_TRANSLATE.Settings.Provider.Name",
    hint: "FOUNDRY_TRANSLATE.Settings.Provider.Hint",
    scope: "world",
    config: false,
    type: String,
    default: "chrome-local",
  });

  game.settings.register(MODULE_ID, SETTINGS.GOOGLE_API_KEY, {
    name: "FOUNDRY_TRANSLATE.Settings.ApiKey.Name",
    hint: "FOUNDRY_TRANSLATE.Settings.ApiKey.Hint",
    scope: "client",
    config: false,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, SETTINGS.SOURCE_LANGUAGE, {
    name: "FOUNDRY_TRANSLATE.Settings.SourceLanguage.Name",
    hint: "FOUNDRY_TRANSLATE.Settings.SourceLanguage.Hint",
    scope: "world",
    config: false,
    type: String,
    default: "auto",
  });

  game.settings.register(MODULE_ID, SETTINGS.TARGET_LANGUAGE, {
    name: "FOUNDRY_TRANSLATE.Settings.TargetLanguage.Name",
    hint: "FOUNDRY_TRANSLATE.Settings.TargetLanguage.Hint",
    scope: "world",
    config: false,
    type: String,
    default: "cs",
  });

  game.settings.registerMenu(MODULE_ID, "googleProvider", {
    name: "FOUNDRY_TRANSLATE.Settings.Menu.Name",
    label: "FOUNDRY_TRANSLATE.Settings.Menu.Label",
    hint: "FOUNDRY_TRANSLATE.Settings.Menu.Hint",
    icon: "fa-solid fa-language",
    type: TranslatorSettingsApplication,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "glossary", {
    name: "FOUNDRY_TRANSLATE.Glossary.Menu.Name",
    label: "FOUNDRY_TRANSLATE.Glossary.Menu.Label",
    hint: "FOUNDRY_TRANSLATE.Glossary.Menu.Hint",
    icon: "fa-solid fa-book-bookmark",
    type: GlossaryApplication,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "translateJournal", {
    name: "FOUNDRY_TRANSLATE.JournalTranslation.Menu.Name",
    label: "FOUNDRY_TRANSLATE.JournalTranslation.Menu.Label",
    hint: "FOUNDRY_TRANSLATE.JournalTranslation.Menu.Hint",
    icon: "fa-solid fa-book-open-reader",
    type: JournalTranslationApplication,
    restricted: true,
  });
}
