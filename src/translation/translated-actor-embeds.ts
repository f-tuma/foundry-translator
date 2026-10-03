import { assertPortableText } from "../bundles/format";
import { absoluteReference, sourceReferenceNotation } from "../bundles/reference-notation";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import type { GlossaryEntry } from "../glossary/types";
import { logger } from "../logger";
import { readActorTranslationFlag } from "./actor";
import { applyEmbedLabel } from "./crucible-embed-labels";
import { discoverDocumentDependencies, rewriteDocumentReferences } from "./document-dependencies";
import { resolveSourceReference, resolveTranslationReference, translationIdentity } from "./document-identity";

interface EmbedActor extends FoundryUuidDocument {
  documentName: string;
  name: string;
  type: string;
  visible?: boolean;
  isOwner?: boolean;
  system?: { details?: {
    biography?: { appearance?: string };
    taxonomy?: { name?: string };
    archetype?: { name?: string };
  } };
}
interface EmbedOptions { relativeTo?: FoundryUuidDocument; secrets?: boolean; [key: string]: unknown }
type EmbedMethod = (this: EmbedActor, config: Record<string, unknown>, options?: EmbedOptions) => Promise<HTMLElement | null>;
const PATCHED = Symbol("foundry-translate-actor-embeds");
interface EmbedPrototype { toEmbed?: EmbedMethod; [PATCHED]?: boolean }

function journalLanguage(document?: FoundryUuidDocument): string | null {
  const seen = new Set<FoundryUuidDocument>();
  while (document && !seen.has(document)) {
    seen.add(document);
    if (document.documentName === "JournalEntry" || document.documentName === "JournalEntryPage") {
      const identity = translationIdentity(document, document.documentName);
      if (identity) return identity.targetLanguage;
    }
    document = document.parent ?? undefined;
  }
  return null;
}

function appearance(actor: EmbedActor): string | undefined { return actor.system?.details?.biography?.appearance; }
function permitted(source: EmbedActor, target: EmbedActor, language: string): boolean {
  const flag = readActorTranslationFlag(target.flags);
  return source.visible === true && target.visible === true && target.documentName === "Actor"
    && target.type === source.type && target.uuid !== source.uuid && flag?.sourceUuid === source.uuid
    && flag.targetLanguage === language && !readActorTranslationFlag(source.flags);
}

/** Translate schema names only through an exact, unambiguous approved term.
 * Prepared taxonomy/archetype objects also contain mechanics; none are copied.
 */
function glossaryName(name: string, entries: readonly GlossaryEntry[]): string {
  const key = name.normalize("NFC").trim().toLocaleLowerCase();
  const matches = entries.filter(entry => entry.enabled !== false && [entry.source, ...entry.aliases]
    .some(value => value.normalize("NFC").trim().toLocaleLowerCase() === key));
  const replacements = new Set(matches.map(entry => entry.replacement.trim()).filter(Boolean));
  return replacements.size === 1 ? [...replacements][0]! : name;
}

/** Native enrichment must still resolve against the original actor. Undo only
 * known copy identities, then demand the same source commands and HTML/secret
 * structure. A missing/ambiguous child mapping fails closed in the validator.
 */
async function originalAppearance(source: EmbedActor, target: EmbedActor, text: string): Promise<string> {
  const replacements = [];
  for (const { sourceUuid } of discoverDocumentDependencies(text)) {
    const absolute = absoluteReference(sourceUuid, target.uuid);
    if (!absolute) continue;
    const original = await resolveSourceReference(absolute);
    if (original && original !== sourceUuid) replacements.push({ sourceUuid, translatedUuid: original });
  }
  const normalized = sourceReferenceNotation(appearance(source)!, rewriteDocumentReferences(text, replacements), source.uuid);
  assertPortableText(appearance(source)!, normalized, "html");
  return normalized;
}

/** Crucible adversary cards retain their native Actor, UUIDs, actions, discovery
 * controls and listeners. Only the native appearance slot and text captions are
 * changed, and only when the containing journal is a translated copy.
 */
export function registerTranslatedActorEmbeds(): void {
  if (game.system?.id !== "crucible") return;
  const prototype = CONFIG.Actor?.documentClass?.prototype as EmbedPrototype | undefined;
  if (!prototype?.toEmbed || prototype[PATCHED]) return;
  const original = prototype.toEmbed;
  prototype.toEmbed = async function(config = {}, options = {}) {
    // Rendering a translated Actor would change gameplay IDs and visibility.
    const root = await original.call(this, config, options);
    const language = journalLanguage(options.relativeTo);
    if (!root || !language || this.type !== "adversary" || this.visible !== true
      || readActorTranslationFlag(this.flags) || config.readaloud !== undefined) return root;
    const slot = root.querySelector<HTMLElement>(":scope > section.readaloud");
    const heading = root.querySelector<HTMLElement>(":scope > header > h4");
    if (!root.matches("document-embed.block.actor") || !slot || !heading
      || ![...heading.querySelectorAll<HTMLElement>("a[data-uuid]")].some(link => link.dataset.uuid === this.uuid)) return root;
    try {
      const pair = await resolveTranslationReference(this.uuid, language);
      if (pair.status !== "mapped" || pair.sourceUuid !== this.uuid || !pair.translatedUuid) return root;
      const target = await fromUuid(pair.translatedUuid) as EmbedActor | null;
      if (!target || target.uuid !== pair.translatedUuid || !permitted(this, target, language)) return root;
      const sourceText = appearance(this), targetText = appearance(target);
      if (typeof sourceText !== "string" || typeof targetText !== "string" || !targetText.trim()) return root;
      const normalized = await originalAppearance(this, target, targetText);
      const editor = (CONFIG as unknown as { ux?: { TextEditor?: {
        enrichHTML(html: string, options: Record<string, unknown>): Promise<string>;
      } } }).ux?.TextEditor;
      if (!editor) return root;
      const secrets = options.secrets !== false && this.isOwner === true && target.isOwner === true;
      const enriched = await editor.enrichHTML(normalized, { ...options, relativeTo: this, secrets });
      // Do not widen a native visibility decision or replace the prose of a
      // concurrently edited actor. Stage everything before touching the DOM.
      const category = root.querySelector<HTMLElement>(":scope > header > .meta > .category");
      const names = [this.system?.details?.taxonomy?.name || "Unknown", this.system?.details?.archetype?.name || "Unknown"];
      let subtitle: string | undefined;
      if (category?.textContent === names.join(" ")) {
        try {
          const entries = await new GlossaryCompendiumRepository().loadExisting();
          subtitle = names.map(name => glossaryName(name, entries)).join(" ");
        } catch { /* An unavailable glossary must not block valid appearance prose. */ }
      }
      if (!permitted(this, target, language) || appearance(this) !== sourceText || appearance(target) !== targetText
        || journalLanguage(options.relativeTo) !== language
        || secrets !== (options.secrets !== false && this.isOwner === true && target.isOwner === true)) return root;
      slot.innerHTML = enriched;
      if (category && subtitle !== undefined) category.textContent = subtitle;
      // An explicit caller caption has precedence over the stored translation.
      if (typeof config.label !== "string" || !config.label.trim()) applyEmbedLabel(root, this.uuid, this.name, target.name);
    } catch (error) {
      logger.warn("Could not display a translated Actor appearance; keeping the native embed.", error);
    }
    return root;
  };
  prototype[PATCHED] = true;
}
