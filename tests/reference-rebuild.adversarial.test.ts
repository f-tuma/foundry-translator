import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assertPortableText, diagnosePortableText } from "../src/bundles/format";
import { prepareReferenceRebuild, materializeReferenceRebuild, validateReferenceRebuildChanges, undoReferenceRebuild, type ReferenceRebuildEdit } from "../src/review/reference-rebuild";
import { portableReviewText, loadReview, saveReviewRows, type ReviewSnapshot } from "../src/review/service";
import { correctionWarnings } from "../src/polish/quality-guards";
import { MODULE_ID } from "../src/constants";
import { TRANSLATIONS_PACK_ID } from "../src/translation/compendium-translation-repository";
import { journalSourceHash, type JournalData } from "../src/translation/journal";
import { translatedOutputHash } from "../src/translation/output-hash";
import { activeTranslations } from "../src/translation/active-translations";
import { planReviewText } from "../src/review/text-plan";

// Synthetic data only. Tests deliberately never infer a damaged target's labels
// or command occurrence order as the identity of a source-owned reference.
const SOURCE_PARENT = "Actor.original";
const COPY_PARENT = "Compendium.world.actorCopies.Actor.copy";
let unavailable = new Set<string>();
beforeEach(() => {
  vi.stubGlobal("document", parseHTML("<html><body></body></html>").document);
  unavailable = new Set();
  vi.stubGlobal("game", { system: { id: "crucible" }, modules: new Map([["ember", { active: true, version: "0.6.2" }]]) });
  vi.stubGlobal("fromUuid", vi.fn(async (uuid: string) => unavailable.has(uuid) ? null : {
    uuid, documentName: uuid.includes(".Item.") ? "Item" : "Actor", visible: true,
    parent: { uuid: COPY_PARENT, visible: true },
  }));
});
afterEach(() => {
  for (const run of activeTranslations.list()) activeTranslations.finish(run.id);
  activeTranslations.clearFinished();
  vi.unstubAllGlobals();
});

function snapshot(source: string, translation: string, reverse = new Map([[COPY_PARENT, SOURCE_PARENT]])): ReviewSnapshot {
  const field = { id: "field", source, translation, format: "html" as const, targetPath: ["description"], displayPlain: false };
  const view: ReviewSnapshot = {
    entry: { id: "copy", pack: "world.translations", uuid: "Compendium.world.translations.JournalEntry.copy", name: "Synthetic guide", kind: "JournalEntry", sourceUuid: "JournalEntry.original", language: "cs" },
    sourceName: "Synthetic guide", rows: [], fields: [field], groups: [], sourceHash: "s".repeat(64), warning: null, partial: false,
    guard: { fingerprint: "g".repeat(64) } as ReviewSnapshot["guard"], reverse,
  };
  const blocked = diagnosePortableText(source, portableReviewText(view, field, translation), "html") ? "StructureChanged" : null;
  const target = planReviewText(translation, "html");
  view.rows = planReviewText(source, "html").units.map((unit, index) => ({
    id: `row-${index}`, fieldId: field.id, unitId: unit.id, format: "html", group: "document", label: "description",
    source: [...unit.parts], translation: [...(target.units.find(row => row.id === unit.id)?.parts ?? [])],
    heading: unit.heading, fingerprint: `fingerprint-${index}`, blocked, verified: null,
  }));
  return view;
}
const broken = () => snapshot(
  `<p>First @UUID[${SOURCE_PARENT}.Item.alpha]{First} then @UUID[${SOURCE_PARENT}.Item.beta]{Second} for 2 turns.</p><p>Keep @UUID[${SOURCE_PARENT}.Item.gamma]{Third} for 3 turns.</p>`,
  `<p>Druhá @UUID[${COPY_PARENT}]{Druhá} a první @UUID[${COPY_PARENT}]{První} na 2 tahy.</p><p>Zachovat @UUID[${COPY_PARENT}.Item.gamma]{Třetí} na 3 tahy.</p>`,
);
async function prepared(view = broken()) {
  const plan = await prepareReferenceRebuild(view, "field");
  expect(plan).not.toBeNull();
  return { view, plan: plan! };
}
const editsFor = (plan: NonNullable<Awaited<ReturnType<typeof prepareReferenceRebuild>>>): ReferenceRebuildEdit[] => plan.rows.map(row => ({ rowId: row.rowId, text: [...row.edit.text], labels: [] }));

it("proves, materializes and undoes an inactive Ember punctuation leaf through the complete field guards", async () => {
  const original = '<p>First<sup class="system-swap-inline"><sub data-system="dnd5e">,</sub></sup> second.</p><p>Keep other prose.</p>';
  const before = '<p>První<sup class="system-swap-inline"><sub data-system="dnd5e"></sub></sup> druhá.</p><p>Zachovat další text.</p>';
  const view = snapshot(original, before), { plan } = await prepared(view);
  expect(plan.punctuation).toEqual({ parentPath: [0, 1, 0], text: ",", unitId: "html/0", partIndex: 1 });
  expect(plan.rows).toHaveLength(1);
  const compiled = await materializeReferenceRebuild(view, plan, editsFor(plan));
  expect(compiled.value).toBe(before.replace('<sub data-system="dnd5e"></sub>', '<sub data-system="dnd5e">,</sub>'));
  assertPortableText(original, portableReviewText(view, view.fields[0]!, compiled.value), "html");
  expect((await validateReferenceRebuildChanges(view, "field", plan.proofHash, compiled.changes)).value).toBe(compiled.value);
  const current = snapshot(original, compiled.value), recorded = compiled.changes.map(change => ({ rowId: change.rowId,
    before: [...view.rows.find(row => row.id === change.rowId)!.translation], after: change.parts }));
  expect((await undoReferenceRebuild(current, compiled.receipt, recorded)).value).toBe(before);
  const edits = editsFor(plan); edits[0]!.text[1] = ";";
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow("ProtectedText");
  vi.stubGlobal("game", { system: { id: "crucible" }, modules: new Map([["ember", { active: true, version: "0.6.3" }]]) });
  await expect(materializeReferenceRebuild(view, plan, editsFor(plan))).rejects.toThrow("Conflict");
});

const SOURCE_GUIDE = "JournalEntry.original", COPY_GUIDE = "Compendium.world.translations.JournalEntry.copy";
function relativeSnapshot(source: string, translation: string, reverse = new Map([[COPY_GUIDE, SOURCE_GUIDE]])) {
  const view = snapshot(source, translation, reverse);
  view.fields[0]!.referenceContext = `${SOURCE_GUIDE}.JournalEntryPage.chapter`;
  return view;
}

it("preserves source-owned mixed relative and absolute UUID spellings while independently binding their absolute target", async () => {
  const command = "@UUID";
  const sourceTarget = `${SOURCE_GUIDE}.JournalEntryPage.next#section`, target = `${COPY_GUIDE}.JournalEntryPage.next#section`;
  const source = `<p>First ${command}[.next#section]{First}, then ${command}[${sourceTarget}]{Second}.</p>`;
  const translation = `<p>První ${command}[${target}]{První}, potom ${command}[${target}]{Druhá}.</p>`;
  const view = relativeSnapshot(source, translation), { plan } = await prepared(view);
  expect(plan.rows[0]!.referenceMap.map(ref => ref.command)).toEqual([
    `${command}[.next#section]{First}`, `${command}[${target}]{Second}`,
  ]);
  expect(plan.rows[0]!.referenceMap.every(ref => ref.sourceTarget === sourceTarget && ref.target === target && ref.required)).toBe(true);
  expect(plan.targets).toEqual([{ sourceTarget, target, required: true }]);
  const references = plan.rows[0]!.edit.references[0]!, edits = editsFor(plan);
  // The agent still controls Czech order and labels, not the binding.
  edits[0]!.text[0] = `Nejprve ${references[1]!.marker}, potom ${references[0]!.marker}.`;
  edits[0]!.labels = references.map((ref, index) => ({ marker: ref.marker, label: index ? "Druhá" : "První" }));
  const compiled = await materializeReferenceRebuild(view, plan, edits);
  expect(compiled.value).toBe(`<p>Nejprve ${command}[${target}]{Druhá}, potom ${command}[.next#section]{První}.</p>`);
  assertPortableText(source, portableReviewText(view, view.fields[0]!, compiled.value), "html");
  const proved = await validateReferenceRebuildChanges(view, "field", plan.proofHash, compiled.changes);
  expect(proved.value).toBe(compiled.value);
  const current = relativeSnapshot(source, compiled.value);
  const recorded = compiled.changes.map(change => ({ rowId: change.rowId, before: [...view.rows.find(row => row.id === change.rowId)!.translation], after: change.parts }));
  expect((await undoReferenceRebuild(current, compiled.receipt, recorded)).value).toBe(translation);
});

it.each([
  [".", "JournalEntryPage.chapter"], [".next", "JournalEntryPage.next"], ["..JournalEntryPage.next", "JournalEntryPage.next"],
])("retains exact source spelling %s only after copied-context resolution, preserving whitespace, case and anchors", async (relative, suffix) => {
  const sourceTarget = `${SOURCE_GUIDE}.${suffix}#detail`, target = `${COPY_GUIDE}.${suffix}#detail`;
  const view = relativeSnapshot(`<p>@uUiD[  ${relative}#detail\t]{First} @UUID[${sourceTarget}]{Second}</p>`,
    `<p>@uUiD[  ${target}\t]{První} @UUID[${target}]{Druhá}</p>`);
  const { plan } = await prepared(view);
  expect(plan.rows[0]!.referenceMap[0]!.command).toBe(`@uUiD[  ${relative}#detail\t]{First}`);
  expect(plan.rows[0]!.referenceMap[0]!.target).toBe(target);
  const result = await materializeReferenceRebuild(view, plan, editsFor(plan));
  assertPortableText(view.fields[0]!.source, portableReviewText(view, view.fields[0]!, result.value), "html");
});

it.each(["different-copy", "multiple-copies", "missing-provenance", "foreign-context"])("refuses ambiguous mixed notation without exact copied-context mapping: %s", async kind => {
  const target = `${COPY_GUIDE}.JournalEntryPage.next`, sourceTarget = `${SOURCE_GUIDE}.JournalEntryPage.next`;
  const view = relativeSnapshot(`<p>@UUID[.next] @UUID[${sourceTarget}]</p>`, `<p>@UUID[${target}] @UUID[${target}]</p>`);
  if (kind === "different-copy") { view.reverse.clear(); view.reverse.set("Compendium.world.translations.JournalEntry.other", SOURCE_GUIDE); }
  if (kind === "multiple-copies") view.reverse.set("Compendium.world.translations.JournalEntry.other", SOURCE_GUIDE);
  if (kind === "missing-provenance") view.reverse.clear();
  if (kind === "foreign-context") view.fields[0]!.referenceContext = "JournalEntry.foreign.JournalEntryPage.chapter";
  expect(await prepareReferenceRebuild(view, "field")).toBeNull();
});

it("rejects stale copied field context and caller substitution of equivalent absolute notation after prepare", async () => {
  const target = `${COPY_GUIDE}.JournalEntryPage.next`, sourceTarget = `${SOURCE_GUIDE}.JournalEntryPage.next`;
  const view = relativeSnapshot(`<p>@UUID[.next] @UUID[${sourceTarget}]</p>`, `<p>@UUID[${target}] @UUID[${target}]</p>`);
  const { plan } = await prepared(view), compiled = await materializeReferenceRebuild(view, plan, editsFor(plan));
  const tampered = structuredClone(compiled.changes);
  tampered[0]!.parts[0] = tampered[0]!.parts[0]!.replace("@UUID[.next]", `@UUID[${target}]`);
  await expect(validateReferenceRebuildChanges(view, "field", plan.proofHash, tampered)).rejects.toThrow("ReferenceChanged");
  view.fields[0]!.referenceContext = SOURCE_GUIDE;
  await expect(materializeReferenceRebuild(view, plan, editsFor(plan))).rejects.toThrow("Conflict");
});

it("keeps the existing conservative Embed caption guard for ambiguous equivalent occurrences", async () => {
  const sourceTarget = `${SOURCE_GUIDE}.JournalEntryPage.next`, target = `${COPY_GUIDE}.JournalEntryPage.next`;
  const view = relativeSnapshot(`<p>@Embed[.next caption="First"] @Embed[${sourceTarget} caption="Second"]</p>`,
    `<p>@Embed[${target} caption="First"] @Embed[${target} caption="Second"]</p>`);
  expect(await prepareReferenceRebuild(view, "field")).toBeNull();
});

const punctuationSource = '<p>First<strong>,</strong> then &Reference[Exhaustion] for 2 turns.</p><p>Keep other prose for 3 turns.</p>';
const punctuationBefore = '<p>První<strong></strong> potom na 2 tahy.</p><p>Zachovat jiný text na 3 tahy.</p>';
it("atomically restores one punctuation leaf and a missing source reference with original before layout, receipt and exact undo", async () => {
  const view = snapshot(punctuationSource, punctuationBefore), { plan } = await prepared(view);
  expect(plan.punctuation).toEqual({ parentPath: [0, 1], text: ",", unitId: "html/0", partIndex: 1 });
  const row = plan.rows[0]!;
  expect(row.before).toHaveLength(2);
  expect(row.alignedBefore).toEqual(["První", ",", " potom na 2 tahy."]);
  expect(row.partIndices).toEqual([1, 2]);
  expect(row.baseline).toEqual(["První", ",", " then &Reference[Exhaustion] for 2 turns."]);
  const edits = editsFor(plan);
  edits[0]!.text[2] = ` potom ${row.edit.references[2]![0]!.marker} na 2 tahy.`;
  const compiled = await materializeReferenceRebuild(view, plan, edits);
  expect(compiled.value).toBe('<p>První<strong>,</strong> potom &amp;Reference[Exhaustion] na 2 tahy.</p><p>Zachovat jiný text na 3 tahy.</p>');
  expect(compiled.receipt.punctuation).toEqual(plan.punctuation);
  expect(compiled.numbers.find(proof => proof.partIndex === 2)).toEqual(expect.objectContaining({ before: ["2"], after: ["2"] }));
  assertPortableText(punctuationSource, portableReviewText(view, view.fields[0]!, compiled.value), "html");
  expect((await validateReferenceRebuildChanges(view, "field", plan.proofHash, compiled.changes)).value).toBe(compiled.value);
  const recorded = compiled.changes.map(change => ({ rowId: change.rowId, before: [...view.rows.find(row => row.id === change.rowId)!.translation], after: [...change.parts] }));
  const current = snapshot(punctuationSource, compiled.value.replace("Zachovat jiný text", "Pozdější jiný text"));
  expect((await undoReferenceRebuild(current, compiled.receipt, recorded)).value).toBe(punctuationBefore.replace("Zachovat jiný text", "Pozdější jiný text"));
});

it.each(["punctuation-edit", "punctuation-number", "forged-address", "forged-text", "changed-prose-number"])("refuses caller modification of source-owned punctuation or shifted number guards: %s", async kind => {
  const view = snapshot(punctuationSource, punctuationBefore), { plan } = await prepared(view), edits = editsFor(plan);
  if (kind === "punctuation-edit") edits[0]!.text[1] = ";";
  if (kind === "punctuation-number") edits[0]!.text[1] = "2";
  if (kind === "forged-address") plan.punctuation!.parentPath = [99];
  if (kind === "forged-text") plan.punctuation!.text = "Missing words";
  if (kind === "changed-prose-number") edits[0]!.text[2] = edits[0]!.text[2]!.replace("2", "3");
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
});

it("restores only a source-proved punctuation leaf without requiring a command defect, with exact undo", async () => {
  const before = punctuationBefore.replace("potom na", "potom &amp;Reference[Exhaustion] na");
  const view = snapshot(punctuationSource, before), { plan } = await prepared(view);
  expect(plan.rows).toHaveLength(1);
  expect(plan.rows[0]!.partIndices).toEqual([1]);
  expect(plan.rows[0]!.referenceMap).toEqual([]);
  expect(plan.targets).toEqual([]);
  const compiled = await materializeReferenceRebuild(view, plan, editsFor(plan));
  expect(compiled.value).toBe(before.replace("<strong></strong>", "<strong>,</strong>"));
  assertPortableText(punctuationSource, portableReviewText(view, view.fields[0]!, compiled.value), "html");
  expect((await validateReferenceRebuildChanges(view, "field", plan.proofHash, compiled.changes)).value).toBe(compiled.value);
  const recorded = compiled.changes.map(change => ({ rowId: change.rowId, before: [...view.rows.find(row => row.id === change.rowId)!.translation], after: [...change.parts] }));
  expect((await undoReferenceRebuild(snapshot(punctuationSource, compiled.value), compiled.receipt, recorded)).value).toBe(before);
});

it.each(["changed-unrelated-prose", "changed-punctuation", "changed-reference-label"])("protects every existing part during a punctuation-only rebuild: %s", async kind => {
  const before = punctuationBefore.replace("potom na", "potom &Reference[Exhaustion]{Vyčerpání} na");
  const { view, plan } = await prepared(snapshot(punctuationSource.replace("&Reference[Exhaustion]", "&Reference[Exhaustion]{Exhaustion}"), before));
  const edits = editsFor(plan);
  if (kind === "changed-unrelated-prose") edits[0]!.text[0] = "Jiné slovo";
  if (kind === "changed-punctuation") edits[0]!.text[1] = ";";
  if (kind === "changed-reference-label") edits[0]!.labels = [{ marker: plan.rows[0]!.edit.references[2]![0]!.marker, label: "Jiný" }];
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
});

it("restores a punctuation row separately from the command-damaged row while keeping both in one field receipt", async () => {
  const view = snapshot('<p>First<strong>,</strong> then second.</p><p>&Reference[Exhaustion] for 2 turns.</p>',
    '<p>První<strong></strong> potom druhá.</p><p>Na 2 tahy.</p>');
  const { plan } = await prepared(view);
  expect(plan.rows).toHaveLength(2);
  const compiled = await materializeReferenceRebuild(view, plan, editsFor(plan));
  expect(compiled.changes).toHaveLength(2);
  expect(compiled.value).toContain('První<strong>,</strong> potom druhá.');
  assertPortableText(view.fields[0]!.source, portableReviewText(view, view.fields[0]!, compiled.value), "html");
});

it("regenerates two collapsed siblings from source identities, never target label/order, and retains unrelated current prose", async () => {
  const { view, plan } = await prepared(); const before = JSON.stringify(view);
  expect(plan.rows).toHaveLength(1);
  const row = plan.rows[0]!, references = row.edit.references.flat();
  expect(references.map(ref => ref.command)).toEqual([
    `@UUID[${COPY_PARENT}.Item.alpha]{First}`,
    `@UUID[${COPY_PARENT}.Item.beta]{Second}`,
  ]);
  const edits = [{ rowId: row.rowId, text: [`Druhá ${references[1]!.marker} a první ${references[0]!.marker} na 2 tahy.`], labels: [
    { marker: references[0]!.marker, label: "První" }, { marker: references[1]!.marker, label: "Druhá" },
  ] }];
  const rebuilt = await materializeReferenceRebuild(view, plan, edits);
  expect(rebuilt.value).toContain(`Druhá @UUID[${COPY_PARENT}.Item.beta]{Druhá} a první @UUID[${COPY_PARENT}.Item.alpha]{První}`);
  expect(rebuilt.value).toContain(`<p>Zachovat @UUID[${COPY_PARENT}.Item.gamma]{Třetí} na 3 tahy.</p>`);
  expect(rebuilt.changes).toHaveLength(1);
  assertPortableText(view.fields[0]!.source, portableReviewText(view, view.fields[0]!, rebuilt.value), "html");
  expect(JSON.stringify(view)).toBe(before);
});

it.each(["⟦999⟧", "@UUID[Actor.attacker]", "@Embed[Actor.attacker]", "&Reference[Attacker]", "[[/roll 99d99]]"])("rejects caller injection %s even when source markers remain", async extra => {
  const { view, plan } = await prepared(); const edits = editsFor(plan);
  edits[0]!.text[0] += ` ${extra}`;
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
});

it.each(["missing", "extra", "duplicate", "wrong-row", "wrong-part-count"])("requires the exact planned row/part set: %s", async kind => {
  const { view, plan } = await prepared(); const edits = editsFor(plan);
  if (kind === "missing") edits.length = 0;
  if (kind === "extra") edits.push({ rowId: "row-1", text: ["Replace untouched prose."], labels: [] });
  if (kind === "duplicate") edits.push(structuredClone(edits[0]!));
  if (kind === "wrong-row") edits[0]!.rowId = "foreign-row";
  if (kind === "wrong-part-count") edits[0]!.text.push("Extra formatted part.");
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
});

it.each(["sourceHash", "guard", "source", "translation", "provenance"])("rejects stale plan authority: %s", async kind => {
  const { view, plan } = await prepared(); const edits = editsFor(plan);
  if (kind === "sourceHash") view.sourceHash = "changed";
  if (kind === "guard") view.guard.fingerprint = "changed";
  if (kind === "source") view.fields[0]!.source = view.fields[0]!.source.replace("alpha", "other");
  if (kind === "translation") view.fields[0]!.translation += "<p>Concurrent edit.</p>";
  if (kind === "provenance") view.reverse.set(COPY_PARENT, "Actor.other");
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
});

it("identifies every generated embedded target for the authoritative existence guard", async () => {
  const { plan } = await prepared();
  expect(plan.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceTarget: `${SOURCE_PARENT}.Item.alpha`, target: `${COPY_PARENT}.Item.alpha` }),
    expect.objectContaining({ sourceTarget: `${SOURCE_PARENT}.Item.beta`, target: `${COPY_PARENT}.Item.beta` }),
  ]));
});

it.each([
  [`<p>@UUID[${SOURCE_PARENT}.Item.alpha]</p>`, `<p class="attacker">@UUID[${COPY_PARENT}]</p>`],
  [`<p>@UUID[${SOURCE_PARENT}.Item.alpha]</p>`, `<section>@UUID[${COPY_PARENT}]</section>`],
  [`<p><strong>@UUID[${SOURCE_PARENT}.Item.alpha]</strong></p>`, `<p>@UUID[${COPY_PARENT}]</p>`],
])("does not use source references as permission to rewrite HTML structure", async (source, target) => {
  expect(await prepareReferenceRebuild(snapshot(source, target), "field")).toBeNull();
});

it("fails closed for duplicate snapshot row identity, missing rows and source warning", async () => {
  const duplicate = broken(); duplicate.rows.push(structuredClone(duplicate.rows[0]!));
  expect(await prepareReferenceRebuild(duplicate, "field")).toBeNull();
  const missing = broken(); missing.rows.shift();
  expect(await prepareReferenceRebuild(missing, "field")).toBeNull();
  const stale = broken(); stale.warning = "SourceChanged";
  expect(await prepareReferenceRebuild(stale, "field")).toBeNull();
});

it("forbids opposite numerical changes between formatted parts despite equal aggregate", async () => {
  const view = snapshot(
    `<p><strong>2 uses @UUID[${SOURCE_PARENT}.Item.alpha]</strong> then 3 uses @UUID[${SOURCE_PARENT}.Item.beta].</p>`,
    `<p><strong>2 použití @UUID[${COPY_PARENT}]</strong> a 3 použití @UUID[${COPY_PARENT}].</p>`,
  );
  const { plan } = await prepared(view); const edits = editsFor(plan);
  expect(edits[0]!.text).toHaveLength(2);
  edits[0]!.text[0] = edits[0]!.text[0]!.replace("2", "3");
  edits[0]!.text[1] = edits[0]!.text[1]!.replace("3", "2");
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
  await expect(materializeReferenceRebuild(view, plan, edits, true)).rejects.toThrow();
});

it("requires explicit source-number restoration for an already wrong damaged part", async () => {
  const view = snapshot(`<p>2 uses @UUID[${SOURCE_PARENT}.Item.alpha].</p>`, `<p>3 použití @UUID[${COPY_PARENT}].</p>`);
  const { plan } = await prepared(view); const edits = editsFor(plan);
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
  const restored = await materializeReferenceRebuild(view, plan, edits, true);
  expect(restored.value).toContain("2 uses");
});

it.each(["baseline", "before", "source", "reference-map", "proof-hash", "target"])("does not trust a forged prepare plan: %s", async kind => {
  const { view, plan } = await prepared(); const edits = editsFor(plan);
  const forged = structuredClone(plan);
  if (kind === "baseline") forged.rows[0]!.baseline[0] = "Injected baseline.";
  if (kind === "before") forged.rows[0]!.before[0] = "Forged damaged text.";
  if (kind === "source") forged.rows[0]!.source[0] = "Forged source.";
  if (kind === "reference-map") (forged.rows[0]!.referenceMap as unknown[]).length = 0;
  if (kind === "proof-hash") forged.proofHash = "f".repeat(64);
  if (kind === "target") forged.targets[0]!.target = "Actor.attacker.Item.injected";
  await expect(materializeReferenceRebuild(view, forged, edits)).rejects.toThrow();
});

it.each(["missing-marker", "duplicate-marker", "unknown-label", "nested-label"])("requires explicit safe source-owned references: %s", async kind => {
  const { view, plan } = await prepared(); const edits = editsFor(plan);
  const references = plan.rows[0]!.edit.references.flat();
  if (kind === "missing-marker") edits[0]!.text[0] = edits[0]!.text[0]!.replace(references[0]!.marker, "ordinary text");
  if (kind === "duplicate-marker") edits[0]!.text[0] += references[0]!.marker;
  if (kind === "unknown-label") edits[0]!.labels = [{ marker: "⟦999⟧", label: "Forged label" }];
  if (kind === "nested-label") edits[0]!.labels = [{ marker: references[0]!.marker, label: "@UUID[Actor.attacker]" }];
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
});

it("does not move a command across formatted parts merely because whole-field inventory matches", async () => {
  const view = snapshot(
    `<p><strong>@UUID[${SOURCE_PARENT}.Item.alpha]</strong> then @UUID[${SOURCE_PARENT}.Item.beta].</p>`,
    `<p><strong>@UUID[${COPY_PARENT}]</strong> a @UUID[${COPY_PARENT}].</p>`,
  );
  const { plan } = await prepared(view); const edits = editsFor(plan);
  const references = plan.rows[0]!.edit.references;
  edits[0]!.text[0] = references[1]![0]!.marker;
  edits[0]!.text[1] = references[0]![0]!.marker;
  await expect(materializeReferenceRebuild(view, plan, edits)).rejects.toThrow();
});

it("never reverts a translated Embed option while reconstructing another command in that part", async () => {
  const view = snapshot(
    `<p>@Embed[Actor.other readaloud="A safe English caption"] then @UUID[${SOURCE_PARENT}.Item.alpha].</p>`,
    `<p>@Embed[Actor.other readaloud="Bezpečný český popis"] a @UUID[${COPY_PARENT}].</p>`,
  );
  expect(await prepareReferenceRebuild(view, "field")).toBeNull();
});

it("independently revalidates materialized changes and rejects omitted/extra caller changes", async () => {
  const { view, plan } = await prepared();
  const compiled = await materializeReferenceRebuild(view, plan, editsFor(plan));
  const proved = await validateReferenceRebuildChanges(view, "field", plan.proofHash, compiled.changes);
  expect(proved.value).toBe(compiled.value);
  await expect(validateReferenceRebuildChanges(view, "field", plan.proofHash, [])).rejects.toThrow();
  await expect(validateReferenceRebuildChanges(view, "field", plan.proofHash, [
    ...compiled.changes, { rowId: "row-1", parts: ["Caller changes unrelated row."] },
  ])).rejects.toThrow();
  await expect(validateReferenceRebuildChanges(view, "field", "f".repeat(64), compiled.changes)).rejects.toThrow();
});

it("receipt-bound undo retains an unrelated later prose edit while restoring only recorded damaged parts", async () => {
  const { view, plan } = await prepared();
  const compiled = await materializeReferenceRebuild(view, plan, editsFor(plan));
  const recorded = compiled.changes.map(change => ({ rowId: change.rowId,
    before: view.rows.find(row => row.id === change.rowId)!.translation, after: change.parts }));
  const current = snapshot(view.fields[0]!.source, compiled.value.replace("Zachovat", "Pozdější oprava: zachovat"));
  const original = JSON.stringify(current);
  const undo = await undoReferenceRebuild(current, compiled.receipt, recorded);
  expect(undo.value).toContain(view.rows[0]!.translation[0]);
  expect(undo.value).toContain("Pozdější oprava: zachovat");
  expect(JSON.stringify(current)).toBe(original);
});

it.each(["affected-part", "source", "provenance", "before-receipt", "after-receipt", "wrong-document"])("undo rejects stale or tampered binding: %s", async kind => {
  const { view, plan } = await prepared();
  const compiled = await materializeReferenceRebuild(view, plan, editsFor(plan));
  const recorded = compiled.changes.map(change => ({ rowId: change.rowId,
    before: [...view.rows.find(row => row.id === change.rowId)!.translation], after: [...change.parts] }));
  const current = snapshot(view.fields[0]!.source, compiled.value);
  if (kind === "affected-part") current.rows[0]!.translation[0] += " Concurrent edit.";
  if (kind === "source") current.fields[0]!.source = current.fields[0]!.source.replace("alpha", "different");
  if (kind === "provenance") current.reverse.set(COPY_PARENT, "Actor.different");
  if (kind === "before-receipt") recorded[0]!.before[0] = "Tampered before.";
  if (kind === "after-receipt") recorded[0]!.after[0] = "Tampered after.";
  if (kind === "wrong-document") current.entry.uuid = "Compendium.world.translations.JournalEntry.foreign";
  await expect(undoReferenceRebuild(current, compiled.receipt, recorded)).rejects.toThrow();
});

it("preserves existing EXACT glossary prose in the repaired label, independently of source command regeneration", async () => {
  const view = snapshot(`<p>Use @UUID[${SOURCE_PARENT}.Item.alpha]{Exact Name}.</p>`, `<p>Použij @UUID[${COPY_PARENT}]{Exact Name}.</p>`);
  const { plan } = await prepared(view); const edits = editsFor(plan);
  edits[0]!.labels = [{ marker: plan.rows[0]!.edit.references[0]![0]!.marker, label: "Different Name" }];
  const compiled = await materializeReferenceRebuild(view, plan, edits);
  expect(() => correctionWarnings(view.rows[0]!.translation, compiled.changes[0]!.parts,
    [{ source: "Exact Name", replacement: "Exact Name", category: "character", aliases: [], mode: "fixed" }])).toThrow("EXACT glossary term");
});

/** Independent persistence fixture: real load/save guards, synthetic documents. */
async function persistedFixture(sourceHtml = '<p>Use @UUID[Actor.original.Item.alpha]{First}.</p>', targetHtml = '<p>Použij @UUID[Actor.original]{První}.</p>') {
  const sourceData: JournalData = { name: "Synthetic source", pages: [{ _id: "page", name: "Chapter", type: "text", text: { content: sourceHtml, format: 1 } }] };
  const copyData = structuredClone(sourceData); copyData._id = "copy"; copyData.pages[0]!.text!.content = targetHtml;
  copyData.flags = { [MODULE_ID]: { translation: { schemaVersion: 1, engineRevision: 12, sourceUuid: "JournalEntry.original", sourceHash: await journalSourceHash(sourceData),
    providerId: "openai-compatible", sourceLanguage: "en", targetLanguage: "cs", translatedAt: "now", translatedTextPages: 1, skippedTextPages: 0, partial: false } } };
  (copyData.flags[MODULE_ID]!.translation as any).outputHash = await translatedOutputHash(copyData);
  const state = { locked: false, sourceData, copyData };
  const update = vi.fn(async (patch: Record<string, unknown>) => {
    for (const raw of (patch.pages ?? []) as Record<string, unknown>[]) {
      const page = copyData.pages.find(page => page._id === raw._id)!;
      for (const [key, value] of Object.entries(raw)) if (key !== "_id") {
        const pieces = key.split("."); let object = page as any;
        for (const piece of pieces.slice(0, -1)) object = object[piece] ??= {};
        object[pieces.at(-1)!] = structuredClone(value);
      }
    }
    for (const [key, value] of Object.entries(patch)) if (key !== "pages") {
      const pieces = key.split("."); let object = copyData as any;
      for (const piece of pieces.slice(0, -1)) object = object[piece] ??= {};
      object[pieces.at(-1)!] = structuredClone(value);
    }
  });
  const copyDocument = { id: "copy", uuid: `Compendium.${TRANSLATIONS_PACK_ID}.JournalEntry.copy`, get flags() { return copyData.flags; },
    toObject: () => structuredClone(copyData), update };
  const sourceDocument = { id: "original", uuid: "JournalEntry.original", documentName: "JournalEntry", toObject: () => structuredClone(sourceData) };
  const pack = { collection: TRANSLATIONS_PACK_ID, get locked() { return state.locked; }, getDocument: async () => copyDocument,
    getIndex: async () => new Map([["copy", { _id: "copy", name: copyData.name, flags: copyData.flags }]]) };
  vi.stubGlobal("game", { user: { id: "gm", name: "Synthetic reviewer", isGM: true }, world: { id: "test-world" }, system: { id: "crucible" }, modules: new Map([["ember", { active: true, version: "0.6.2" }]]),
    settings: { get: () => undefined }, i18n: { localize: (key: string) => key }, packs: new Map([[TRANSLATIONS_PACK_ID, pack]]) });
  vi.stubGlobal("Hooks", { callAll: vi.fn() });
  vi.stubGlobal("fromUuid", async (uuid: string) => uuid === sourceDocument.uuid ? sourceDocument : unavailable.has(uuid) ? null :
    { uuid, documentName: /(?:^|\.)(Actor|Item|JournalEntry|JournalEntryPage)\.[^.]+$/u.exec(uuid)?.[1] });
  const view = await loadReview({ id: "copy", uuid: copyDocument.uuid, pack: TRANSLATIONS_PACK_ID, name: copyData.name,
    kind: "JournalEntry", sourceUuid: sourceDocument.uuid, language: "cs" });
  const field = view.fields.find(field => field.targetPath.at(-1) === "content")!;
  const plan = await prepareReferenceRebuild(view, field.id); expect(plan).not.toBeNull();
  const compiled = await materializeReferenceRebuild(view, plan!, editsFor(plan!));
  const metadata = { referenceRebuild: { fieldId: field.id, proofHash: plan!.proofHash } };
  return { state, view, plan: plan!, compiled, metadata, update };
}

const mixedSource = '<p>First @UUID[.page]{First}, second @UUID[JournalEntry.original.JournalEntryPage.page]{Second}.</p>';
const mixedBefore = '<p>První @UUID[JournalEntry.original.JournalEntryPage.page]{První}, potom @UUID[JournalEntry.original.JournalEntryPage.page]{Druhá}.</p>';
it("persists mixed source notation once with absolute existence checks, history and unverified corrections", async () => {
  const f = await persistedFixture(mixedSource, mixedBefore), target = `${f.view.entry.uuid}.JournalEntryPage.page`;
  expect(f.plan.targets).toEqual([{ sourceTarget: "JournalEntry.original.JournalEntryPage.page", target, required: true }]);
  await saveReviewRows(f.view, f.compiled.changes, f.metadata);
  expect(f.update).toHaveBeenCalledTimes(1);
  expect(f.state.copyData.pages[0]!.text!.content).toBe(`<p>First @UUID[.page]{First}, second @UUID[${target}]{Second}.</p>`);
  expect(f.state.sourceData.pages[0]!.text!.content).toBe(mixedSource);
  const history = Object.values((f.state.copyData.flags![MODULE_ID] as any).reviewHistory) as any[];
  expect(history).toHaveLength(1);
  expect(history[0].referenceRebuild.referenceMap[0]).toEqual(expect.objectContaining({ command: "@UUID[.page]{First}", target, required: true }));
  expect(history[0].rows[0].before).toEqual(f.view.rows.find(row => row.id === f.compiled.changes[0]!.rowId)!.translation);
  expect(history[0].rows[0].after).toEqual(f.compiled.changes[0]!.parts);
  expect((f.state.copyData.flags![MODULE_ID] as any).review.entries[f.compiled.changes[0]!.rowId]).toBeNull();
});

it.each(["missing-before", "missing-during-write", "wrong-type"])("does not save a relative token with an unavailable exact copied target: %s", async kind => {
  const f = await persistedFixture(mixedSource, mixedBefore), target = `${f.view.entry.uuid}.JournalEntryPage.page`;
  if (kind === "missing-before") unavailable.add(target);
  if (kind === "wrong-type") {
    const resolve = fromUuid;
    vi.stubGlobal("fromUuid", async (uuid: string) => uuid === target ? { uuid, documentName: "Actor" } : resolve(uuid));
  }
  await expect(saveReviewRows(f.view, f.compiled.changes, { ...f.metadata, ...(kind === "missing-during-write" ? { beforeWrite: async () => { await Promise.resolve(); unavailable.add(target); } } : {}) })).rejects.toThrow("ReferenceTargetMissing");
  expect(f.update).not.toHaveBeenCalled();
  expect(f.state.copyData.pages[0]!.text!.content).toBe(mixedBefore);
});

it("does not partially restore punctuation when another required source-owned reference is unavailable", async () => {
  const source = '<p>First<strong>,</strong> &Reference[Exhaustion] and @UUID[Actor.original.Item.alpha] for 2 turns.</p>';
  const before = '<p>První<strong></strong> a @UUID[Actor.original] na 2 tahy.</p>';
  const f = await persistedFixture(source, before);
  expect(f.plan.punctuation).toBeDefined();
  unavailable.add('Actor.original.Item.alpha');
  await expect(saveReviewRows(f.view, f.compiled.changes, f.metadata)).rejects.toThrow('ReferenceTargetMissing');
  expect(f.update).not.toHaveBeenCalled();
  expect(f.state.copyData.pages[0]!.text!.content).toBe(before);
});

it.each(["source", "lock", "active-run", "system", "ember-active", "ember-version"])("rechecks late %s changes after an awaited beforeWrite hook", async kind => {
  const f = await persistedFixture();
  await expect(saveReviewRows(f.view, f.compiled.changes, { ...f.metadata, beforeWrite: async () => {
    await Promise.resolve();
    if (kind === "source") f.state.sourceData.pages[0]!.text!.content = '<p>Changed source @UUID[Actor.original.Item.alpha]{First}.</p>';
    if (kind === "lock") f.state.locked = true;
    if (kind === "active-run") activeTranslations.start("Synthetic concurrent run", "cs");
    if (kind === "system") (game as any).system.id = "dnd5e";
    if (kind === "ember-active") (game as any).modules.get("ember").active = false;
    if (kind === "ember-version") (game as any).modules.get("ember").version = "99.0.0";
  } })).rejects.toThrow();
  expect(f.update).not.toHaveBeenCalled();
});

const inactiveBlock = (command: string, active = "<p>Active prose.</p>") => `<div class="system-swap-block"><div data-system="dnd5e"><p>${command}</p></div><div data-system="crucible">${active}</div></div>`;
const inactiveInline = (command: string) => `<p>Check <sup class="system-swap-inline"><sub data-system="dnd5e">${command}</sub><sub data-system="crucible">Active prose.</sub></sup></p>`;

it.each([inactiveBlock, inactiveInline])("source-owned supported inactive branches retain the exact original target without guessing a translated alternative", async wrapper => {
  const view = snapshot(wrapper(`@UUID[${SOURCE_PARENT}.Item.alpha]{First}`), wrapper(`@UUID[${COPY_PARENT}]{Druhá}`));
  const { plan } = await prepared(view);
  expect(plan.targets).toEqual(expect.arrayContaining([expect.objectContaining({
    sourceTarget: `${SOURCE_PARENT}.Item.alpha`, target: `${SOURCE_PARENT}.Item.alpha`, required: false, inactiveSystem: "dnd5e",
  })]));
  const compiled = await materializeReferenceRebuild(view, plan, editsFor(plan));
  expect(compiled.value).toContain(`@UUID[${SOURCE_PARENT}.Item.alpha]{First}`);
  expect(compiled.value).not.toContain(`${COPY_PARENT}.Item.alpha`);
});

it.each([
  (command: string) => `<div class="system-swap-block"><span data-system="dnd5e">${command}</span></div>`,
  (command: string) => `<div class="system-swap-inline"><sub data-system="dnd5e">${command}</sub></div>`,
  (command: string) => `<p><sup class="system-swap-inline"><span data-system="dnd5e">${command}</span></sup></p>`,
  (command: string) => `<div class="system-swap-block"><div data-system="unknown"><p>${command}</p></div></div>`,
  (command: string) => `<div class="system-swap-block"><div data-system="dnd5e"><div class="system-swap-block"><div data-system="dnd5e"><p>${command}</p></div></div></div></div>`,
])("unsupported or nested source wrappers never waive target availability", async wrapper => {
  const view = snapshot(wrapper(`@UUID[${SOURCE_PARENT}.Item.alpha]`), wrapper(`@UUID[${COPY_PARENT}]`));
  const { plan } = await prepared(view);
  expect(plan.targets.every(target => target.required !== false)).toBe(true);
});

it("a translation-only hidden wrapper cannot create source-owned permission", async () => {
  const view = snapshot(`<p>@UUID[${SOURCE_PARENT}.Item.alpha]</p>`, inactiveBlock(`@UUID[${COPY_PARENT}]`));
  expect(await prepareReferenceRebuild(view, "field")).toBeNull();
});

it("an active occurrence of the same source child overrides any inactive occurrence's exemption", async () => {
  const source = inactiveBlock(`@UUID[${SOURCE_PARENT}.Item.alpha]`, `<p>@UUID[${SOURCE_PARENT}.Item.alpha]</p>`);
  const target = inactiveBlock(`@UUID[${COPY_PARENT}]`, `<p>@UUID[${COPY_PARENT}.Item.alpha]</p>`);
  const { plan } = await prepared(snapshot(source, target));
  expect(plan.targets.every(target => target.required !== false)).toBe(true);
});

it.each(["disabled", "unknown-version", "unknown-system"])("does not rely on unsupported renderer state: %s", async state => {
  if (state === "disabled") (game as any).modules.get("ember").active = false;
  if (state === "unknown-version") (game as any).modules.get("ember").version = "99.0.0";
  if (state === "unknown-system") (game as any).system.id = "unknown";
  const { plan } = await prepared(snapshot(inactiveBlock(`@UUID[${SOURCE_PARENT}.Item.alpha]`), inactiveBlock(`@UUID[${COPY_PARENT}]`)));
  expect(plan.targets.every(target => target.required !== false)).toBe(true);
});

it("allows a missing exact source target only in a proven inactive branch while direct service still rejects an ungated missing target", async () => {
  unavailable.add(`${SOURCE_PARENT}.Item.alpha`);
  const hidden = await persistedFixture(inactiveBlock(`@UUID[${SOURCE_PARENT}.Item.alpha]`), inactiveBlock(`@UUID[${SOURCE_PARENT}]`));
  await saveReviewRows(hidden.view, hidden.compiled.changes, hidden.metadata);
  expect(hidden.update).toHaveBeenCalledTimes(1);
  const active = await persistedFixture();
  await expect(saveReviewRows(active.view, active.compiled.changes, active.metadata)).rejects.toThrow();
  expect(active.update).not.toHaveBeenCalled();
});

it("does not persist any field when one required target is missing beside an exempt inactive target", async () => {
  unavailable.add(`${SOURCE_PARENT}.Item.alpha`);
  unavailable.add(`${SOURCE_PARENT}.Item.beta`);
  const source = inactiveBlock(`@UUID[${SOURCE_PARENT}.Item.alpha]`, `<p>Use @UUID[${SOURCE_PARENT}.Item.beta].</p>`);
  const target = inactiveBlock(`@UUID[${SOURCE_PARENT}]`, `<p>Použij @UUID[${SOURCE_PARENT}].</p>`);
  const f = await persistedFixture(source, target);
  expect(f.plan.targets.some(target => target.required === false)).toBe(true);
  expect(f.plan.targets.some(target => target.required === true)).toBe(true);
  await expect(saveReviewRows(f.view, f.compiled.changes, f.metadata)).rejects.toThrow();
  expect(f.update).not.toHaveBeenCalled();
  expect(f.state.copyData.pages[0]!.text!.content).toBe(target);
});

it("rejects translation-only system retagging even when it could hide the damaged reference", async () => {
  const source = inactiveBlock(`@UUID[${SOURCE_PARENT}.Item.alpha]`).replace('data-system="dnd5e"', 'data-system="crucible"');
  const target = inactiveBlock(`@UUID[${COPY_PARENT}]`);
  expect(await prepareReferenceRebuild(snapshot(source, target), "field")).toBeNull();
});

it("source display:none is not an availability exception for the active system", async () => {
  const wrapper = (command: string) => `<div class="system-swap-block"><div data-system="crucible" style="display:none"><p>${command}</p></div></div>`;
  const { plan } = await prepared(snapshot(wrapper(`@UUID[${SOURCE_PARENT}.Item.alpha]`), wrapper(`@UUID[${COPY_PARENT}]`)));
  expect(plan.targets.every(target => target.required)).toBe(true);
});

it.each(['<em>Literal markup</em>', '<a href="https://attacker.invalid">Literal destination</a>'])("escapes caller HTML-looking prose without creating tags or destinations: %s", async literal => {
  const { view, plan } = await prepared(); const edits = editsFor(plan);
  edits[0]!.text[0] += ` ${literal}`;
  const compiled = await materializeReferenceRebuild(view, plan, edits);
  const container = document.createElement("div"); container.innerHTML = compiled.value;
  expect(container.querySelector("em,a")).toBeNull();
  expect(container.textContent).toContain(literal);
  assertPortableText(view.fields[0]!.source, portableReviewText(view, view.fields[0]!, compiled.value), "html");
});

it("rechecks a required child target that disappears during beforeWrite", async () => {
  const f = await persistedFixture();
  await expect(saveReviewRows(f.view, f.compiled.changes, { ...f.metadata, beforeWrite: async () => {
    await Promise.resolve(); unavailable.add(`${SOURCE_PARENT}.Item.alpha`);
  } })).rejects.toThrow();
  expect(f.update).not.toHaveBeenCalled();
});
