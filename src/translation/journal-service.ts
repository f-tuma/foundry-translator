import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { logger } from "../logger";
import { createTranslationProvider } from "../providers/factory";
import type { ChromeLocalProviderStatus } from "../providers/chrome-local";
import { getTranslatorSettings } from "../settings/settings";
import { CompendiumTranslationCache } from "./compendium-cache";
import { CompendiumJournalTranslationRepository } from "./compendium-translation-repository";
import { traverseDependencyGraph } from "./dependency-graph";
import {
  discoverJournalDependencies,
  rewriteJournalDocumentReferences,
  type DocumentDependency,
  type DocumentReferenceReplacement,
} from "./document-dependencies";
import {
  canReuseJournalTranslation,
  journalSourceHash,
  readJournalTranslationFlag,
  translateJournalData,
  type JournalData,
  type JournalTranslationProgress,
  type TranslatedJournal,
} from "./journal";
import {
  discoverSystemHtmlFieldPaths,
  readPath,
  type HtmlFieldPath,
} from "./system-html-fields";

export interface JournalTranslationServiceOptions {
  onChromeStatus?: (status: ChromeLocalProviderStatus) => void;
  onProgress?: (progress: JournalTranslationProgress) => void;
}

export interface JournalTranslationResult extends TranslatedJournal {
  document: FoundryJournalDocument;
  reused: boolean;
  processedDocuments: number;
  reusedDocuments: number;
  dependencyWarnings: readonly JournalDependencyWarning[];
}

export type JournalDependencyWarningKind = "unresolved" | "unsupported" | "failed";

export interface JournalDependencyWarning {
  kind: JournalDependencyWarningKind;
  sourceUuid: string;
  parentUuid: string;
  message: string;
}

interface ResolvedJournalDependency {
  reference: DocumentDependency;
  resolved: FoundryUuidDocument;
  root: FoundryJournalWorldDocument;
}

interface JournalGraphNode {
  sourceDocument: FoundryJournalWorldDocument;
  dependencies: ResolvedJournalDependency[];
  result?: JournalTranslationResult;
}

interface TranslationRuntime {
  settings: ReturnType<typeof getTranslatorSettings>;
  provider: ReturnType<typeof createTranslationProvider>;
  glossary: Awaited<ReturnType<GlossaryCompendiumRepository["load"]>>;
  cache: CompendiumTranslationCache;
  translations: CompendiumJournalTranslationRepository;
}

interface RuntimePageSystem {
  constructor?: {
    schema?: {
      fields?: Record<string, unknown>;
    };
  };
}

interface RuntimeJournalPage {
  system?: RuntimePageSystem;
}

function systemHtmlFieldPaths(
  sourceDocument: FoundryJournalWorldDocument,
  source: JournalData,
): readonly (readonly HtmlFieldPath[])[] {
  const pages = (sourceDocument as FoundryJournalWorldDocument & {
    pages?: { contents?: RuntimeJournalPage[] };
  }).pages?.contents ?? [];
  return source.pages.map((page, index) => discoverSystemHtmlFieldPaths(
    pages[index]?.system?.constructor?.schema?.fields,
    page.system,
  ));
}

function translationSample(
  source: JournalData,
  htmlFieldPaths: readonly (readonly HtmlFieldPath[])[],
): string {
  const contents = source.pages
    .flatMap((page, index) => [
      page.text?.content,
      ...(htmlFieldPaths[index] ?? []).map((path) => readPath(page.system, path)),
    ])
    .filter((content): content is string => typeof content === "string")
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${source.name}. ${contents}`.slice(0, 4000);
}

function rootDocument(document: FoundryUuidDocument): FoundryUuidDocument {
  let root = document;
  while (root.parent?.uuid) root = root.parent;
  return root;
}

function isJournalDocument(document: FoundryUuidDocument): document is FoundryJournalWorldDocument {
  return document.documentName === "JournalEntry" &&
    typeof document.uuid === "string" &&
    typeof document.toObject === "function";
}

export function translatedDocumentReferenceUuid(
  resolved: FoundryUuidDocument,
  sourceRoot: FoundryJournalWorldDocument,
  translatedRoot: FoundryJournalDocument,
): string | null {
  if (!translatedRoot.uuid) return null;
  if (resolved.uuid === sourceRoot.uuid) return translatedRoot.uuid;

  const embedded: string[] = [];
  let current: FoundryUuidDocument | null | undefined = resolved;
  while (current && current.uuid !== sourceRoot.uuid) {
    if (!current.id || !current.documentName) return null;
    embedded.unshift(current.documentName, current.id);
    current = current.parent;
  }
  return current ? `${translatedRoot.uuid}.${embedded.join(".")}` : null;
}

export async function assertJournalSourceUnchanged(
  sourceDocument: FoundryJournalWorldDocument,
  expectedHash: string,
): Promise<void> {
  const currentSourceHash = await journalSourceHash(sourceDocument.toObject() as JournalData);
  if (currentSourceHash !== expectedHash) {
    throw new Error(
      "Zdrojový deník se během překladu změnil. Překlad nebyl uložen; spusťte jej znovu a hotové stránky se načtou z cache.",
    );
  }
}

export class JournalTranslationService {
  readonly #onChromeStatus: ((status: ChromeLocalProviderStatus) => void) | undefined;
  readonly #onProgress: ((progress: JournalTranslationProgress) => void) | undefined;

  constructor(options: JournalTranslationServiceOptions = {}) {
    this.#onChromeStatus = options.onChromeStatus;
    this.#onProgress = options.onProgress;
  }

  async translate(sourceDocument: FoundryJournalWorldDocument): Promise<JournalTranslationResult> {
    if (!game.user?.isGM) throw new Error("Deník může překládat pouze Game Master.");

    const settings = getTranslatorSettings();
    const source = sourceDocument.toObject() as JournalData;
    const htmlFieldPaths = systemHtmlFieldPaths(sourceDocument, source);
    const provider = createTranslationProvider(settings, {
      ...(this.#onChromeStatus ? { onChromeStatus: this.#onChromeStatus } : {}),
    });

    // Calling prepare before the first await preserves Chrome's user activation.
    const preparation = provider.prepare?.({
      texts: [translationSample(source, htmlFieldPaths)],
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      format: "text",
    });

    const [glossary] = await Promise.all([
      new GlossaryCompendiumRepository().load(),
      preparation ?? Promise.resolve(),
    ]);
    const runtime: TranslationRuntime = {
      settings,
      provider,
      glossary,
      cache: new CompendiumTranslationCache(),
      translations: new CompendiumJournalTranslationRepository(),
    };
    return this.#translateGraph(sourceDocument, runtime);
  }

  async #translateGraph(
    sourceDocument: FoundryJournalWorldDocument,
    runtime: TranslationRuntime,
  ): Promise<JournalTranslationResult> {
    const nodes = new Map<string, JournalGraphNode>();
    const warnings: JournalDependencyWarning[] = [];
    const warningKeys = new Set<string>();
    const addWarning = (warning: JournalDependencyWarning): void => {
      const key = `${warning.kind}\u0000${warning.parentUuid}\u0000${warning.sourceUuid}`;
      if (warningKeys.has(key)) return;
      warningKeys.add(key);
      warnings.push(warning);
      logger.warn("Journal dependency could not be translated recursively.", warning);
    };
    const nodeFor = (document: FoundryJournalWorldDocument): JournalGraphNode => {
      const existing = nodes.get(document.uuid);
      if (existing) return existing;
      const node = { sourceDocument: document, dependencies: [] };
      nodes.set(document.uuid, node);
      return node;
    };

    const graph = await traverseDependencyGraph({
      root: sourceDocument,
      key: (document) => document.uuid,
      dependencies: async (document) => {
        const node = nodeFor(document);
        const source = document.toObject() as JournalData;
        const childDocuments = new Map<string, FoundryJournalWorldDocument>();
        for (const reference of discoverJournalDependencies(source)) {
          let resolved: FoundryUuidDocument | null = null;
          try {
            resolved = await fromUuid(reference.sourceUuid, { relative: document });
          } catch (error) {
            logger.warn("Foundry UUID resolution failed.", { reference, error });
          }
          if (!resolved) {
            addWarning({
              kind: "unresolved",
              sourceUuid: reference.sourceUuid,
              parentUuid: document.uuid,
              message: `Odkaz ${reference.sourceUuid} se nepodařilo najít; zůstal v originále.`,
            });
            continue;
          }
          const root = rootDocument(resolved);
          if (!isJournalDocument(root)) {
            addWarning({
              kind: "unsupported",
              sourceUuid: reference.sourceUuid,
              parentUuid: document.uuid,
              message: `Rekurzivní překlad typu ${root.documentName} zatím není podporovaný; odkaz zůstal v originále.`,
            });
            continue;
          }
          if (readJournalTranslationFlag(root.flags)) continue;
          node.dependencies.push({ reference, resolved, root });
          childDocuments.set(root.uuid, root);
          nodeFor(root);
        }
        return [...childDocuments.values()];
      },
      process: async (document) => {
        const node = nodeFor(document);
        node.result = await this.#translateOne(document, runtime);
      },
      onCycle: (from, to) => {
        logger.info("Journal dependency cycle detected and safely deferred.", {
          from: from.uuid,
          to: to.uuid,
        });
      },
    });

    for (const failure of graph.failures) {
      addWarning({
        kind: "failed",
        sourceUuid: failure.node.uuid,
        parentUuid: sourceDocument.uuid,
        message: `Závislý deník ${failure.node.name} se nepodařilo přeložit; jeho odkazy zůstaly v originále.`,
      });
    }

    for (const document of graph.completed) {
      const node = nodes.get(document.uuid);
      if (!node?.result) continue;
      const replacements: DocumentReferenceReplacement[] = [];
      for (const dependency of node.dependencies) {
        const translatedDependency = nodes.get(dependency.root.uuid)?.result?.document;
        if (!translatedDependency) continue;
        const translatedUuid = translatedDocumentReferenceUuid(
          dependency.resolved,
          dependency.root,
          translatedDependency,
        );
        if (translatedUuid) {
          replacements.push({ sourceUuid: dependency.reference.sourceUuid, translatedUuid });
        }
      }
      if (!replacements.length) continue;

      const rewritten = rewriteJournalDocumentReferences(node.result.data, replacements);
      if (JSON.stringify(rewritten) === JSON.stringify(node.result.data)) continue;
      const flag = readJournalTranslationFlag(rewritten.flags);
      if (flag) await assertJournalSourceUnchanged(document, flag.sourceHash);
      node.result.data = rewritten;
      node.result.document = await runtime.translations.save(rewritten);
    }

    const rootResult = nodes.get(sourceDocument.uuid)?.result;
    if (!rootResult) throw new Error("Kořenový deník se nepodařilo přeložit.");
    const completedResults = graph.completed
      .map((document) => nodes.get(document.uuid)?.result)
      .filter((result): result is JournalTranslationResult => Boolean(result));
    return {
      ...rootResult,
      processedDocuments: completedResults.length,
      reusedDocuments: completedResults.filter(({ reused }) => reused).length,
      dependencyWarnings: warnings,
    };
  }

  async #translateOne(
    sourceDocument: FoundryJournalWorldDocument,
    runtime: TranslationRuntime,
  ): Promise<JournalTranslationResult> {
    const source = sourceDocument.toObject() as JournalData;
    const sourceHash = await journalSourceHash(source);
    const existing = await runtime.translations.find(
      sourceDocument.uuid,
      runtime.settings.targetLanguage,
    );
    const existingFlag = existing ? readJournalTranslationFlag(existing.flags) : null;
    if (existing && existingFlag && canReuseJournalTranslation(existingFlag, sourceHash)) {
      return {
        data: existing.toObject() as JournalData,
        translatedTextPages: existingFlag.translatedTextPages,
        skippedTextPages: existingFlag.skippedTextPages,
        fallbackTextSegments: existingFlag.fallbackTextSegments,
        document: existing,
        reused: true,
        processedDocuments: 1,
        reusedDocuments: 1,
        dependencyWarnings: [],
      };
    }

    const translated = await translateJournalData({
      source,
      sourceUuid: sourceDocument.uuid,
      glossary: runtime.glossary,
      provider: runtime.provider,
      settings: {
        providerId: runtime.settings.provider,
        sourceLanguage: runtime.settings.sourceLanguage,
        targetLanguage: runtime.settings.targetLanguage,
      },
      cache: runtime.cache,
      systemHtmlFieldPaths: systemHtmlFieldPaths(sourceDocument, source),
      onQualityFallback: (fallback) => {
        logger.warn("Translation quality fallback kept the original fragment.", fallback);
      },
      ...(this.#onProgress ? {
        onProgress: (progress: JournalTranslationProgress) => this.#onProgress?.({
          ...progress,
          documentName: sourceDocument.name,
        }),
      } : {}),
    });
    await assertJournalSourceUnchanged(sourceDocument, sourceHash);
    const document = await runtime.translations.save(translated.data);
    return {
      ...translated,
      document,
      reused: false,
      processedDocuments: 1,
      reusedDocuments: 0,
      dependencyWarnings: [],
    };
  }
}
