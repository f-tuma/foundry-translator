import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { MODULE_ID } from "../src/constants";
import { translateDisplayText, readDisplayTextFlag } from "../src/translation/display-text";
import { extendEquipmentAffixRecord } from "../src/translation/equipment-affix-extension";
import { translatedOutputHash } from "../src/translation/output-hash";
class StringField {}
class HTMLField {}
class CrucibleActionField { fields = { id: new StringField(), name: new StringField(), description: new HTMLField(), condition: new StringField() }; }
class ArrayField { element = new CrucibleActionField(); }
class CrucibleAffixActiveEffect { static schema = { fields: { actions: new ArrayField() } }; }
const sourceUuid = "Compendium.crucible.equipment.Item.pearl.ActiveEffect.focusing00000000";
const source = () => ({ _id: "focusing00000000", type: "affix", name: "Focusing", description: "<p>Gain 4 Focus.</p>",
  system: { tier: { value: 1 }, actions: [{ id: "affixFocusing", name: "Replenish Focus", description: "<p>Recover 4 Focus.</p>", condition: "", cost: { action: 2 } }] } });
beforeEach(() => {
  vi.stubGlobal("game", { user: { id: "gm" }, system: { id: "crucible" } });
  vi.stubGlobal("CONFIG", { ActiveEffect: { dataModels: { affix: CrucibleAffixActiveEffect } } });
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
});
afterEach(() => vi.unstubAllGlobals());
async function records() {
  const data = source(), legacy = structuredClone(data); delete (legacy.system as any).actions;
  const options: any = { sourceUuid, kind: "ActiveEffect", glossary: [], glossaryHash: "g", providerHash: "p",
    settings: { providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs" },
    provider: { translate: async ({ texts }: any) => texts.map((text: string) => ({ translatedText: text.replace("Focusing", "Soustředění").replace("Replenish Focus", "Obnova Soustředění").replace("Gain 4 Focus.", "Získej 4 body soustředění.").replace("Recover 4 Focus.", "Obnov 4 body soustředění.") })) } };
  const prior = await translateDisplayText({ ...options, source: legacy });
  prior.name = "Ručně Upravený Název";
  prior.pages[0]!.text!.content = "<p>Ručně Upravené Heslo</p>";
  prior.ownership = { default: 0 }; prior.folder = "private";
  prior.flags!["other-module"] = { custom: "preserve" };
  prior.flags![MODULE_ID]!.review = { entries: { existing: { userId: "human" } } };
  prior.flags![MODULE_ID]!.reviewHistory = { old: { id: "old", rows: [] } };
  const addition = await translateDisplayText({ ...options, source: data,
    onlyPaths: [["system", "actions", "affixFocusing", "name"], ["system", "actions", "affixFocusing", "description"]] });
  return { data, prior, addition };
}
it("appends only new Action pages, preserving corrected prose, permissions and human history exactly", async () => {
  const { data, prior, addition } = await records(), before = structuredClone(prior);
  const merged = await extendEquipmentAffixRecord(data, sourceUuid, "cs", prior, addition);
  expect(prior).toEqual(before); expect(merged.pages.slice(0, before.pages.length)).toEqual(before.pages);
  expect(merged.pages.slice(before.pages.length)).toEqual(addition.pages);
  for (const key of ["name", "ownership", "folder"] as const) expect(merged[key]).toEqual(before[key]);
  expect(merged.flags!["other-module"]).toEqual(before.flags!["other-module"]);
  for (const key of ["review", "reviewHistory"]) expect(merged.flags![MODULE_ID]![key]).toEqual(before.flags![MODULE_ID]![key]);
  const flag = readDisplayTextFlag(merged.flags)!;
  expect(flag.affixSourceHash).toBe(readDisplayTextFlag(addition.flags)!.affixSourceHash);
  expect(flag.fields).toHaveLength(4); expect(flag.outputHash).toBe(await translatedOutputHash(merged));
  expect(merged.flags![MODULE_ID]!.affixActionAddition).toMatchObject({ prior: readDisplayTextFlag(before.flags), addedPageIds: addition.pages.map(page => page._id) });
});
it.each(["stale-source", "wrong-language", "wrong-owner", "duplicate-page", "missing-base-page", "extra-page", "changed-base-command", "changed-action-number", "changed-path", "already-extended"])("reserves unsafe record: %s", async problem => {
  const { data, prior, addition } = await records();
  if (problem === "stale-source") data.description = "<p>New source.</p>";
  if (problem === "wrong-language") readDisplayTextFlag(prior.flags)!.targetLanguage = "de";
  if (problem === "wrong-owner") readDisplayTextFlag(prior.flags)!.sourceUuid = "ActiveEffect.foreign";
  if (problem === "duplicate-page") addition.pages[0]!._id = prior.pages[0]!._id!;
  if (problem === "missing-base-page") prior.pages.pop();
  if (problem === "extra-page") prior.pages.push({ _id: "extra00000000000", type: "text", name: "Unknown", text: { content: "<p>Unknown</p>" } });
  if (problem === "changed-base-command") prior.pages[1]!.text!.content = "<p>Gain 4 @UUID[Item.foreign].</p>";
  if (problem === "changed-action-number") addition.pages[1]!.text!.content = "<p>Obnov 8 body soustředění.</p>";
  if (problem === "changed-path") readDisplayTextFlag(addition.flags)!.fields[0]!.path[2] = "foreignAction";
  if (problem === "already-extended") readDisplayTextFlag(prior.flags)!.affixSourceHash = "a".repeat(64);
  await expect(extendEquipmentAffixRecord(data, sourceUuid, "cs", prior, addition)).rejects.toThrow("cannot be extended safely");
});
