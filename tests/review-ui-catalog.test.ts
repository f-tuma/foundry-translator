import { afterEach, beforeEach, expect, it, vi } from "vitest";
let store: any, module: typeof import("../src/review/ui-catalog");
const source = { UI: { Greeting: "Hello, {name}.", Link: '<a href="https://example.test">More</a>' } };
const base = { UI: { Greeting: "Ahoj, {name}.", Link: '<a href="https://example.test">Více</a>' } };
beforeEach(async () => {
  vi.resetModules(); store = { version: 1, entries: [] };
  vi.stubGlobal("game", { user: { isGM: true, name: "GM" }, modules: new Map([["ember", { active: true }]]), system: { id: "crucible" },
    settings: { get: () => structuredClone(store), set: async (_ns: string, _key: string, value: any) => { store = structuredClone(value); }, register: vi.fn() },
    i18n: { lang: "en", translations: {}, setLanguage: async function(this: any, lang: string) { this.lang = lang; this.translations = structuredClone(base); } } });
  vi.stubGlobal("fetch", vi.fn(async (path: string) => ({ ok: true, json: async () => path.includes(".cs.json") ? base : source })));
  module = await import("../src/review/ui-catalog");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("loads the three installed catalogs, saves world overrides and verifies separately", async () => {
  let catalog = await module.loadUiCatalog(); expect(catalog.rows).toHaveLength(6);
  let row = catalog.rows[0]!;
  catalog = await module.saveUiRow(catalog, row, "Vítej, {name}.", "save"); row = catalog.rows.find(item => item.key === row.key && item.scope === row.scope)!;
  expect(row.value).toBe("Vítej, {name}."); expect(row.verified).toBe(false);
  catalog = await module.saveUiRow(catalog, row, row.value, "verify"); expect(catalog.rows[0]!.verified).toBe(true);
  catalog = await module.saveUiRow(catalog, catalog.rows[0]!, "Zdravím, {name}.", "save"); expect(catalog.rows[0]!.verified).toBe(false);
  catalog = await module.saveUiRow(catalog, catalog.rows[0]!, row.base, "reset"); expect(catalog.rows[0]!.value).toBe(row.base); expect(catalog.rows[0]!.override).toBeNull();
});
it("rejects broken variables and HTML addresses, and refuses stale saves", async () => {
  const catalog = await module.loadUiCatalog(), row = catalog.rows[0]!;
  await expect(module.saveUiRow(catalog, row, "Ahoj, {jméno}.", "save")).rejects.toThrow("UiFormatChanged");
  const link = catalog.rows[1]!;
  await expect(module.saveUiRow(catalog, link, '<a href="https://other.test">Více</a>', "save")).rejects.toThrow("UiFormatChanged");
  await module.saveUiRow(catalog, row, "Vítej, {name}.", "save");
  await expect(module.saveUiRow(catalog, row, "Čau, {name}.", "save")).rejects.toThrow("Conflict");
});
it("imports only compatible known keys with preview and discards imported verification", async () => {
  const catalog = await module.loadUiCatalog(), row = catalog.rows[0]!;
  const entries = [{ scope: row.scope, key: row.key, source: row.source, base: row.base, value: "Zdravím, {name}.", verified: "untrusted" },
    { scope: "core", key: "Missing.key", source: "Old", base: "Starý", value: "Nový" }];
  const text = JSON.stringify({ format: "foundry-translate-ui", version: 1, language: "cs", entries });
  const preview = module.previewUiImport(catalog, text); expect(preview.entries).toHaveLength(1); expect(preview.skipped).toBe(1);
  expect(store.entries).toHaveLength(0);
  const imported = await module.importUiOverrides(preview); expect(imported.rows[0]!.value).toBe("Zdravím, {name}."); expect(imported.rows[0]!.verified).toBe(false);
  expect(() => module.previewUiImport(imported, text.replace('UI.Greeting', '__proto__.bad'))).toThrow("UiImportInvalid");
});
it("applies overrides during language load and leaves other languages untouched", async () => {
  let catalog = await module.loadUiCatalog(); const row = catalog.rows[0]!;
  catalog = await module.saveUiRow(catalog, row, "Vítej, {name}.", "save");
  module.registerUiOverrides(); const i18n = game.i18n as any;
  await i18n.setLanguage("cs"); expect(i18n.translations.UI.Greeting).toBe("Vítej, {name}.");
  await i18n.setLanguage("en"); expect(i18n.translations.UI.Greeting).toBe(base.UI.Greeting);
  store.entries[0].source = "Changed English";
  await i18n.setLanguage("cs"); expect(i18n.translations.UI.Greeting).toBe(base.UI.Greeting);
});
it("does not allow non-GMs to edit or inspect world overrides", async () => {
  game.user!.isGM = false; await expect(module.loadUiCatalog()).rejects.toThrow("GMOnly");
});
