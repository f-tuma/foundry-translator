import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogContract, catalogEntries, formatSignature } from "../scripts/ui-catalog-format.mjs";
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const contracts = json("./fixtures/ui-catalog-contracts.json");
const manifest = json("../public/module.json");
const overrides = json("../scripts/ui-czech-overrides.json");

describe("Czech interface catalogs", () => {
  for (const [name, expected] of Object.entries(contracts.catalogs)) {
    it(`preserves every ${name} key, interpolation variable and HTML tag`, () => {
      const catalog = json(`../public/lang/${name}.cs.json`);
      expect(catalogContract(catalog)).toEqual({ strings: expected.strings, signature: expected.signature });
      for (const [, value] of catalogEntries(catalog)) expect(value).not.toMatch(/__FT|\bi\d+\s*:/u);
      const values = Object.fromEntries(catalogEntries(catalog).map(([path, value]) => [path.join("."), value]));
      for (const [key, reviewed] of Object.entries(overrides[name] ?? {})) expect(values[key], key).toBe(reviewed);
    });
  }

  it("loads dictionaries through Foundry before schemas are localized, with system and module scope", () => {
    expect(manifest.coreTranslation).toBe(true);
    expect(manifest.languages).toContainEqual({ lang: "cs", name: "Čeština", path: "lang/core.cs.json" });
    expect(manifest.languages).toContainEqual({ lang: "cs", name: "Čeština", path: "lang/crucible.cs.json", system: "crucible" });
    expect(manifest.languages).toContainEqual({ lang: "cs", name: "Čeština", path: "lang/ember.cs.json", module: "ember" });
    for (const language of manifest.languages) expect(() => json(`../public/${language.path}`)).not.toThrow();
  });

  it("allows moved variables but detects renamed placeholders and reordered tags", () => {
    expect(formatSignature("{name}: {count}")).toEqual(formatSignature("{count} pro {name}"));
    expect(formatSignature("{name}: {count}")).not.toEqual(formatSignature("{jméno}: {count}"));
    expect(formatSignature("<p><strong>name</strong></p>")).not.toEqual(formatSignature("<strong><p>jméno</p></strong>"));
    expect(formatSignature("<Unnamed Category>")).toEqual(formatSignature("<Nepojmenovaná kategorie>"));
    expect(formatSignature('<a href="url">name</a>')).not.toEqual(formatSignature('<a href="other">jméno</a>'));
    expect(formatSignature("")).not.toEqual(formatSignature("Vymyšlený text"));
  });
});
