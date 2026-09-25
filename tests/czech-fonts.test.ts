import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { applyCzechFonts } from "../src/ui/czech-fonts";

afterEach(() => vi.unstubAllGlobals());
it("applies Czech fonts for Czech UI or translations and can be disabled without a reload", () => {
  const { document } = parseHTML('<html><body><h1>Příručka Žluťoučkého Koně</h1><i class="fa-user"></i></body></html>');
  const values: Record<string, unknown> = { targetLanguage: "cs", czechFonts: true };
  const i18n = { lang: "en" };
  vi.stubGlobal("document", document);
  vi.stubGlobal("game", { i18n, settings: { get: (_ns: string, key: string) => values[key] } });
  applyCzechFonts(); expect(document.body.classList.contains("ft-czech-fonts")).toBe(true);
  values.czechFonts = false; applyCzechFonts(); expect(document.body.classList.contains("ft-czech-fonts")).toBe(false);
  values.czechFonts = true; values.targetLanguage = "de";
  applyCzechFonts(); expect(document.body.classList.contains("ft-czech-fonts")).toBe(false);
  i18n.lang = "cs"; applyCzechFonts(); expect(document.body.classList.contains("ft-czech-fonts")).toBe(true);
  expect(document.querySelector("h1")?.textContent).toBe("Příručka Žluťoučkého Koně");
  expect(document.querySelector("i")?.className).toBe("fa-user");
});
