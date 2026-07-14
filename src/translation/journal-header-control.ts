import { logger } from "../logger";
import type { ChromeLocalProviderStatus } from "../providers/chrome-local";
import { openActiveTranslationsOverview } from "./active-translations-app";
import { readJournalTranslationFlag, type JournalTranslationProgress } from "./journal";
import { JournalTranslationService } from "./journal-service";

interface JournalEntrySheetApplication {
  entry?: FoundryJournalDocument;
  pageId?: string;
  pageIndex?: number;
  _pages?: { _id?: string }[];
  pagesInView?: { dataset?: { pageId?: string } }[];
  close?(options?: Record<string, unknown>): Promise<unknown>;
  window?: {
    header: HTMLElement;
    controls: HTMLButtonElement;
  };
}

function activePageId(application: JournalEntrySheetApplication): string | null {
  return application.pageId
    ?? application._pages?.[application.pageIndex ?? -1]?._id
    ?? application.pagesInView?.[0]?.dataset?.pageId
    ?? null;
}

export interface ApplicationHeaderControl {
  action: string;
  label: string;
  icon?: string;
  visible?: boolean;
  onClick?: () => void;
}

const translationsInProgress = new Set<string>();

function localized(key: string): string {
  return game.i18n.localize(key);
}

function formatDoneMessage(
  pages: number,
  skipped: number,
  fallback: number,
  documents: number,
  dependencyWarnings: number,
): string {
  const key = fallback > 0 || dependencyWarnings > 0
    ? "FOUNDRY_TRANSLATE.JournalTranslation.Status.DoneRecursiveWithWarnings"
    : "FOUNDRY_TRANSLATE.JournalTranslation.Status.DoneRecursive";
  return localized(key)
    .replace("{pages}", String(pages))
    .replace("{skipped}", String(skipped))
    .replace("{fallback}", String(fallback))
    .replace("{documents}", String(documents))
    .replace("{dependencies}", String(dependencyWarnings));
}

export function formatOverallSuffix(progress: JournalTranslationProgress): string {
  if (progress.overallTotalUnits === undefined) return "";
  return localized("FOUNDRY_TRANSLATE.JournalTranslation.Status.OverallSuffix")
    .replace("{current}", String(progress.overallCompletedUnits ?? 0))
    .replace("{total}", String(progress.overallTotalUnits))
    .replace("{documents}", String((progress.completedDocuments ?? 0) + 1))
    .replace("{totalDocuments}", String(progress.totalDocuments ?? 0));
}

export function progressStatusKey(kind: JournalTranslationProgress["kind"]): string {
  if (kind === "actor-field") return "FOUNDRY_TRANSLATE.JournalTranslation.Status.ActorProgress";
  if (kind === "item-field") return "FOUNDRY_TRANSLATE.JournalTranslation.Status.ItemProgress";
  return "FOUNDRY_TRANSLATE.JournalTranslation.Status.Progress";
}

function formatProgress(progress: JournalTranslationProgress): string {
  const key = progressStatusKey(progress.kind);
  return localized(key)
    .replace("{current}", String(progress.completedPages))
    .replace("{total}", String(progress.totalPages))
    .replace("{page}", progress.pageName)
    .replace("{document}", progress.documentName ?? "")
    + formatOverallSuffix(progress);
}

function worldJournal(entry: FoundryJournalDocument | undefined): FoundryJournalWorldDocument | null {
  if (!entry?.id) return null;
  return game.journal.contents.find(({ id }) => id === entry.id) ?? null;
}

function sourceJournal(entry: FoundryJournalDocument | undefined): FoundryJournalWorldDocument | null {
  if (!entry) return null;
  const flag = readJournalTranslationFlag(entry.flags);
  if (!flag) return null;
  return game.journal.contents.find(({ uuid }) => uuid === flag.sourceUuid) ?? null;
}

async function showDocument(
  application: JournalEntrySheetApplication,
  document: FoundryJournalDocument,
): Promise<void> {
  await application.close?.();
  document.sheet?.render(true);
}

async function translateFromHeader(
  journal: FoundryJournalWorldDocument,
  application: JournalEntrySheetApplication,
  pageId?: string,
): Promise<void> {
  if (translationsInProgress.has(journal.uuid)) {
    // Clicking a running translation opens the global overview instead.
    openActiveTranslationsOverview();
    return;
  }

  translationsInProgress.add(journal.uuid);
  ui.notifications.info(localized("FOUNDRY_TRANSLATE.JournalTranslation.Header.Starting"));
  let downloadNoticeShown = false;
  const progressButton = application.window?.header.querySelector<HTMLButtonElement>(
    ".ft-journal-translate-header",
  );
  const originalButtonLabel = progressButton?.querySelector("span")?.textContent ?? "";

  try {
    const service = new JournalTranslationService({
      onChromeStatus: (status: ChromeLocalProviderStatus) => {
        if (status.phase !== "download" || downloadNoticeShown) return;
        downloadNoticeShown = true;
        ui.notifications.info(
          localized("FOUNDRY_TRANSLATE.JournalTranslation.Header.Downloading"),
        );
      },
      onProgress: (progress) => {
        const message = formatProgress(progress);
        const label = progressButton?.querySelector("span");
        if (label) label.textContent = message;
        if (progressButton) {
          progressButton.title = message;
          progressButton.setAttribute("aria-label", message);
        }
      },
    });
    const result = pageId
      ? await service.translatePage(journal, pageId)
      : await service.translate(journal);
    const message = formatDoneMessage(
      result.translatedTextPages,
      result.skippedTextPages,
      result.fallbackTextSegments,
      result.processedDocuments,
      result.dependencyWarnings.length,
    );
    if (result.fallbackTextSegments > 0 || result.dependencyWarnings.length > 0) {
      ui.notifications.warn(message, { permanent: true });
    }
    else ui.notifications.success(message);
    await showDocument(application, result.document);
  } catch (error) {
    logger.error("Journal translation from its header failed.", error);
    ui.notifications.error(
      error instanceof Error
        ? error.message
        : localized("FOUNDRY_TRANSLATE.JournalTranslation.Status.Error"),
      { permanent: true },
    );
  } finally {
    const label = progressButton?.querySelector("span");
    if (label) label.textContent = originalButtonLabel;
    if (progressButton) {
      progressButton.title = originalButtonLabel;
      progressButton.setAttribute("aria-label", originalButtonLabel);
    }
    translationsInProgress.delete(journal.uuid);
  }
}

export function addJournalTranslationHeaderButton(
  application: JournalEntrySheetApplication,
): void {
  if (!game.user?.isGM) return;
  const journal = worldJournal(application.entry);
  const original = sourceJournal(application.entry);
  const frame = application.window;
  if ((!journal && !original) || !frame || frame.header.querySelector(".ft-journal-translate-header")) {
    return;
  }
  const label = localized(
    original
      ? "FOUNDRY_TRANSLATE.JournalTranslation.Header.Original"
      : "FOUNDRY_TRANSLATE.JournalTranslation.Header.Action",
  );
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control ft-journal-translate-header";
  button.title = label;
  button.setAttribute("aria-label", label);
  const icon = document.createElement("i");
  icon.className = original ? "fa-solid fa-arrow-left" : "fa-solid fa-language";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  button.append(icon, text);
  button.addEventListener("click", () => {
    if (original) void showDocument(application, original);
    else if (journal) void translateFromHeader(journal, application);
  });
  frame.controls.before(button);
}

export function addJournalTranslationHeaderControl(
  application: JournalEntrySheetApplication,
  controls: ApplicationHeaderControl[],
): void {
  if (!game.user?.isGM) return;
  const journal = worldJournal(application.entry);
  const original = sourceJournal(application.entry);
  if (!journal && !original) return;

  if (journal && !original) {
    controls.unshift({
      action: "foundry-translate-translate-page",
      label: "FOUNDRY_TRANSLATE.JournalTranslation.Header.ActionPage",
      icon: "fa-solid fa-file-lines",
      visible: true,
      onClick: () => {
        const pageId = activePageId(application);
        if (!pageId) {
          ui.notifications.warn(
            localized("FOUNDRY_TRANSLATE.JournalTranslation.Header.NoActivePage"),
          );
          return;
        }
        void translateFromHeader(journal, application, pageId);
      },
    });
  }
  controls.unshift({
    action: original
      ? "foundry-translate-show-original-journal"
      : "foundry-translate-translate-journal",
    label: original
      ? "FOUNDRY_TRANSLATE.JournalTranslation.Header.Original"
      : "FOUNDRY_TRANSLATE.JournalTranslation.Header.Action",
    icon: original ? "fa-solid fa-arrow-left" : "fa-solid fa-language",
    visible: true,
    onClick: () => {
      if (original) void showDocument(application, original);
      else if (journal) void translateFromHeader(journal, application);
    },
  });
}

export function registerJournalTranslationHeaderControl(): void {
  Hooks.on("getHeaderControlsJournalEntrySheet", addJournalTranslationHeaderControl);
  Hooks.on("renderJournalEntrySheet", addJournalTranslationHeaderButton);
}
