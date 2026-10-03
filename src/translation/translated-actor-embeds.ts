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

function journalContext(document?: FoundryUuidDocument) {
  const seen = new Set<FoundryUuidDocument>();
  while (document && !seen.has(document)) {
    seen.add(document);
    if (document.documentName === "JournalEntry" || document.documentName === "JournalEntryPage") {
      const identity = translationIdentity(document, document.documentName);
      if (identity) return { document, language: identity.targetLanguage, identity: JSON.stringify(identity) };
    }
    document = document.parent ?? undefined;
  }
  return null;
}

function journalVisible(document?: FoundryUuidDocument): boolean {
  const seen = new Set<FoundryUuidDocument>();
  let found = false;
  while (document && !seen.has(document)) {
    seen.add(document);
    if (document.documentName === "JournalEntry" || document.documentName === "JournalEntryPage") {
      found = true;
      if ((document as FoundryUuidDocument & { visible?: boolean }).visible !== true) return false;
    }
    document = document.parent ?? undefined;
  }
  return found;
}

/** Ember's readaloud config is plain text, not another HTML/command entry point.
 * Reject unsupported payloads and create the same paragraph shape through text
 * nodes so no caller markup, secrets or executable enrichment can be inserted.
 */
function plainReadaloud(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 60000
    || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    || /(?:@\w+\s*\[|&(?:amp;)?reference\s*\[|\[\[)/iu.test(value)) return null;
  const holder = document.createElement("div");
  for (const text of value.split(/\\n|\r?\n/u)) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    holder.appendChild(paragraph);
  }
  return holder.innerHTML;
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
    const context = journalContext(options.relativeTo), language = context?.language;
    if (!root || !language || this.type !== "adversary" || this.visible !== true
      || readActorTranslationFlag(this.flags)) return root;
    const slot = root.querySelector<HTMLElement>(":scope > section.readaloud");
    const heading = root.querySelector<HTMLElement>(":scope > header > h4");
    if (!root.matches("document-embed.block.actor") || !slot || !heading
      || ![...heading.querySelectorAll<HTMLElement>("a[data-uuid]")].some(link => link.dataset.uuid === this.uuid)) return root;
    const explicit = config.readaloud !== undefined, override = config.readaloud;
    const explicitHtml = explicit ? plainReadaloud(override) : null;
    if (explicit && (!explicitHtml || !journalVisible(options.relativeTo))) return root;
    try {
      let target: EmbedActor | null = null;
      try {
        const pair = await resolveTranslationReference(this.uuid, language);
        if (pair.status === "mapped") {
          if (pair.sourceUuid !== this.uuid || !pair.translatedUuid) return root;
          target = await fromUuid(pair.translatedUuid) as EmbedActor | null;
          if (!target || target.uuid !== pair.translatedUuid || !permitted(this, target, language)) return root;
        }
      } catch (error) {
        if (!explicit) throw error;
        // A valid journal override has its own authority; no Actor copy is
        // necessary and no translated caption/metadata is used without one.
      }
      if (!explicit && !target) return root;
      const sourceText = appearance(this), targetText = target && appearance(target);
      if (!explicit && (typeof sourceText !== "string" || typeof targetText !== "string" || !targetText.trim())) return root;
      const normalized = explicitHtml ?? await originalAppearance(this, target!, targetText!);
      const editor = (CONFIG as unknown as { ux?: { TextEditor?: {
        enrichHTML(html: string, options: Record<string, unknown>): Promise<string>;
      } } }).ux?.TextEditor;
      if (!editor) return root;
      const secrets = !explicit && options.secrets !== false && this.isOwner === true && target?.isOwner === true;
      const enriched = await editor.enrichHTML(normalized, { ...options, relativeTo: this, secrets,
        ...(explicit ? { documents: false, links: false, embeds: false, rolls: false, custom: false } : {}) });
      // Do not widen a native visibility decision or replace the prose of a
      // concurrently edited actor. Stage everything before touching the DOM.
      const category = root.querySelector<HTMLElement>(":scope > header > .meta > .category");
      const names = [this.system?.details?.taxonomy?.name || "Unknown", this.system?.details?.archetype?.name || "Unknown"];
      let subtitle: string | undefined;
      if (target && category?.textContent === names.join(" ")) {
        try {
          const entries = await new GlossaryCompendiumRepository().loadExisting();
          subtitle = names.map(name => glossaryName(name, entries)).join(" ");
        } catch { /* An unavailable glossary must not block valid appearance prose. */ }
      }
      const currentContext = journalContext(options.relativeTo);
      if (this.visible !== true || readActorTranslationFlag(this.flags)
        || (target && (!permitted(this, target, language) || appearance(target) !== targetText)) || appearance(this) !== sourceText
        || currentContext?.document !== context!.document || currentContext?.identity !== context!.identity
        || (explicit && (config.readaloud !== override || !journalVisible(options.relativeTo)))
        || secrets !== (!explicit && options.secrets !== false && this.isOwner === true && target?.isOwner === true)) return root;
      slot.innerHTML = enriched;
      if (category && subtitle !== undefined) category.textContent = subtitle;
      // An explicit caller caption has precedence over the stored translation.
      if (target && (typeof config.label !== "string" || !config.label.trim())) applyEmbedLabel(root, this.uuid, this.name, target.name);
    } catch (error) {
      logger.warn("Could not display a translated Actor appearance; keeping the native embed.", error);
    }
    return root;
  };
  prototype[PATCHED] = true;
}
