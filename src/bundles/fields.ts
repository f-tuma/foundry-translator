import type { JournalData } from "../translation/journal";
import { discoverSystemHtmlFieldPaths, discoverEmberTextFieldPaths, readPath, type HtmlFieldPath } from "../translation/system-html-fields";

export type BundleDocumentKind = "JournalEntry" | "Actor" | "Item";
export type FieldFormat = "text" | "html" | "markdown";
export interface PortableField { path: HtmlFieldPath; format: FieldFormat }
export interface PortableDocument extends FoundryJournalDocument {
  uuid: string;
  documentName: BundleDocumentKind;
  system?: FoundryRuntimeSystem;
  pages?: { contents: (FoundryJournalDocument & { system?: FoundryRuntimeSystem })[] };
  items?: { contents: (FoundryJournalDocument & { system?: FoundryRuntimeSystem })[] };
}

/** The import allowlist is derived from local schemas, never from a bundle. */
export function portableFields(document: PortableDocument, data = document.toObject()): PortableField[] {
  const fields: PortableField[] = [];
  const addSystem = (runtime: { system?: FoundryRuntimeSystem } | undefined, value: unknown, prefix: HtmlFieldPath): void => {
    for (const path of discoverSystemHtmlFieldPaths(runtime?.system?.constructor?.schema?.fields, value)) {
      fields.push({ path: [...prefix, ...path], format: "html" });
    }
  };
  if (document.documentName === "JournalEntry") {
    const journal = data as JournalData;
    fields.push({ path: ["name"], format: "text" });
    journal.categories?.forEach((_, index) => fields.push({ path: ["categories", index, "name"], format: "text" }));
    journal.pages.forEach((page, index) => {
      const prefix = ["pages", index] as const;
      fields.push({ path: [...prefix, "name"], format: "text" });
      if (typeof page.text?.content === "string") fields.push({ path: [...prefix, "text", "content"], format: "html" });
      if (typeof page.text?.markdown === "string") fields.push({ path: [...prefix, "text", "markdown"], format: "markdown" });
      const runtime = document.pages?.contents.find((p) => p.id === page._id);
      addSystem(runtime, page.system, [...prefix, "system"]);
      for (const path of discoverEmberTextFieldPaths(page.type, runtime?.system?.constructor?.schema?.fields, page.system)) {
        fields.push({ path: [...prefix, "system", ...path], format: "text" });
      }
    });
  } else {
    fields.push({ path: ["name"], format: "text" });
    addSystem(document, data.system, ["system"]);
    if (document.documentName === "Actor") {
      fields.push({ path: ["prototypeToken", "name"], format: "text" });
      if (Array.isArray(data.items)) data.items.forEach((item: Record<string, unknown>, index) => {
        fields.push({ path: ["items", index, "name"], format: "text" });
        addSystem(document.items?.contents.find((i) => i.id === item._id), item.system, ["items", index, "system"]);
      });
    }
  }
  return fields.filter((field) => typeof readPath(data, field.path) === "string");
}
