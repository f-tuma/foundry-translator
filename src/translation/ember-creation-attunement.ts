import { assertPortableText } from "../bundles/format";
import { absoluteReference, sourceReferenceNotation } from "../bundles/reference-notation";
import { proseNumbers } from "../polish/quality-guards";
import { discoverDocumentDependencies, rewriteDocumentReferences } from "./document-dependencies";
import { resolveSourceReference } from "./document-identity";
import { readJournalTranslationFlag } from "./journal";

interface Page extends FoundryUuidDocument {
  visible?: boolean;
  type?: string;
  system?: Record<string, any>;
  text?: { content?: string };
  pages?: { contents?: Page[] };
}
const ATTUNEMENT_PAGE = "jc7TEnx3yMnUcILK";
const readable = (doc: Page | null | undefined): doc is Page => !!doc && doc.visible === true;
const snapshot = (doc: Page) => JSON.stringify([doc.uuid, doc.id, doc.documentName, doc.type, doc.system,
  doc.text, doc.flags, doc.parent?.uuid, doc.parent?.flags]);

/** Mirror Ember's selected section only. Its parser selects the first class
 * other than block/attunement as the short ID; duplicates cannot prove a pair. */
function section(text: string, id: string): string | null {
  const root = document.createElement("div"); root.innerHTML = text;
  const matches = [...root.querySelectorAll("section.block.attunement")].filter(node =>
    [...node.classList].find(name => name !== "block" && name !== "attunement") === id);
  return matches.length === 1 ? `<div class="ember">${matches[0]!.outerHTML}</div>` : null;
}

async function canonicalField(before: string, after: string, source: Page, target: Page): Promise<string> {
  const replacements = [];
  for (const { sourceUuid } of discoverDocumentDependencies(after)) {
    const absolute = absoluteReference(sourceUuid, target.uuid);
    if (!absolute) continue;
    const original = await resolveSourceReference(absolute);
    if (original && original !== sourceUuid) replacements.push({ sourceUuid, translatedUuid: original });
  }
  const normalized = sourceReferenceNotation(before, rewriteDocumentReferences(after, replacements), source.uuid);
  assertPortableText(before, normalized, "html");
  if (JSON.stringify(proseNumbers([before])) !== JSON.stringify(proseNumbers([normalized]))) {
    throw new Error("Attunement display quantities changed.");
  }
  return normalized;
}

/** Render-only equivalent of Ember's config.description = overview + the
 * selected attunement section. Never substitute Item.description or mutate
 * the native config, documents, selection state or creation mechanics. */
export async function translateAttunementSummary(summary: string, sourcePage: FoundryUuidDocument,
  targetPage: FoundryUuidDocument, locale: string, guards: (() => boolean)[],
  sourceHash: (parent: any) => Promise<string | null>,
  lookup: (source: any) => Promise<any | null>): Promise<string | null> {
  try {
    const source = sourcePage as Page, target = targetPage as Page;
    const parent = source.parent as Page | undefined, translated = target.parent as Page | undefined;
    const identifier = source.system?.identifier;
    const config = (globalThis as any).ember?.CONST?.ATTUNEMENT_IDENTIFIERS?.[identifier];
    if (!readable(source) || !readable(target) || !readable(parent) || !readable(translated)
      || source.documentName !== "JournalEntryPage" || target.documentName !== "JournalEntryPage"
      || parent.documentName !== "JournalEntry" || translated.documentName !== "JournalEntry"
      || source.type !== "ember.cosmos" || target.type !== source.type || !source.id || target.id !== source.id
      || source.uuid !== `${parent.uuid}.JournalEntryPage.${source.id}`
      || target.uuid !== `${translated.uuid}.JournalEntryPage.${source.id}`
      || typeof identifier !== "string" || target.system?.identifier !== identifier
      || config?.identifier !== identifier || config.pageUuid !== source.uuid
      || typeof config.id !== "string" || !config.id || typeof config.description !== "string"
      || readJournalTranslationFlag(parent.flags)) return null;
    const sourceLorePages = (parent.pages?.contents ?? []).filter(page => page.id === ATTUNEMENT_PAGE);
    if (sourceLorePages.length !== 1) return null;
    const lore = sourceLorePages[0]!;
    if (!readable(lore) || lore.parent !== parent || lore.documentName !== "JournalEntryPage"
      || lore.uuid !== `${parent.uuid}.JournalEntryPage.${ATTUNEMENT_PAGE}` || typeof lore.text?.content !== "string") return null;
    const flag = readJournalTranslationFlag(translated.flags);
    if (!flag || flag.sourceUuid !== parent.uuid || flag.targetLanguage !== locale
      || (flag.partial && !flag.processedPageIds?.includes(source.id))) return null;
    const overview = source.system?.content?.overview, targetOverview = target.system?.content?.overview;
    const beforeSection = section(lore.text.content, config.id);
    if (typeof overview !== "string" || typeof targetOverview !== "string" || beforeSection === null) return null;
    const before = `${overview}${beforeSection}`;
    if (config.description !== before) return null;
    const originals = [source, target, parent, translated, lore];
    const proofs = originals.map(snapshot), configProof = JSON.stringify(config);
    const current = () => originals.every((doc, index) => readable(doc) && snapshot(doc) === proofs[index])
      && (parent.pages?.contents ?? []).filter(page => page.id === ATTUNEMENT_PAGE).length === 1
      && parent.pages?.contents?.includes(lore) === true
      && (globalThis as any).ember?.CONST?.ATTUNEMENT_IDENTIFIERS?.[identifier] === config
      && JSON.stringify(config) === configProof;
    guards.push(current);
    const hash = await sourceHash(parent);
    if (!hash || hash !== flag.sourceHash || !current()) return null;
    const targetLore = await lookup(lore) as Page | null;
    if (!readable(targetLore) || targetLore.documentName !== "JournalEntryPage" || targetLore.id !== lore.id
      || targetLore.type !== lore.type || targetLore.parent !== translated
      || targetLore.uuid !== `${translated.uuid}.JournalEntryPage.${ATTUNEMENT_PAGE}`
      || typeof targetLore.text?.content !== "string"
      || (flag.partial && !flag.processedPageIds?.includes(ATTUNEMENT_PAGE)) || !current()) return null;
    const targetLoreProof = snapshot(targetLore);
    const currentAll = () => current() && readable(targetLore) && snapshot(targetLore) === targetLoreProof;
    guards.push(currentAll);
    const afterSection = section(targetLore.text.content, config.id);
    if (afterSection === null) return null;
    const editor = (foundry.applications as any).ux.TextEditor;
    // Native initialization enriches the combined config without relativeTo.
    // Use that same context and retain its non-secret visibility.
    const native = await editor.enrichHTML(before, { secrets: false });
    if (native !== summary || !currentAll()) return null;
    const afterOverview = await canonicalField(overview, targetOverview, source, target);
    const normalizedSection = await canonicalField(beforeSection, afterSection, lore, targetLore);
    if (!currentAll()) return null;
    const result = await editor.enrichHTML(`${afterOverview}${normalizedSection}`, { secrets: false });
    return typeof result === "string" && currentAll() && guards.every(valid => valid()) ? result : null;
  } catch {
    // Missing proof or malformed imported prose must keep the native summary.
    return null;
  }
}
