import { logger } from "../logger";
import type { ChromeLocalProviderStatus } from "../providers/chrome-local";
import { JournalTranslationService } from "./journal-service";

interface JournalEntrySheetApplication {
  entry?: FoundryJournalWorldDocument;
  window?: {
    header: HTMLElement;
    controls: HTMLButtonElement;
  };
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

function formatDoneMessage(pages: number, skipped: number): string {
  return localized("FOUNDRY_TRANSLATE.JournalTranslation.Status.Done")
    .replace("{pages}", String(pages))
    .replace("{skipped}", String(skipped));
}

function worldJournal(entry: FoundryJournalWorldDocument | undefined): FoundryJournalWorldDocument | null {
  if (!entry?.id) return null;
  return game.journal.contents.find(({ id }) => id === entry.id) ?? null;
}

async function translateFromHeader(journal: FoundryJournalWorldDocument): Promise<void> {
  if (translationsInProgress.has(journal.uuid)) {
    ui.notifications.info(
      localized("FOUNDRY_TRANSLATE.JournalTranslation.Header.AlreadyRunning"),
    );
    return;
  }

  translationsInProgress.add(journal.uuid);
  ui.notifications.info(localized("FOUNDRY_TRANSLATE.JournalTranslation.Header.Starting"));
  let downloadNoticeShown = false;

  try {
    const service = new JournalTranslationService({
      onChromeStatus: (status: ChromeLocalProviderStatus) => {
        if (status.phase !== "download" || downloadNoticeShown) return;
        downloadNoticeShown = true;
        ui.notifications.info(
          localized("FOUNDRY_TRANSLATE.JournalTranslation.Header.Downloading"),
        );
      },
    });
    const result = await service.translate(journal);
    const message = formatDoneMessage(result.translatedTextPages, result.skippedTextPages);
    ui.notifications.success(message);
    result.document.sheet?.render(true);
  } catch (error) {
    logger.error("Journal translation from its header failed.", error);
    ui.notifications.error(
      error instanceof Error
        ? error.message
        : localized("FOUNDRY_TRANSLATE.JournalTranslation.Status.Error"),
      { permanent: true },
    );
  } finally {
    translationsInProgress.delete(journal.uuid);
  }
}

export function addJournalTranslationHeaderButton(
  application: JournalEntrySheetApplication,
): void {
  if (!game.user?.isGM) return;
  const journal = worldJournal(application.entry);
  const frame = application.window;
  if (!journal || !frame || frame.header.querySelector(".ft-journal-translate-header")) return;

  const label = localized("FOUNDRY_TRANSLATE.JournalTranslation.Header.Action");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control ft-journal-translate-header";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<i class="fa-solid fa-language" aria-hidden="true"></i><span>${label}</span>`;
  button.addEventListener("click", () => void translateFromHeader(journal));
  frame.controls.before(button);
}

export function addJournalTranslationHeaderControl(
  application: JournalEntrySheetApplication,
  controls: ApplicationHeaderControl[],
): void {
  if (!game.user?.isGM) return;
  const journal = worldJournal(application.entry);
  if (!journal) return;

  controls.unshift({
    action: "foundry-translate-translate-journal",
    label: "FOUNDRY_TRANSLATE.JournalTranslation.Header.Action",
    icon: "fa-solid fa-language",
    visible: true,
    onClick: () => void translateFromHeader(journal),
  });
}

export function registerJournalTranslationHeaderControl(): void {
  Hooks.on("getHeaderControlsJournalEntrySheet", addJournalTranslationHeaderControl);
  Hooks.on("renderJournalEntrySheet", addJournalTranslationHeaderButton);
}
