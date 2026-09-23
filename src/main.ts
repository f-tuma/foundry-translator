import { registerNameForms } from "./review/name-consistency";
import { createApi } from "./api";
import { MODULE_HOOKS, MODULE_ID, MODULE_TITLE } from "./constants";
import { logger } from "./logger";
import { registerSettings } from "./settings/register-settings";
import { registerJournalTranslationHeaderControl } from "./translation/journal-header-control";
import { registerGlossaryCandidateHooks } from "./glossary/candidate-hooks";
import { registerTranslatedLinkNavigation } from "./translation/translated-link-navigation";
import { registerTranslationDesk } from "./ui/translation-desk";
import { organizeExistingStoragePacks } from "./storage/compendium-folder";
import { registerCrucibleEmbedLabels } from "./translation/crucible-embed-labels";
import { registerEmberRuntimeBridge } from "./translation/ember-runtime-bridge";
import { registerDisplayTextView } from "./translation/display-text-view";

import { registerReviewHeaderControl } from "./review/header-control";
import { registerUiOverrides } from "./review/ui-catalog";

let ready = false;

Hooks.once("init", () => {
  registerSettings();
  registerUiOverrides();
  registerNameForms();
  registerReviewHeaderControl();
  registerJournalTranslationHeaderControl();
  registerGlossaryCandidateHooks();
  registerTranslationDesk();

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
  registerCrucibleEmbedLabels();
  registerEmberRuntimeBridge();
  registerTranslatedLinkNavigation();
  registerDisplayTextView();
  void organizeExistingStoragePacks().catch((error) => {
    logger.error("Translation compendia could not be organized.", error);
  });
  Hooks.callAll(MODULE_HOOKS.READY);
  logger.info(`${MODULE_TITLE} is ready.`);
});
