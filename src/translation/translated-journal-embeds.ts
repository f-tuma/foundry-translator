import { resolveTranslationReference, translationIdentity } from "./document-identity";
import { readJournalTranslationFlag } from "./journal";
import { logger } from "../logger";

interface EmbedPage extends FoundryUuidDocument {
  type?: string;
  visible?: boolean;
  isOwner?: boolean;
}
interface EmbedOptions {
  relativeTo?: FoundryUuidDocument;
  secrets?: boolean;
  [key: string]: unknown;
}
type EmbedMethod = (this: EmbedPage, config: Record<string, unknown>, options?: EmbedOptions) => Promise<HTMLElement | null>;
const PATCHED = Symbol("foundry-translate-journal-embeds");
interface EmbedPrototype { toEmbed?: EmbedMethod; [PATCHED]?: boolean }
// Ember 0.6.2 renders these as prose/overview only. Event, quest and other
// interactive models are deliberately excluded from this presentation adapter.
const PROSE_TYPES = new Set(["text", "ember.lore", "ember.ancestry", "ember.location"]);

function contextLanguage(document?: FoundryUuidDocument): string | null {
  const seen = new Set<FoundryUuidDocument>();
  while (document && !seen.has(document)) {
    seen.add(document);
    const identity = translationIdentity(document, document.documentName ?? "");
    if (identity) return identity.targetLanguage;
    document = document.parent ?? undefined;
  }
  return null;
}

/** Resolve at display time: a referenced guide may have been translated later.
 * Only prose embeds inside a translated document opt in. No stored UUID changes,
 * global fromUuid interception, document writes, or gameplay embeds are involved.
 */
export function registerTranslatedJournalEmbeds(): void {
  const prototype = CONFIG.JournalEntryPage?.documentClass?.prototype as EmbedPrototype | undefined;
  if (!prototype?.toEmbed || prototype[PATCHED]) return;
  const original = prototype.toEmbed;
  prototype.toEmbed = async function(config = {}, options = {}) {
    const language = contextLanguage(options.relativeTo);
    if (!PROSE_TYPES.has(this.type ?? "") || !language || this.visible !== true
      || contextLanguage(this) === language) return original.call(this, config, options);
    let target: EmbedPage | null = null;
    try {
      const pair = await resolveTranslationReference(this.uuid, language);
      if (pair.status === "mapped" && pair.translatedUuid && pair.translatedUuid !== this.uuid) {
        const candidate = await fromUuid(pair.translatedUuid) as EmbedPage | null;
        const flag = readJournalTranslationFlag(candidate?.parent?.flags);
        if (candidate?.documentName === "JournalEntryPage" && candidate.type === this.type
          && candidate.visible === true && flag?.targetLanguage === language
          && (!flag.partial || (candidate.id && flag.processedPageIds?.includes(candidate.id)))) target = candidate;
      }
    } catch (error) {
      logger.warn("Could not resolve a translated text embed; displaying the source.", error);
    }
    if (target) {
      try {
        // Preserve native enrichment options/depth and explicit secret policy.
        // The translated copy must never widen the source's implicit visibility.
        const embed = await original.call(target, config, {
          ...options, secrets: options.secrets ?? (this.isOwner === true && target.isOwner === true),
        });
        if (embed) return embed;
      } catch (error) {
        logger.warn("Could not render a translated text embed; displaying the source.", error);
      }
    }
    return original.call(this, config, options);
  };
  prototype[PATCHED] = true;
}
