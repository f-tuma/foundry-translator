import { logger } from "../logger";
import { readJournalTranslationFlag, type JournalData, type JournalPageData } from "../translation/journal";
import { addGlossaryCandidates } from "./candidate-store";
import { extractCorrectionCandidate, type GlossaryCandidate } from "./candidates";
import { GlossaryCompendiumRepository } from "./compendium-repository";

interface RuntimeJournalPageDocument {
  id?: string | null;
  name?: string;
  parent?: FoundryJournalDocument | null;
  toObject(): Record<string, unknown>;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function changedStrings(value: unknown, prefix: string[] = []): Array<{ path: string[]; value: string }> {
  if (typeof value === "string") return [{ path: prefix, value }];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, entry]) => changedStrings(entry, [...prefix, key]));
}

async function captureJournalPageCorrections(
  page: RuntimeJournalPageDocument,
  changes: Record<string, unknown>,
): Promise<void> {
  if (!game.user?.isGM || !page.parent) return;
  const translated = page.parent.toObject() as JournalData;
  const flag = readJournalTranslationFlag(translated.flags);
  if (!flag) return;

  const sourceDocument = await fromUuid(flag.sourceUuid);
  if (!sourceDocument?.toObject) return;
  const source = sourceDocument.toObject() as JournalData;
  const pageId = page.id;
  const sourcePage = source.pages.find((item) => item._id === pageId);
  if (!sourcePage) return;

  const generatedPage = page.toObject() as JournalPageData;
  const glossary = await new GlossaryCompendiumRepository().load();
  const candidates: GlossaryCandidate[] = [];
  for (const changed of changedStrings(changes)) {
    const generatedText = readPath(generatedPage, changed.path);
    const sourceText = readPath(sourcePage, changed.path);
    if (typeof generatedText !== "string" || typeof sourceText !== "string") continue;
    const candidate = extractCorrectionCandidate({
      sourceText,
      generatedText,
      correctedText: changed.value,
      glossary,
      documentName: page.parent.name ?? translated.name,
      fieldName: `${page.name ?? sourcePage.name}: ${changed.path.join(".")}`,
    });
    if (candidate) candidates.push(candidate);
  }
  await addGlossaryCandidates(candidates);
  if (candidates.length) {
    ui.notifications.info(
      game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Candidates.Captured")
        .replace("{count}", String(candidates.length)),
    );
  }
}

export function registerGlossaryCandidateHooks(): void {
  Hooks.on("preUpdateJournalEntryPage", (
    page: RuntimeJournalPageDocument,
    changes: Record<string, unknown>,
    operation: Record<string, unknown>,
  ) => {
    if (operation.foundryTranslateGenerated) return;
    void captureJournalPageCorrections(page, changes).catch((error) => {
      logger.error("Glossary candidates could not be extracted from a manual correction.", error);
    });
  });
}
