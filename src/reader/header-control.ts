import { openAdventureReader } from "./reader-app";
import { logger } from "../logger";

interface ReaderSheet {
  entry?: FoundryUuidDocument; document?: FoundryUuidDocument;
  pageId?: string; pageIndex?: number; _pages?: Record<string, unknown> | { _id?: string }[];
  pagesInView?: { dataset?: { pageId?: string } }[];
  window?: { header?: HTMLElement; controls?: HTMLElement };
}
export function addReaderHeaderButton(app: ReaderSheet): void {
  const doc = app.entry ?? app.document, frame = app.window;
  if (!doc?.uuid || !["JournalEntry", "JournalEntryPage", "Actor", "Item", "Scene"].includes(doc.documentName ?? "") || !frame?.header || !frame.controls || frame.header.querySelector(".ft-reader-header")) return;
  const label = game.i18n.localize("FOUNDRY_TRANSLATE.Reader.Open");
  const button = document.createElement("button"); button.type = "button";
  button.className = "header-control icon fa-solid fa-book-open-reader ft-reader-header"; button.title = label; button.setAttribute("aria-label", label);
  button.addEventListener("click", () => {
    const pageId = app.pageId ?? (Array.isArray(app._pages) ? app._pages[app.pageIndex ?? -1]?._id : undefined) ?? app.pagesInView?.[0]?.dataset?.pageId;
    const uuid = doc.uuid + (doc.documentName === "JournalEntry" && pageId ? `.JournalEntryPage.${pageId}` : "");
    void openAdventureReader(uuid).catch(error => { logger.warn("Reader could not be opened.", error); ui.notifications.warn(game.i18n.localize("FOUNDRY_TRANSLATE.Reader.Unavailable")); });
  });
  frame.controls.before(button);
}
export function registerAdventureReader(): void {
  Hooks.on("renderApplicationV2", addReaderHeaderButton);
  Hooks.on("getSceneControlButtons", (controls: Record<string, { tools: Record<string, any> }>) => {
    const notes = controls.notes; if (!notes || notes.tools.foundryReader) return;
    notes.tools.foundryReader = { name: "foundryReader", title: "FOUNDRY_TRANSLATE.Reader.Title", icon: "fa-solid fa-book-open-reader", button: true,
      order: Math.max(-1, ...Object.values(notes.tools).map(t => Number(t.order) || 0)) + 1, onChange: () => { void openAdventureReader(); } };
  });
}
