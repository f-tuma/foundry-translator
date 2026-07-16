import { createApi } from "./api";
import { MODULE_HOOKS, MODULE_ID, MODULE_TITLE } from "./constants";
import { logger } from "./logger";
import { registerSettings } from "./settings/register-settings";
import { registerJournalTranslationHeaderControl } from "./translation/journal-header-control";
import { registerGlossaryCandidateHooks } from "./glossary/candidate-hooks";
import { registerTranslatedLinkNavigation } from "./translation/translated-link-navigation";

let ready = false;

Hooks.once("init", () => {
  registerSettings();
  registerJournalTranslationHeaderControl();
  registerGlossaryCandidateHooks();

  const module = game.modules.get(MODULE_ID);

  if (!module) {
    logger.error("Module registration was not found in game.modules.");
    return;
  }

  module.api = createApi(() => ready);
  logger.info("Initialized.");
});

Hooks.once("ready", () => {
  ready = true;
  registerTranslatedLinkNavigation();
  Hooks.callAll(MODULE_HOOKS.READY);
  logger.info(`${MODULE_TITLE} is ready.`);
});
