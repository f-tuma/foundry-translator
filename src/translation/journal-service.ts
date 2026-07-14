import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { logger } from "../logger";
import { createTranslationProvider } from "../providers/factory";
import type { ChromeLocalProviderStatus } from "../providers/chrome-local";
import { getTranslatorSettings } from "../settings/settings";
import {
  actorSourceHash,
  canReuseActorTranslation,
  readActorTranslationFlag,
  translateActorData,
  type ActorData,
} from "./actor";
import { activeTranslations, type TranslationPlan } from "./active-translations";
import { CompendiumTranslationCache } from "./compendium-cache";
import { CompendiumActorTranslationRepository } from "./compendium-actor-translation-repository";
import { CompendiumJournalTranslationRepository } from "./compendium-translation-repository";
import { traverseDependencyGraph } from "./dependency-graph";
import {
  discoverJournalDependencies,
  discoverObjectDependencies,
  rewriteDocumentReferences,
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
  onPlan?: (plan: TranslationPlan) => void;
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

type GraphSourceDocument = FoundryJournalWorldDocument | FoundryActorWorldDocument;
type GraphTranslatedDocument = FoundryJournalDocument | FoundryActorDocument;
type GraphData = JournalData | ActorData;

interface GraphTranslationResult {
  data: GraphData;
  document: GraphTranslatedDocument;
  reused: boolean;
  fallbackTextSegments: number;
}

interface ResolvedJournalDependency {
  reference: DocumentDependency;
  resolved: FoundryUuidDocument;
  root: GraphSourceDocument;
}

interface JournalGraphNode {
  dependencies: ResolvedJournalDependency[];
  children?: readonly GraphSourceDocument[];
  units?: number;
  result?: GraphTranslationResult;
}

interface TranslationRuntime {
  settings: ReturnType<typeof getTranslatorSettings>;
  provider: ReturnType<typeof createTranslationProvider>;
  glossary: Awaited<ReturnType<GlossaryCompendiumRepository["load"]>>;
  cache: CompendiumTranslationCache;
  translations: CompendiumJournalTranslationRepository;
  actorTranslations: CompendiumActorTranslationRepository;
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

function isActorDocument(document: FoundryUuidDocument): document is FoundryActorWorldDocument {
  return document.documentName === "Actor" &&
    typeof document.uuid === "string" &&
    typeof document.toObject === "function";
}

function isSupportedSourceDocument(document: FoundryUuidDocument): document is GraphSourceDocument {
  return isJournalDocument(document) || isActorDocument(document);
}

function isTranslatedDocument(document: FoundryUuidDocument): boolean {
  return isJournalDocument(document)
    ? Boolean(readJournalTranslationFlag(document.flags))
    : isActorDocument(document) && Boolean(readActorTranslationFlag(document.flags));
}

export function translatedDocumentReferenceUuid(
  resolved: FoundryUuidDocument,
  sourceRoot: FoundryUuidDocument,
  translatedRoot: FoundryUuidDocument | FoundryJournalDocument,
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

export async function assertActorSourceUnchanged(
  sourceDocument: FoundryActorWorldDocument,
  expectedHash: string,
): Promise<void> {
  const currentSourceHash = await actorSourceHash(sourceDocument.toObject() as ActorData);
  if (currentSourceHash !== expectedHash) {
    throw new Error(
      "Zdrojový Actor se během překladu změnil. Překlad nebyl uložen; spusťte jej znovu a hotová pole se načtou z cache.",
    );
  }
}

function actorHtmlFieldPaths(
  sourceDocument: FoundryActorWorldDocument,
  source: ActorData,
): {
  system: readonly HtmlFieldPath[];
  items: readonly (readonly HtmlFieldPath[])[];
} {
  const system = discoverSystemHtmlFieldPaths(
    sourceDocument.system?.constructor?.schema?.fields,
    source.system,
  );
  const runtimeItems = new Map(
    (sourceDocument.items?.contents ?? [])
      .filter((item): item is FoundryItemDocument & { id: string } => Boolean(item.id))
      .map((item) => [item.id, item]),
  );
  const items = (source.items ?? []).map((item) => {
    const runtime = item._id ? runtimeItems.get(item._id) : undefined;
    return discoverSystemHtmlFieldPaths(
      runtime?.system?.constructor?.schema?.fields,
      item.system,
    );
  });
  return { system, items };
}

function documentTranslationUnits(document: GraphSourceDocument): number {
  if (isActorDocument(document)) {
    const source = document.toObject() as ActorData;
    const paths = actorHtmlFieldPaths(document, source);
    return paths.system.length + paths.items.reduce((total, item) => total + item.length, 0);
  }
  return (document.toObject() as JournalData).pages.length;
}

export class JournalTranslationService {
  readonly #onChromeStatus: ((status: ChromeLocalProviderStatus) => void) | undefined;
  readonly #onProgress: ((progress: JournalTranslationProgress) => void) | undefined;
  readonly #onPlan: ((plan: TranslationPlan) => void) | undefined;

  constructor(options: JournalTranslationServiceOptions = {}) {
    this.#onChromeStatus = options.onChromeStatus;
    this.#onProgress = options.onProgress;
    this.#onPlan = options.onPlan;
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
      actorTranslations: new CompendiumActorTranslationRepository(),
    };
    const runId = activeTranslations.start(sourceDocument.name, settings.targetLanguage);
    try {
      const result = await this.#translateGraph(sourceDocument, runtime, runId);
      activeTranslations.finish(runId);
      return result;
    } catch (error) {
      activeTranslations.finish(runId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async #translateGraph(
    sourceDocument: FoundryJournalWorldDocument,
    runtime: TranslationRuntime,
    runId: number,
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
    const nodeFor = (document: GraphSourceDocument): JournalGraphNode => {
      const existing = nodes.get(document.uuid);
      if (existing) return existing;
      const node = { dependencies: [] };
      nodes.set(document.uuid, node);
      return node;
    };

    const resolveNodeDependencies = async (
      document: GraphSourceDocument,
    ): Promise<readonly GraphSourceDocument[]> => {
        const node = nodeFor(document);
        if (node.children) return node.children;
        const source = document.toObject() as GraphData;
        const childDocuments = new Map<string, GraphSourceDocument>();
        const references = isJournalDocument(document)
          ? discoverJournalDependencies(source as JournalData)
          : discoverObjectDependencies(source);
        for (const reference of references) {
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
          if (!isSupportedSourceDocument(root)) {
            addWarning({
              kind: "unsupported",
              sourceUuid: reference.sourceUuid,
              parentUuid: document.uuid,
              message: `Rekurzivní překlad typu ${root.documentName} zatím není podporovaný; odkaz zůstal v originále.`,
            });
            continue;
          }
          if (isTranslatedDocument(root)) continue;
          node.dependencies.push({ reference, resolved, root });
          childDocuments.set(root.uuid, root);
          nodeFor(root);
        }
        node.children = [...childDocuments.values()];
        return node.children;
    };

    // Write-free scan of the whole graph so the total size is known upfront.
    const scan = await traverseDependencyGraph({
      root: sourceDocument as GraphSourceDocument,
      key: (document) => document.uuid,
      dependencies: resolveNodeDependencies,
      process: (document) => {
        nodeFor(document).units = documentTranslationUnits(document);
      },
    });
    const plan: TranslationPlan = {
      totalDocuments: scan.completed.length,
      totalUnits: scan.completed.reduce(
        (total, document) => total + (nodes.get(document.uuid)?.units ?? 0),
        0,
      ),
    };
    activeTranslations.update(runId, { state: "translating", plan });
    this.#onPlan?.(plan);

    const overall = { completedUnits: 0, completedDocuments: 0 };
    const emitProgress = (progress: JournalTranslationProgress): void => {
      const enriched: JournalTranslationProgress = {
        ...progress,
        overallCompletedUnits: overall.completedUnits + progress.completedPages,
        overallTotalUnits: plan.totalUnits,
        completedDocuments: overall.completedDocuments,
        totalDocuments: plan.totalDocuments,
      };
      activeTranslations.update(runId, {
        completedUnits: enriched.overallCompletedUnits ?? 0,
        ...(progress.documentName ? { currentDocument: progress.documentName } : {}),
        currentUnit: progress.pageName,
      });
      this.#onProgress?.(enriched);
    };

    const graph = await traverseDependencyGraph({
      root: sourceDocument as GraphSourceDocument,
      key: (document) => document.uuid,
      dependencies: resolveNodeDependencies,
      process: async (document) => {
        const node = nodeFor(document);
        node.result = await this.#translateOne(document, runtime, emitProgress);
        overall.completedUnits += node.units ?? 0;
        overall.completedDocuments += 1;
        activeTranslations.update(runId, {
          completedUnits: overall.completedUnits,
          completedDocuments: overall.completedDocuments,
        });
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
        message: `Závislý dokument ${failure.node.name} se nepodařilo přeložit; jeho odkazy zůstaly v originále.`,
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

      const rewritten = rewriteDocumentReferences(node.result.data, replacements);
      if (JSON.stringify(rewritten) === JSON.stringify(node.result.data)) continue;
      if (isJournalDocument(document)) {
        const journalData = rewritten as JournalData;
        const flag = readJournalTranslationFlag(journalData.flags);
        if (flag) await assertJournalSourceUnchanged(document, flag.sourceHash);
        node.result.data = journalData;
        node.result.document = await runtime.translations.save(journalData);
      } else {
        const actorData = rewritten as ActorData;
        const flag = readActorTranslationFlag(actorData.flags);
        if (flag) await assertActorSourceUnchanged(document, flag.sourceHash);
        node.result.data = actorData;
        node.result.document = await runtime.actorTranslations.save(actorData);
      }
    }

    const rootResult = nodes.get(sourceDocument.uuid)?.result;
    if (!rootResult) throw new Error("Kořenový deník se nepodařilo přeložit.");
    const completedResults = graph.completed
      .map((document) => nodes.get(document.uuid)?.result)
      .filter((result): result is GraphTranslationResult => Boolean(result));
    return {
      ...(rootResult as JournalTranslationResult),
      fallbackTextSegments: completedResults.reduce(
        (total, result) => total + result.fallbackTextSegments,
        0,
      ),
      processedDocuments: completedResults.length,
      reusedDocuments: completedResults.filter(({ reused }) => reused).length,
      dependencyWarnings: warnings,
    };
  }

  async #translateOne(
    sourceDocument: GraphSourceDocument,
    runtime: TranslationRuntime,
    onProgress: (progress: JournalTranslationProgress) => void,
  ): Promise<GraphTranslationResult> {
    if (isActorDocument(sourceDocument)) {
      return this.#translateActorOne(sourceDocument, runtime, onProgress);
    }
    return this.#translateJournalOne(sourceDocument, runtime, onProgress);
  }

  async #translateJournalOne(
    sourceDocument: FoundryJournalWorldDocument,
    runtime: TranslationRuntime,
    onProgress: (progress: JournalTranslationProgress) => void,
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
      onProgress: (progress: JournalTranslationProgress) => onProgress({
        ...progress,
        documentName: sourceDocument.name,
      }),
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

  async #translateActorOne(
    sourceDocument: FoundryActorWorldDocument,
    runtime: TranslationRuntime,
    onProgress: (progress: JournalTranslationProgress) => void,
  ): Promise<GraphTranslationResult> {
    const source = sourceDocument.toObject() as ActorData;
    const sourceHash = await actorSourceHash(source);
    const existing = await runtime.actorTranslations.find(
      sourceDocument.uuid,
      runtime.settings.targetLanguage,
    );
    const existingFlag = existing ? readActorTranslationFlag(existing.flags) : null;
    if (existing && existingFlag && canReuseActorTranslation(existingFlag, sourceHash)) {
      return {
        data: existing.toObject() as ActorData,
        document: existing,
        reused: true,
        fallbackTextSegments: existingFlag.fallbackTextSegments,
      };
    }

    const paths = actorHtmlFieldPaths(sourceDocument, source);
    const translated = await translateActorData({
      source,
      sourceUuid: sourceDocument.uuid,
      glossary: runtime.glossary,
      provider: runtime.provider,
      settings: {
        providerId: runtime.settings.provider,
        sourceLanguage: runtime.settings.sourceLanguage,
        targetLanguage: runtime.settings.targetLanguage,
      },
      systemHtmlFieldPaths: paths.system,
      itemHtmlFieldPaths: paths.items,
      cache: runtime.cache,
      onQualityFallback: (fallback) => {
        logger.warn("Actor translation quality fallback kept the original fragment.", fallback);
      },
      onProgress: (progress) => onProgress({
        kind: "actor-field",
        completedPages: progress.completedFields,
        totalPages: progress.totalFields,
        pageIndex: progress.completedFields - 1,
        pageName: progress.itemName ?? progress.fieldPath.join("."),
        translatedText: true,
        skippedText: false,
        documentName: sourceDocument.name,
      }),
    });
    await assertActorSourceUnchanged(sourceDocument, sourceHash);
    const document = await runtime.actorTranslations.save(translated.data);
    return { ...translated, document, reused: false };
  }
}
