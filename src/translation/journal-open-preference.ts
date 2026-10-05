import { MODULE_ID } from "../constants";
import { logger } from "../logger";
import { preferTranslations, SETTINGS } from "../settings/settings";
import { parseDocumentReference, resolveTranslationReference } from "./document-identity";
import { readJournalTranslationFlag } from "./journal";

interface JournalDocument extends FoundryUuidDocument {
  testUserPermission?(user: unknown, level: string): boolean;
  sheet?: JournalSheet;
}
interface JournalSheet {
  entry?: JournalDocument;
  document?: JournalDocument;
  render(...args: unknown[]): unknown;
}
const PATCHED = Symbol("foundry-translate-journal-open-preference");
const pending = new WeakMap<object, Map<string, Promise<unknown>>>();
const originalRequests = new WeakMap<object, number>();

/** Explicit source reads bypass the preference for this render only, including
 * asynchronous subclass renderers. No custom options leak into native sheets. */
export async function renderOriginalJournal(sheet: { render(options: Record<string, unknown>): unknown }, options: Record<string, unknown>): Promise<unknown> {
  originalRequests.set(sheet, (originalRequests.get(sheet) ?? 0) + 1);
  try { return await sheet.render(options); }
  finally {
    const remaining = (originalRequests.get(sheet) ?? 1) - 1;
    if (remaining) originalRequests.set(sheet, remaining);
    else originalRequests.delete(sheet);
  }
}

/** Known Foundry v14 signatures only. Do not guess custom render intent,
 * positional page indices, editor modes, or temporary ownership grants. */
function readOptions(args: unknown[]): Record<string, unknown> | null {
  if (args.length > 2) return null;
  const [first = {}, second] = args;
  let value: unknown;
  if (typeof first === "boolean") value = { ...(second as object ?? {}), force: first };
  else {
    if (second !== undefined) return null;
    value = first;
  }
  for (const candidate of [value, ...(typeof first === "boolean" && second !== undefined ? [second] : [])]) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(candidate))) return null;
  }
  const options = value as Record<string, unknown>;
  if (Object.keys(options).some(key => !["force", "pageId", "anchor", "mode"].includes(key))
    || Object.getOwnPropertySymbols(options).length > 0
    || (options.force !== undefined && typeof options.force !== "boolean")
    || (options.pageId !== undefined && (typeof options.pageId !== "string" || !/^[A-Za-z0-9_-]+$/u.test(options.pageId)))
    || (options.anchor !== undefined && typeof options.anchor !== "string")
    || (options.mode !== undefined && ![1, 2].includes(options.mode as number))) return null;
  return options;
}
function readable(doc: JournalDocument | null, user: unknown): doc is JournalDocument {
  return !!doc && doc.testUserPermission?.(user, "OBSERVER") === true;
}
function sheetDocument(sheet: JournalSheet): JournalDocument | undefined { return sheet.entry ?? sheet.document; }

async function translatedSheet(source: JournalDocument, sheet: JournalSheet, options: Record<string, unknown>): Promise<JournalSheet | null> {
  const user = game.user;
  const language = String(game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? "cs");
  if (!user || !readable(source, user) || readJournalTranslationFlag(source.flags)) return null;
  const pair = await resolveTranslationReference(source.uuid, language);
  if (pair.status !== "mapped" || pair.sourceUuid !== source.uuid || !pair.translatedUuid) return null;
  const copy = await fromUuid(pair.translatedUuid) as JournalDocument | null;
  const flag = readJournalTranslationFlag(copy?.flags);
  if (!copy || copy.uuid !== pair.translatedUuid || copy.documentName !== "JournalEntry"
    || !flag || flag.partial || flag.sourceUuid !== source.uuid || flag.targetLanguage !== language
    || !copy.sheet || copy.sheet === sheet || sheetDocument(copy.sheet)?.uuid !== copy.uuid) return null;
  const flagProof = JSON.stringify(flag);
  if (await fromUuid(source.uuid) !== source) return null;
  const docs: JournalDocument[] = [source, copy];
  if (typeof options.pageId === "string") {
    for (const root of [source, copy]) {
      const uuid = `${root.uuid}.JournalEntryPage.${options.pageId}`;
      const page = await fromUuid(uuid) as JournalDocument | null;
      if (!page || page.uuid !== uuid || page.documentName !== "JournalEntryPage" || page.parent?.uuid !== root.uuid) return null;
      docs.push(page);
    }
  }
  // Every asynchronous lookup finishes before this final identity/access check.
  if (game.user !== user || !preferTranslations()
    || String(game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE) ?? "cs") !== language
    || sheetDocument(sheet) !== source || readJournalTranslationFlag(source.flags)
    || JSON.stringify(readJournalTranslationFlag(copy.flags)) !== flagProof
    || sheetDocument(copy.sheet)?.uuid !== copy.uuid
    || docs.slice(2).some((page, index) => {
      const root = index === 0 ? source : copy;
      return page.uuid !== `${root.uuid}.JournalEntryPage.${options.pageId}` || page.parent?.uuid !== root.uuid;
    })
    || docs.some(doc => !readable(doc, user))) return null;
  return copy.sheet;
}

/** Journal presentation only: native directory, map Note and document links
 * converge on this render method. No Document/UUID or gameplay adapter changes. */
export function registerJournalOpenPreference(): void {
  const prototype = (foundry.applications as unknown as { sheets?: { journal?: { JournalEntrySheet?: { prototype: JournalSheet & { [PATCHED]?: boolean } } } } }).sheets?.journal?.JournalEntrySheet?.prototype;
  if (!prototype || typeof prototype.render !== "function" || prototype[PATCHED]) return;
  const original = prototype.render;
  prototype.render = function(this: JournalSheet, ...args: unknown[]): unknown {
    const source = sheetDocument(this), options = readOptions(args);
    const ref = source?.uuid && parseDocumentReference(source.uuid);
    // Only explicit opens are redirected. Native background re-renders of an
    // original remain original, including a sheet opened by Show original.
    if (originalRequests.has(this) || !preferTranslations() || !options || options.force !== true
      || !source || source.documentName !== "JournalEntry" || !ref || ref.type !== "JournalEntry" || ref.suffix || ref.anchor
      || readJournalTranslationFlag(source.flags)) return original.apply(this, args);
    let jobs = pending.get(this); if (!jobs) { jobs = new Map(); pending.set(this, jobs); }
    const key = JSON.stringify([source.uuid, game.user?.id, game.settings.get(MODULE_ID, SETTINGS.TARGET_LANGUAGE), options]);
    const existing = jobs.get(key); if (existing) return existing;
    const work = (async () => {
      try {
        const target = await translatedSheet(source, this, options);
        if (target) return await target.render({ ...options });
      } catch (error) { logger.warn("Preferred journal could not be opened; keeping its native source.", error); }
      return original.apply(this, args);
    })().finally(() => jobs!.delete(key));
    jobs.set(key, work);
    return work;
  };
  Object.defineProperty(prototype, PATCHED, { value: true });
}
