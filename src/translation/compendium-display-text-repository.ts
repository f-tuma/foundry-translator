import { MODULE_ID, MODULE_TITLE } from "../constants";
import { organizeCompendiumPack } from "../storage/compendium-folder";
import { DISPLAY_TEXT_PACK, readDisplayTextFlag } from "./display-text";
import type { JournalData } from "./journal";
import { assertTranslationWriteGuard, TranslationConflictError, type TranslationWriteGuard } from "./write-guard";

export class CompendiumDisplayTextRepository {
  async find(sourceUuid: string, language: string): Promise<FoundryJournalDocument | null> {
    const pack = game.packs.get(DISPLAY_TEXT_PACK);
    if (!pack) return null;
    const matches = [...(await pack.getIndex({ fields: [`flags.${MODULE_ID}.displayTranslation`] })).values()].filter(entry => {
      const flag = entry.flags?.[MODULE_ID]?.displayTranslation as { sourceUuid?: string; targetLanguage?: string } | undefined;
      return flag?.sourceUuid === sourceUuid && flag.targetLanguage === language;
    });
    if (matches.length > 1) throw new TranslationConflictError("Duplicate scene/effect translations; resolve the duplicate before continuing.");
    if (!matches[0]) return null;
    const document = await pack.getDocument(matches[0]._id);
    const flag = document && readDisplayTextFlag(document.flags);
    if (!document || !flag || flag.sourceUuid !== sourceUuid || flag.targetLanguage !== language) {
      throw new TranslationConflictError("Invalid scene/effect translation; review the existing record before continuing.");
    }
    return document;
  }

  async save(data: JournalData, guard: TranslationWriteGuard | null): Promise<FoundryJournalDocument> {
    const flag = readDisplayTextFlag(data.flags);
    if (!flag) throw new Error("Invalid scene/effect translation metadata.");
    let pack = game.packs.get(DISPLAY_TEXT_PACK);
    if (!pack) {
      if (!game.user?.isGM) throw new Error("Only a GM can create scene/effect translations.");
      pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
        name: DISPLAY_TEXT_PACK.slice(6), label: `${MODULE_TITLE} — Scene & Effect Text`, type: "JournalEntry", package: "world",
        ownership: { GAMEMASTER: "OWNER", ASSISTANT: "OWNER", TRUSTED: "NONE", PLAYER: "NONE" },
      });
    }
    if (pack.locked) throw new Error("Scene/effect translation compendium is locked.");
    await organizeCompendiumPack(pack);
    const existing = await this.find(flag.sourceUuid, flag.targetLanguage);
    await assertTranslationWriteGuard(existing, guard);
    if (existing?.id) {
      await foundry.documents.JournalEntry.implementation.updateDocuments([{ ...data, _id: existing.id }], { pack: pack.collection });
      return (await pack.getDocument(existing.id))!;
    }
    const [created] = await foundry.documents.JournalEntry.implementation.createDocuments([data], { pack: pack.collection, keepId: true });
    if (!created) throw new Error("Scene/effect translation could not be saved.");
    return created;
  }
}
