import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { hash, PolishContent } from "../src/content";
import { PolishWorkspace } from "../src/workspace";
import { parseEditorialProject } from "../../../src/review/project-format";
import { fixture } from "./fixture";

let root: string, workspace: PolishWorkspace, json: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "foundry-polish-test-")); workspace = await PolishWorkspace.create(root);
  json = JSON.stringify(fixture()); await writeFile(join(root, "input", "export.json"), json);
  await workspace.load("export.json");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function correction() {
  const content = workspace.current().content, unit = content.units.find(u => u.translation.join("").includes("vstoupil"))!;
  return { unitId: unit.id, revision: unit.revision, text: ["Poutníci vstoupili do Starého Carinthu."], labels: [], reason: "Shoda slovesa s podmětem v množném čísle.", category: "grammar" as const };
}
it("supplies contextual original, adjacent paragraphs, inflectable glossary and available linked documents", () => {
  const content = workspace.current().content;
  const unit = content.units.find(u => u.translation.length === 3)!;
  const context = content.context(unit.id, 2);
  expect(context.source).toHaveLength(3);
  expect(context.nearby).toHaveLength(3);
  expect(context.glossary.find(g => g.source === "Old Carinth")?.rule).toBe("INFLECT");
  expect(context.edit.references[0]).toMatchObject({ contextAvailable: true, relatedDocumentId: hash("Actor.scout") });
  expect(context.edit.references[1]).toMatchObject({ contextAvailable: false, relatedDocumentId: null });
});
it("persists suggestions, restores them after restart and exports a guarded import without modifying the input", async () => {
  const s = await workspace.propose(correction());
  const duplicate = await workspace.propose(correction()); expect(duplicate.id).toBe(s.id);
  workspace = await PolishWorkspace.create(root); await workspace.load("export.json");
  expect(workspace.status().suggestions).toBe(1);
  const output = await workspace.export([s.id]);
  const project = parseEditorialProject(await readFile(output.importFile, "utf8"));
  expect(project.version).toBe(2); expect(project.bundle.documents).toHaveLength(1);
  expect(project.baseTranslations![0]!.fields[2]!.translationHash).toBe(hash(fixture().documents[0]!.patches[2]!.translation));
  expect(project.bundle.documents[0]!.patches[2]!.translation).toContain("vstoupili");
  expect(project.reviews).toEqual([]);
  expect(await readFile(join(root, "input", "export.json"), "utf8")).toBe(json);
  expect(JSON.parse(await readFile(output.auditFile, "utf8")).verified).toBe(false);
  expect(await readFile(output.reviewFile, "utf8")).toContain("Shoda slovesa");
});
it("moves references across inline formatting and edits labels while preserving destinations", async () => {
  const content = workspace.current().content, unit = content.units.find(u => u.translation.length === 3)!;
  const context = content.context(unit.id, 0);
  const s = await workspace.propose({ unitId: unit.id, revision: unit.revision,
    text: ["V Ember si prohlédni ⟦2⟧, ", "potom", " potkej ⟦1⟧."],
    labels: [{ marker: context.edit.references[0]!.marker, label: "Zvěda" }], reason: "Přirozenější větná skladba a akuzativ.", category: "grammar" });
  expect(s.parts.join("")).toContain("@UUID[Actor.scout]{Zvěda}");
  expect(s.parts[0]).toContain("@Embed[JournalEntry.other inline]");
  const output = await workspace.export([s.id]);
  expect((await readFile(output.importFile, "utf8"))).toContain("<strong>potom</strong>");
});
it.each([
  ["missing marker", ["V Ember viz ⟦2⟧, ", "pak", " nic."], []],
  ["duplicate marker", ["V Ember viz ⟦2⟧ ⟦2⟧, ", "pak", " ⟦1⟧."], []],
  ["new marker", ["V Ember viz ⟦2⟧ ⟦3⟧, ", "pak", " ⟦1⟧."], []],
  ["new command", ["V Ember @Macro[evil] ⟦2⟧, ", "pak", " ⟦1⟧."], []],
  ["EXACT change", ["V Embře viz ⟦2⟧, ", "pak", " ⟦1⟧."], []],
  ["nested command label", ["V Ember viz ⟦2⟧, ", "pak", " ⟦1⟧."], [{ marker: "⟦1⟧", label: "@Macro[evil]" }]],
] as const)("rejects unsafe correction: %s", async (_name, text, labels) => {
  const unit = workspace.current().content.units.find(u => u.translation.length === 3)!;
  await expect(workspace.propose({ ...correction(), unitId: unit.id, revision: unit.revision, text: [...text], labels: [...labels] })).rejects.toThrow();
  expect(workspace.status().suggestions).toBe(0);
});
it("requires the current revision, reports numbers and rejects competing alternatives in one export", async () => {
  await expect(workspace.propose({ ...correction(), revision: "0".repeat(64) })).rejects.toThrow("Stale");
  const unit = workspace.current().content.units.find(u => u.translation.join("").includes("3 mince"))!;
  const s = await workspace.propose({ ...correction(), unitId: unit.id, revision: unit.revision, text: ["Zaplať 4 mince."] });
  expect(s.warnings).toHaveLength(1);
  const a = await workspace.propose(correction()), b = await workspace.propose({ ...correction(), text: ["Poutníci vešli do Starého Carinthu."] });
  await expect(workspace.export([a.id, b.id])).rejects.toThrow("one alternative");
  await expect(workspace.export([a.id, a.id])).rejects.toThrow("unique");
});
it("rejects stale files, traversal and file/directory symlinks", async () => {
  const s = await workspace.propose(correction());
  await writeFile(join(root, "input", "export.json"), json + "\n");
  await expect(workspace.propose(correction())).rejects.toThrow("changed on disk");
  await expect(workspace.export([s.id])).rejects.toThrow("changed on disk");
  await expect(workspace.load("../export.json")).rejects.toThrow("filename");
  await symlink(join(root, "input", "export.json"), join(root, "input", "link.json"));
  await expect(workspace.load("link.json")).rejects.toThrow();
  await rm(join(root, "sessions"), { recursive: true }); await mkdir(join(root, "elsewhere"));
  await symlink(join(root, "elsewhere"), join(root, "sessions"));
  await expect(PolishWorkspace.create(root)).rejects.toThrow("symlinks");
});
it("does not silently reset corrupt sessions; escapes HTML in the report", async () => {
  const s = await workspace.propose({ ...correction(), reason: '<script>alert("bad")</script>' });
  const output = await workspace.export([s.id]), html = await readFile(output.reviewFile, "utf8");
  expect(html).not.toContain('<script>alert'); expect(html).toContain("&lt;script&gt;");
  await writeFile(join(root, "sessions", `${hash(json)}.json`), "{}");
  await expect(workspace.load("export.json")).rejects.toThrow();
});
it("does not overwrite another MCP client's saved proposals", async () => {
  const other = await PolishWorkspace.create(root); await other.load("export.json");
  const first = await workspace.propose(correction());
  await expect(other.propose({ ...correction(), text: ["Poutníci vešli do Starého Carinthu."] })).rejects.toThrow("another client");
  await other.load("export.json");
  await other.propose({ ...correction(), text: ["Poutníci vešli do Starého Carinthu."] });
  await workspace.load("export.json");
  expect(workspace.current().suggestions.map(s => s.id)).toContain(first.id);
  expect(workspace.status().suggestions).toBe(2);
});
it("rejects public releases without originals and unaligned or mechanically altered exports", () => {
  expect(() => new PolishContent(JSON.stringify({ format: "foundry-translate-community" }))).toThrow("English source");
  const f = fixture(); f.documents[0]!.patches[2]!.translation = f.documents[0]!.patches[2]!.translation.replace("<strong>", "<em>").replace("</strong>", "</em>");
  expect(() => new PolishContent(JSON.stringify(f))).toThrow("HTML structure");
});
