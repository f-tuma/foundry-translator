import { ACTOR_TRANSLATION_FLAG_PATH, ACTOR_TRANSLATIONS_PACK_ID } from "./compendium-actor-translation-repository";
import { ITEM_TRANSLATION_FLAG_PATH, ITEM_TRANSLATIONS_PACK_ID } from "./compendium-item-translation-repository";
import { TRANSLATION_FLAG_PATH, TRANSLATIONS_PACK_ID } from "./compendium-translation-repository";
import { readActorTranslationFlag } from "./actor";
import { readItemTranslationFlag } from "./item";
import { readJournalTranslationFlag } from "./journal";
import { discoverObjectDependencies, type DocumentReferenceReplacement } from "./document-dependencies";

/** Index-only lookup: reuse available translations without starting linked jobs. */
export async function availableDocumentReferences(data: unknown, language: string): Promise<DocumentReferenceReplacement[]> {
  const specs = [
    { pack: TRANSLATIONS_PACK_ID, path: TRANSLATION_FLAG_PATH, kind: "JournalEntry", read: readJournalTranslationFlag },
    { pack: ACTOR_TRANSLATIONS_PACK_ID, path: ACTOR_TRANSLATION_FLAG_PATH, kind: "Actor", read: readActorTranslationFlag },
    { pack: ITEM_TRANSLATIONS_PACK_ID, path: ITEM_TRANSLATION_FLAG_PATH, kind: "Item", read: readItemTranslationFlag },
  ];
  const roots = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const spec of specs) {
    const pack = game.packs.get(spec.pack);
    if (!pack) continue;
    for (const entry of (await pack.getIndex({ fields: [spec.path] })).values()) {
      const flag = spec.read(entry.flags);
      if (flag?.targetLanguage !== language || ambiguous.has(flag.sourceUuid)) continue;
      if (roots.has(flag.sourceUuid)) { roots.delete(flag.sourceUuid); ambiguous.add(flag.sourceUuid); }
      else roots.set(flag.sourceUuid, `Compendium.${pack.collection}.${spec.kind}.${entry._id}`);
    }
  }
  const keys = [...roots.keys()].sort((a, b) => b.length - a.length);
  const result: DocumentReferenceReplacement[] = [];
  for (const { sourceUuid } of discoverObjectDependencies(data)) {
    const root = keys.find((key) => sourceUuid === key || sourceUuid.startsWith(`${key}.`));
    if (!root) continue;
    const target = `${roots.get(root)}${sourceUuid.slice(root.length)}`;
    // Source upgrades can remove embedded pages. In that case use the copy's root.
    const resolved = await fromUuid(target).catch(() => null);
    result.push({ sourceUuid, translatedUuid: resolved ? target : roots.get(root)! });
  }
  return result;
}
