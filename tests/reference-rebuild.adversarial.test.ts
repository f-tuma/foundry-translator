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
    { uuid, documentName: uuid.includes(".Item.") ? "Item" : "Actor" });
  const view = await loadReview({ id: "copy", uuid: copyDocument.uuid, pack: TRANSLATIONS_PACK_ID, name: copyData.name,
    kind: "JournalEntry", sourceUuid: sourceDocument.uuid, language: "cs" });
  const field = view.fields.find(field => field.targetPath.at(-1) === "content")!;
  const plan = await prepareReferenceRebuild(view, field.id); expect(plan).not.toBeNull();
  const compiled = await materializeReferenceRebuild(view, plan!, editsFor(plan!));
  const metadata = { referenceRebuild: { fieldId: field.id, proofHash: plan!.proofHash } };
  return { state, view, plan: plan!, compiled, metadata, update };
}

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
