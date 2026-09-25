import { MODULE_ID } from "../constants";
import { SETTINGS } from "../settings/settings";

/** CSS-only presentation preference; never changes text, document data or icons. */
export function applyCzechFonts(): void {
  const enabled = game.settings.get(MODULE_ID, SETTINGS.CZECH_FONTS) !== false;
  const language = String(game.i18n.lang ?? "");
  const target = String(game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? "cs");
  document.body.classList.toggle("ft-czech-fonts", enabled && [language, target].some(value => /^cs(?:-|$)/iu.test(value)));
}
