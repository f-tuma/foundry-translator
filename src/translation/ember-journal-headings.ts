import { localizeEmberSectionRecords } from "./ember-section-headings";

type SheetMethod = (this: { document?: { type?: string } }, ...args: any[]) => any;
interface SheetPrototype {
  _getSections?: SheetMethod;
  _preparePartContext?: SheetMethod;
}
const installedSections = new WeakSet<object>();
const installedContexts = new WeakSet<object>();
const isEmber = (sheet: { document?: { type?: string } }) => sheet.document?.type?.startsWith("ember.") === true;

/** Patch only Ember's presentation boundary, keeping native methods, documents,
 * controls and IDs intact. Subclasses set literal headers after their super call,
 * so each own _getSections method is wrapped rather than only the base class. */
export function registerEmberJournalHeadings(): void {
  if (!game.modules.get("ember")?.active) return;
  const applications = (globalThis as any).ember?.api?.applications as Record<string, { prototype?: SheetPrototype }> | undefined;
  if (!applications) return;
  for (const [name, Sheet] of Object.entries(applications)) {
    if (!/^Ember.*PageSheet$/u.test(name)) continue;
    const prototype = Sheet?.prototype;
    if (!prototype || installedSections.has(prototype) || !Object.hasOwn(prototype, "_getSections")
      || typeof prototype._getSections !== "function") continue;
    const original = prototype._getSections;
    prototype._getSections = async function(...args) {
      const sections = await original.apply(this, args);
      return isEmber(this) ? localizeEmberSectionRecords(sections) : sections;
    };
    installedSections.add(prototype);
  }
  // This final native render-context boundary also covers subclasses supplied
  // after ready or subclasses which adjust sections in _preparePartContext.
  const prototype = applications.EmberPageSheet?.prototype;
  if (!prototype || installedContexts.has(prototype) || typeof prototype._preparePartContext !== "function") return;
  const original = prototype._preparePartContext;
  prototype._preparePartContext = async function(...args) {
    const context = await original.apply(this, args);
    if (args[0] !== "content" || !isEmber(this) || !context || typeof context !== "object"
      || !Array.isArray(context.sections)) return context;
    return { ...context, sections: localizeEmberSectionRecords(context.sections) };
  };
  installedContexts.add(prototype);
}
