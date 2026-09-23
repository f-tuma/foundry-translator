import { getTranslatorSettings } from "../settings/settings";
import { TranslationReviewApplication } from "./review-app";
import { reviewCatalog } from "./service";
import { resolveReviewTarget } from "./target";
import { logger } from "../logger";

let editor: TranslationReviewApplication | undefined;
export function openReviewEditor(uuid?: string): void {
  if (!game.user?.isGM) return;
  editor ??= new TranslationReviewApplication();
  const action = uuid ? editor.openAt(uuid) : editor.render({ force: true });
  void action.catch(error => { logger.warn("Review editor could not be opened.", error); ui.notifications.warn(game.i18n.localize(error instanceof Error && error.message.startsWith("Review.") ? `FOUNDRY_TRANSLATE.${error.message}` : "FOUNDRY_TRANSLATE.Review.TranslationMissing")); });
}
interface ReviewSheet {
  document?: { uuid?: string; documentName?: string }; entry?: { uuid?: string; documentName?: string };
  pageId?: string; pageIndex?: number; _pages?: { _id?: string }[]; pagesInView?: { dataset?: { pageId?: string } }[];
  window?: { header?: HTMLElement; controls?: HTMLElement };
}
export async function addReviewHeaderButton(app: ReviewSheet): Promise<void> {
  if (!game.user?.isGM) return;
  const doc = app.document ?? app.entry, frame = app.window;
  if (!doc?.uuid || !frame?.header || !frame.controls || !["JournalEntry", "JournalEntryPage", "Actor", "Item", "Scene", "ActiveEffect"].includes(doc.documentName ?? "")) return;
  if (frame.header.querySelector(".ft-review-header")) return;
  const catalog = await reviewCatalog(getTranslatorSettings().targetLanguage);
  if (!resolveReviewTarget(catalog, doc.uuid) || !frame.header.isConnected || frame.header.querySelector(".ft-review-header")) return;
  const label = game.i18n.localize("FOUNDRY_TRANSLATE.Review.OpenEditor"), button = document.createElement("button");
  button.type = "button"; button.className = "header-control icon fa-solid fa-pen-to-square ft-review-header"; button.title = label; button.setAttribute("aria-label", label);
  button.addEventListener("click", () => {
    const pageId = app.pageId ?? app._pages?.[app.pageIndex ?? -1]?._id ?? app.pagesInView?.[0]?.dataset?.pageId;
    openReviewEditor(doc.uuid! + (doc.documentName === "JournalEntry" && pageId ? `.JournalEntryPage.${pageId}` : ""));
  });
  frame.controls.before(button);
}
export function registerReviewHeaderControl(): void {
  Hooks.on("renderApplicationV2", (app: ReviewSheet) => { void addReviewHeaderButton(app).catch(error => logger.warn("Translation review shortcut unavailable.", error)); });
}
