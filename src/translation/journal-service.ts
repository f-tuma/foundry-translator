import { captureTranslationWriteGuard, TranslationConflictError } from "./write-guard";
import { GlossarySyncCancelledError } from "../glossary/types";
import { providerFingerprint } from "./provider-fingerprint";
import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import { logger } from "../logger";
import { createTranslationProvider } from "../providers/factory";
import type { ChromeLocalProviderStatus } from "../providers/chrome-local";
import { getTranslatorSettings } from "../settings/settings";
import {
  ACTOR_TRANSLATION_ENGINE_REVISION,
  actorSourceHash,
  canReuseActorTranslation,
  readActorTranslationFlag,
  stampActorOutputHash,
  translateActorData,
  type ActorData,
} from "./actor";
import { activeTranslations, type TranslationPlan } from "./active-translations";
import {
  ITEM_TRANSLATION_ENGINE_REVISION,
  canReuseItemTranslation,
  itemSourceHash,
  readItemTranslationFlag,
  stampItemOutputHash,
  translateItemData,
  type ItemData,
} from "./item";
import { CompendiumItemTranslationRepository } from "./compendium-item-translation-repository";
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
  TRANSLATION_ENGINE_REVISION,
  canReuseJournalPageTranslation,
  canReuseJournalTranslation,
  journalSourceHash,
  mergePartialJournalTranslation,
  readJournalTranslationFlag,
  stampJournalOutputHash,
  translateJournalData,
  type JournalData,
  type JournalTranslationProgress,
  type TranslatedJournal,
} from "./journal";
import { hasManualOutputEdits } from "./output-hash";
import {
  discoverSystemHtmlFieldPaths,
  discoverEmberTextFieldPaths,
  readPath,
  type HtmlFieldPath,
} from "./system-html-fields";
import { containsTranslationPromptLeak, glossaryFingerprint } from "./unit-translator";
import { availableDocumentReferences } from "./available-references";

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

export class TranslationCancelledError extends Error {
  constructor() {
    super("Překlad byl zrušen. Hotové části zůstávají uložené a další spuštění na ně naváže.");
    this.name = "TranslationCancelledError";
  }
}

let translationInProgress = false;

async function checkpointControl(runId: number): Promise<void> {
  throwIfCancelled(runId);
  await activeTranslations.waitUntilResumed(runId);
  throwIfCancelled(runId);
}

function throwIfCancelled(runId: number): void {
  if (activeTranslations.isCancelRequested(runId)) throw new TranslationCancelledError();
}

export type JournalDependencyWarningKind = "unresolved" | "unsupported" | "failed";

export interface JournalDependencyWarning {
  kind: JournalDependencyWarningKind;
  sourceUuid: string;
  parentUuid: string;
  message: string;
  documentType?: string;
  detail?: string;
}

type GraphSourceDocument =
  | FoundryJournalWorldDocument
  | FoundryActorWorldDocument
  | FoundryItemWorldDocument;
type GraphTranslatedDocument =
  | FoundryJournalDocument
  | FoundryActorDocument
  | FoundryItemWorldDocument;
type GraphData = JournalData | ActorData | ItemData;

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

interface TranslationScope {
  /** Translate only these root-journal pages (partial translation). */
  rootPageIds?: readonly string[];
  /** Do not expand dependencies of nodes at this depth or deeper. */
  dependencyDepthLimit?: number;
}

interface TranslationRuntime {
  runId: number;
  rootUuid: string;
  glossaryHash: string;
  providerHash: string;
  settings: ReturnType<typeof getTranslatorSettings>;
  provider: ReturnType<typeof createTranslationProvider>;
  glossary: Awaited<ReturnType<GlossaryCompendiumRepository["load"]>>;
  cache: CompendiumTranslationCache;
  translations: CompendiumJournalTranslationRepository;
  actorTranslations: CompendiumActorTranslationRepository;
  itemTranslations: CompendiumItemTranslationRepository;
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

function systemTextFieldPaths(sourceDocument: FoundryJournalWorldDocument, source: JournalData): readonly (readonly HtmlFieldPath[])[] {
  const pages = (sourceDocument as FoundryJournalWorldDocument & {
    pages?: { contents?: (RuntimeJournalPage & { id?: string })[] };
  }).pages?.contents ?? [];
  return source.pages.map((page, index) => discoverEmberTextFieldPaths(
    page.type, pages[index]?.system?.constructor?.schema?.fields, page.system,
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

function isItemDocument(document: FoundryUuidDocument): document is FoundryItemWorldDocument {
  return document.documentName === "Item" &&
    typeof document.uuid === "string" &&
    typeof document.toObject === "function";
}

function isSupportedSourceDocument(document: FoundryUuidDocument): document is GraphSourceDocument {
  return isJournalDocument(document) || isActorDocument(document) || isItemDocument(document);
}

function isTranslatedDocument(document: FoundryUuidDocument): boolean {
  if (isJournalDocument(document)) return Boolean(readJournalTranslationFlag(document.flags));
  if (isActorDocument(document)) return Boolean(readActorTranslationFlag(document.flags));
  return isItemDocument(document) && Boolean(readItemTranslationFlag(document.flags));
}

export function translatedDocumentReferenceUuid(
  resolved: FoundryUuidDocument,
  sourceRoot: FoundryUuidDocument,
  translatedRoot: FoundryUuidDocument | FoundryJournalDocument,
  sourceReferenceUuid?: string,
): string | null {
  if (!translatedRoot.uuid) return null;
  if (resolved.uuid === sourceRoot.uuid) {
    const referenceRoot = sourceReferenceUuid
      ? rootDocumentReferenceUuid(sourceReferenceUuid)
      : null;
    if (referenceRoot === sourceRoot.uuid && sourceReferenceUuid !== sourceRoot.uuid) {
      return `${translatedRoot.uuid}${sourceReferenceUuid?.slice(referenceRoot.length) ?? ""}`;
    }
    return translatedRoot.uuid;
  }

  const embedded: string[] = [];
  let current: FoundryUuidDocument | null | undefined = resolved;
  while (current && current.uuid !== sourceRoot.uuid) {
    if (!current.id || !current.documentName) return null;
    embedded.unshift(current.documentName, current.id);
    current = current.parent;
  }
  return current ? `${translatedRoot.uuid}.${embedded.join(".")}` : null;
}

/**
 * Builds a translated reference and avoids persisting a known-broken embedded
 * UUID. Root fallback resolution means the original embedded target no longer
 * exists; retain its suffix only when the translated document actually has it.
 */
export async function usableTranslatedDocumentReferenceUuid(
  resolved: FoundryUuidDocument,
  sourceRoot: FoundryUuidDocument,
  translatedRoot: FoundryUuidDocument | FoundryJournalDocument,
  sourceReferenceUuid?: string,
): Promise<string | null> {
  const translatedUuid = translatedDocumentReferenceUuid(
    resolved,
    sourceRoot,
    translatedRoot,
    sourceReferenceUuid,
  );
  if (!translatedUuid || !translatedRoot.uuid || translatedUuid === translatedRoot.uuid) {
    return translatedUuid;
  }
  const sourceReferenceRoot = sourceReferenceUuid
    ? rootDocumentReferenceUuid(sourceReferenceUuid)
    : null;
  if (resolved.uuid !== sourceRoot.uuid || sourceReferenceRoot === sourceReferenceUuid) {
    return translatedUuid;
  }
  try {
    return await fromUuid(translatedUuid) ? translatedUuid : translatedRoot.uuid;
  } catch (error) {
    logger.warn("Translated embedded UUID validation failed; using its translated root.", {
      translatedUuid,
      error,
    });
    return translatedRoot.uuid;
  }
}

/** Returns the root-document portion of an absolute Foundry UUID. */
export function rootDocumentReferenceUuid(uuid: string): string | null {
  if (!uuid || uuid.startsWith(".")) return null;
  const clean = uuid.split("#", 1)[0] ?? "";
  const parts = clean.split(".");
  if (parts[0] === "Compendium") {
    return parts.length >= 5 ? parts.slice(0, 5).join(".") : null;
  }
  return parts.length >= 2 ? parts.slice(0, 2).join(".") : null;
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

export async function assertItemSourceUnchanged(
  sourceDocument: FoundryItemWorldDocument,
  expectedHash: string,
): Promise<void> {
  const currentSourceHash = await itemSourceHash(sourceDocument.toObject() as ItemData);
  if (currentSourceHash !== expectedHash) {
    throw new Error(
      "Zdrojový Item se během překladu změnil. Překlad nebyl uložen; spusťte jej znovu a hotová pole se načtou z cache.",
    );
  }
}

function itemHtmlFieldPaths(
  sourceDocument: FoundryItemWorldDocument,
  source: ItemData,
): readonly HtmlFieldPath[] {
  return discoverSystemHtmlFieldPaths(
    sourceDocument.system?.constructor?.schema?.fields,
    source.system,
  );
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
  if (isItemDocument(document)) {
    return itemHtmlFieldPaths(document, document.toObject() as ItemData).length;
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
    return this.#run(sourceDocument, {});
  }

  /**
   * Translates only the given page plus one level of referenced documents:
   * the page's direct dependencies are translated, but their own references
   * are not followed further.
   */
  async translatePage(
    sourceDocument: FoundryJournalWorldDocument,
    pageId: string,
  ): Promise<JournalTranslationResult> {
    // Reading one page must not trigger an entire linked guide or campaign.
    // Existing translated targets are still linked by the repair preflight.
    return this.#run(sourceDocument, { rootPageIds: [pageId], dependencyDepthLimit: 0 });
  }

  async #run(
    sourceDocument: FoundryJournalWorldDocument,
    scope: TranslationScope,
  ): Promise<JournalTranslationResult> {
    if (translationInProgress) throw new Error(game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.AlreadyRunning"));
    translationInProgress = true;
    try { return await this.#runExclusive(sourceDocument, scope); }
    finally { translationInProgress = false; }
  }

  async #runExclusive(
    sourceDocument: FoundryJournalWorldDocument,
    scope: TranslationScope,
  ): Promise<JournalTranslationResult> {
    if (!game.user?.isGM) throw new Error("Deník může překládat pouze Game Master.");

    const settings = getTranslatorSettings();
    const source = sourceDocument.toObject() as JournalData;
    const htmlFieldPaths = systemHtmlFieldPaths(sourceDocument, source);
    let runId: number | undefined;
    const provider = createTranslationProvider(settings, {
      ...(this.#onChromeStatus ? { onChromeStatus: this.#onChromeStatus } : {}),
      onProviderMetrics: (metrics) => {
        if (runId !== undefined) activeTranslations.recordProviderMetrics(runId, metrics);
      },
    });

    // Calling prepare before the first await preserves Chrome's user activation.
    const preparation = provider.prepare?.({
      texts: [translationSample(source, htmlFieldPaths)],
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      format: "text",
    });

    runId = activeTranslations.start(sourceDocument.name, settings.targetLanguage, sourceDocument.uuid);
    const activeRunId = runId;
    try {
      const [glossary] = await Promise.all([
        new GlossaryCompendiumRepository().prepareForTranslation({
          shouldCancel: () => activeTranslations.isCancelRequested(activeRunId),
          onProgress: ({ completed, total }) => activeTranslations.update(activeRunId, {
            state: "glossary", glossaryCompleted: completed, glossaryTotal: total,
            currentDocument: game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.Status.Syncing"),
          }),
        }),
        preparation ?? Promise.resolve(),
      ]);
      await checkpointControl(activeRunId);
      if (glossary.some(entry => entry.enabled !== false && entry.mode === "inflect")
        && (settings.targetLanguage !== "cs" || !provider.supportsGlossaryInflection)) {
        ui.notifications.warn(game.i18n.localize("FOUNDRY_TRANSLATE.Glossary.InflectionFallback"));
      }
      activeTranslations.update(activeRunId, { state: "scanning", currentDocument: "" });
      const runtime: TranslationRuntime = {
        runId, rootUuid: sourceDocument.uuid,
        glossaryHash: await glossaryFingerprint(glossary),
        providerHash: await providerFingerprint(settings.provider, provider, settings.sourceLanguage),
        settings, provider, glossary,
        cache: new CompendiumTranslationCache(),
        translations: new CompendiumJournalTranslationRepository(),
        actorTranslations: new CompendiumActorTranslationRepository(),
        itemTranslations: new CompendiumItemTranslationRepository(),
      };
      const result = await this.#translateGraph(sourceDocument, runtime, runId, scope);
      activeTranslations.finish(runId);
      return result;
    } catch (error) {
      if (error instanceof GlossarySyncCancelledError) error = new TranslationCancelledError();
      if (error instanceof TranslationCancelledError) {
        activeTranslations.finishCancelled(runId);
      } else {
        activeTranslations.finish(runId, error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  }

  async #translateGraph(
    sourceDocument: FoundryJournalWorldDocument,
    runtime: TranslationRuntime,
    runId: number,
    scope: TranslationScope,
  ): Promise<JournalTranslationResult> {
    const depthLimit = scope.dependencyDepthLimit ?? Number.POSITIVE_INFINITY;
    const depths = new Map<string, number>([[sourceDocument.uuid, 0]]);
    const nodes = new Map<string, JournalGraphNode>();
    const warnings: JournalDependencyWarning[] = [];
    const warningKeys = new Set<string>();
    const addWarning = (warning: JournalDependencyWarning): void => {
      const key = `${warning.kind}\u0000${warning.parentUuid}\u0000${warning.sourceUuid}`;
      if (warningKeys.has(key)) return;
      warningKeys.add(key);
      warnings.push(warning);
      logger.warn("Journal dependency could not be translated recursively.", warning);
      activeTranslations.addIssue(runId, {
        type: warning.kind,
        sourceUuid: warning.sourceUuid,
        parentUuid: warning.parentUuid,
        ...(warning.documentType ? { documentType: warning.documentType } : {}),
        ...(warning.detail ? { detail: warning.detail } : {}),
      });
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
        const depth = depths.get(document.uuid) ?? 0;
        if (depth >= depthLimit) {
          node.children = [];
          return node.children;
        }
        const source = document.toObject() as GraphData;
        const childDocuments = new Map<string, GraphSourceDocument>();
        let references = isJournalDocument(document)
          ? discoverJournalDependencies(source as JournalData)
          : discoverObjectDependencies(source);
        if (document.uuid === sourceDocument.uuid && scope.rootPageIds) {
          const selectedIndexes = new Set(
            (source as JournalData).pages
              .map((page, index) => ({ id: page._id, index }))
              .filter(({ id }) => id && scope.rootPageIds?.includes(id))
              .map(({ index }) => index),
          );
          references = references.filter(({ fieldPath }) =>
            fieldPath[0] === "pages" && selectedIndexes.has(fieldPath[1] as number));
        }
        for (const reference of references) {
          await checkpointControl(runId);
          // Relative references (`.pageId`, `.pageId#anchor`) inside a page are
          // written relative to that page, so the page must be the anchor;
          // the whole entry only works for explicit two-part relative UUIDs.
          const anchors: FoundryUuidDocument[] = [];
          if (
            reference.sourceUuid.startsWith(".") &&
            isJournalDocument(document) &&
            reference.fieldPath[0] === "pages"
          ) {
            const page = (document as FoundryJournalWorldDocument & {
              pages?: { contents?: FoundryUuidDocument[] };
            }).pages?.contents?.[reference.fieldPath[1] as number];
            if (page) anchors.push(page);
          }
          anchors.push(document);

          let resolved: FoundryUuidDocument | null = null;
          for (const anchor of anchors) {
            try {
              resolved = await fromUuid(reference.sourceUuid, { relative: anchor });
            } catch (error) {
              logger.warn("Foundry UUID resolution failed.", { reference, error });
            }
            if (resolved) break;
          }
          // Some v14 content packs contain valid root documents but Foundry
          // cannot resolve their embedded page/item UUID directly. Resolve
          // the root as a fallback so its translated counterpart can still be
          // linked with the original embedded suffix.
          if (!resolved) {
            const rootUuid = rootDocumentReferenceUuid(reference.sourceUuid);
            if (rootUuid && rootUuid !== reference.sourceUuid) {
              try {
                resolved = await fromUuid(rootUuid);
              } catch (error) {
                logger.warn("Foundry root UUID fallback resolution failed.", {
                  reference,
                  rootUuid,
                  error,
                });
              }
            }
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
              ...(root.documentName ? { documentType: root.documentName } : {}),
            });
            continue;
          }
          if (isTranslatedDocument(root)) continue;
          node.dependencies.push({ reference, resolved, root });
          childDocuments.set(root.uuid, root);
          nodeFor(root);
          depths.set(root.uuid, Math.min(depths.get(root.uuid) ?? Number.POSITIVE_INFINITY, depth + 1));
        }
        node.children = [...childDocuments.values()];
        return node.children;
    };

    // Write-free scan of the whole graph so the total size is known upfront.
    const scan = await traverseDependencyGraph({
      root: sourceDocument as GraphSourceDocument,
      key: (document) => document.uuid,
      dependencies: resolveNodeDependencies,
      shouldAbort: error => error instanceof TranslationCancelledError,
      process: async (document) => {
        await checkpointControl(runId);
        nodeFor(document).units = document.uuid === sourceDocument.uuid && scope.rootPageIds
          ? scope.rootPageIds.length
          : documentTranslationUnits(document);
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

    const existingAtStart = await this.#findExistingTranslations(
      scan.completed,
      runtime,
      runId,
    );

    const overall = { completedUnits: 0, completedDocuments: 0 };
    const emitProgress = (progress: JournalTranslationProgress): void => {
      // A cancel stops right after the unit that just finished; its result is
      // already committed to the cache, so a later run resumes from here.
      throwIfCancelled(runId);
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
        await checkpointControl(runId);
        const node = nodeFor(document);
        const existingDependency = scope.rootPageIds && document.uuid !== sourceDocument.uuid
          ? existingAtStart.get(document.uuid)
          : undefined;
        if (existingDependency) {
          const flag = isJournalDocument(document)
            ? readJournalTranslationFlag(existingDependency.flags)
            : isActorDocument(document)
              ? readActorTranslationFlag(existingDependency.flags)
              : readItemTranslationFlag(existingDependency.flags);
          node.result = {
            data: existingDependency.toObject() as GraphData,
            document: existingDependency,
            reused: true,
            fallbackTextSegments: flag?.fallbackTextSegments ?? 0,
          };
        } else {
          node.result = await this.#translateOne(
            document,
            runtime,
            emitProgress,
            document.uuid === sourceDocument.uuid ? scope.rootPageIds : undefined,
          );
        }
        overall.completedUnits += node.units ?? 0;
        overall.completedDocuments += 1;
        activeTranslations.update(runId, {
          completedUnits: overall.completedUnits,
          completedDocuments: overall.completedDocuments,
        });
        await checkpointControl(runId);
      },
      shouldAbort: error => error instanceof TranslationCancelledError || error instanceof TranslationConflictError,
      onCycle: (from, to) => {
        logger.info("Journal dependency cycle detected and safely deferred.", {
          from: from.uuid,
          to: to.uuid,
        });
      },
    });

    for (const failure of graph.failures) {
      const detail = failure.error instanceof Error
        ? failure.error.message
        : String(failure.error);
      addWarning({
        kind: "failed",
        sourceUuid: failure.node.uuid,
        parentUuid: sourceDocument.uuid,
        message: `Závislý dokument ${failure.node.name} se nepodařilo přeložit; jeho odkazy zůstaly v originále.`,
        detail,
      });
    }

    for (const document of graph.completed) {
      await checkpointControl(runId);
      const node = nodes.get(document.uuid);
      if (!node?.result) continue;
      const savedFlag = readJournalTranslationFlag(node.result.data.flags) ?? readActorTranslationFlag(node.result.data.flags) ?? readItemTranslationFlag(node.result.data.flags);
      if (!savedFlag?.outputHash || await hasManualOutputEdits(node.result.data, savedFlag.outputHash)) continue;
      // Compare against the snapshot produced by the service, not a live mutable document.
      const guard = await captureTranslationWriteGuard({ id: node.result.document.id, toObject: () => node.result!.data });
      const replacements: DocumentReferenceReplacement[] = [];
      if (scope.dependencyDepthLimit === 0) {
        replacements.push(...await availableDocumentReferences(node.result.data, runtime.settings.targetLanguage));
      }
      for (const dependency of node.dependencies) {
        const translatedDependency = nodes.get(dependency.root.uuid)?.result?.document;
        if (!translatedDependency) continue;
        const translatedUuid = await usableTranslatedDocumentReferenceUuid(
          dependency.resolved,
          dependency.root,
          translatedDependency,
          dependency.reference.sourceUuid,
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
        await stampJournalOutputHash(journalData);
        node.result.data = journalData;
        node.result.document = await runtime.translations.save(journalData, guard);
      } else if (isActorDocument(document)) {
        const actorData = rewritten as ActorData;
        const flag = readActorTranslationFlag(actorData.flags);
        if (flag) await assertActorSourceUnchanged(document, flag.sourceHash);
        await stampActorOutputHash(actorData);
        node.result.data = actorData;
        node.result.document = await runtime.actorTranslations.save(actorData, guard);
      } else {
        const itemData = rewritten as ItemData;
        const flag = readItemTranslationFlag(itemData.flags);
        if (flag) await assertItemSourceUnchanged(document, flag.sourceHash);
        await stampItemOutputHash(itemData);
        node.result.data = itemData;
        node.result.document = await runtime.itemTranslations.save(itemData, guard);
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

  async #findExistingTranslations(
    documents: readonly GraphSourceDocument[],
    runtime: TranslationRuntime,
    runId: number,
  ): Promise<Map<string, GraphTranslatedDocument>> {
    activeTranslations.update(runId, {
      currentDocument: game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.CheckingExisting"),
      currentUnit: "",
    });
    const existingEntries = await Promise.all(documents.map(async (document) => {
      const sourceUuid = document.uuid;
      let translated: GraphTranslatedDocument | null;
      if (isJournalDocument(document)) {
        translated = await runtime.translations.find(
          sourceUuid,
          runtime.settings.targetLanguage,
        );
      } else if (isActorDocument(document)) {
        translated = await runtime.actorTranslations.find(
          sourceUuid,
          runtime.settings.targetLanguage,
        );
      } else {
        translated = await runtime.itemTranslations.find(
          sourceUuid,
          runtime.settings.targetLanguage,
        );
      }
      if (translated && containsTranslationPromptLeak(translated.toObject())) {
        logger.warn("Existing translation contains leaked provider instructions; automatic reuse is blocked.", {
          sourceUuid,
          translatedUuid: translated.uuid,
        });
        translated = null;
      }
      return [sourceUuid, translated] as const;
    }));
    const existingBySource = new Map(
      existingEntries.filter(
        (entry): entry is readonly [string, GraphTranslatedDocument] => Boolean(entry[1]),
      ),
    );
    return existingBySource;
  }

  async #checkExisting(
    data: GraphData | undefined,
    flag: { sourceHash: string; engineRevision: number; glossaryFingerprint?: string; providerFingerprint?: string; outputHash?: string } | null,
    sourceHash: string,
    revision: number,
    runtime: TranslationRuntime,
  ): Promise<boolean> {
    if (!data || !flag) return false;
    if (flag.sourceHash !== sourceHash || flag.engineRevision !== revision ||
        flag.glossaryFingerprint !== runtime.glossaryHash || flag.providerFingerprint !== runtime.providerHash) {
      throw new TranslationConflictError(game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.IncompatibleExisting"));
    }
    if (containsTranslationPromptLeak(data)) {
      throw new TranslationConflictError(game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.UnsafeExisting"));
    }
    const edited = !flag.outputHash || await hasManualOutputEdits(data, flag.outputHash);
    if (edited) activeTranslations.addIssue(runtime.runId, {
      type: "protected", documentName: data.name,
      detail: game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.ManualEditsProtected"),
    });
    return edited;
  }

  async #translateOne(
    sourceDocument: GraphSourceDocument,
    runtime: TranslationRuntime,
    onProgress: (progress: JournalTranslationProgress) => void,
    pageIds?: readonly string[],
  ): Promise<GraphTranslationResult> {
    activeTranslations.update(runtime.runId, {
      currentDocument: sourceDocument.name,
      currentUnit: "",
    });
    if (isActorDocument(sourceDocument)) {
      return this.#translateActorOne(sourceDocument, runtime, onProgress);
    }
    if (isItemDocument(sourceDocument)) {
      return this.#translateItemOne(sourceDocument, runtime, onProgress);
    }
    return this.#translateJournalOne(sourceDocument, runtime, onProgress, pageIds);
  }

  async #translateJournalOne(
    sourceDocument: FoundryJournalWorldDocument,
    runtime: TranslationRuntime,
    onProgress: (progress: JournalTranslationProgress) => void,
    pageIds?: readonly string[],
  ): Promise<JournalTranslationResult> {
    const source = sourceDocument.toObject() as JournalData;
    const sourceHash = await journalSourceHash(source);
    const existing = await runtime.translations.find(
      sourceDocument.uuid,
      runtime.settings.targetLanguage,
    );
    const existingFlag = existing ? readJournalTranslationFlag(existing.flags) : null;
    const existingData = existing?.toObject() as JournalData | undefined;
    if (existing?.uuid && sourceDocument.uuid === runtime.rootUuid) {
      activeTranslations.update(runtime.runId, { translatedDocumentUuid: existing.uuid });
    }
    let guard = await captureTranslationWriteGuard(existing);
    const manuallyEdited = await this.#checkExisting(existingData, existingFlag, sourceHash, TRANSLATION_ENGINE_REVISION, runtime);
    const reusable = existing && existingFlag && (pageIds
      ? pageIds.every((pageId) =>
          canReuseJournalPageTranslation(existingFlag, sourceHash, pageId, runtime.glossaryHash, runtime.providerHash))
      : canReuseJournalTranslation(existingFlag, sourceHash, runtime.glossaryHash, runtime.providerHash));
    if (existing && existingFlag && reusable) {
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
    if (manuallyEdited) throw new TranslationConflictError(game.i18n.localize("FOUNDRY_TRANSLATE.JournalTranslation.Status.EditedPartial"));
    const requestedPageIds = pageIds ?? source.pages.map(page => page._id).filter((id): id is string => Boolean(id));
    const remainingPageIds = existingFlag
      ? requestedPageIds.filter(id => !canReuseJournalPageTranslation(existingFlag, sourceHash, id, runtime.glossaryHash, runtime.providerHash))
      : pageIds;
    const resumedPages = remainingPageIds ? requestedPageIds.length - remainingPageIds.length : 0;
    const saveTranslatedData = async (
      data: JournalData,
      mergeInitialPartial: boolean,
    ): Promise<{ data: JournalData; document: FoundryJournalDocument }> => {
      await assertJournalSourceUnchanged(sourceDocument, sourceHash);
      const savedData = mergeInitialPartial && existingData && existingFlag
        ? mergePartialJournalTranslation(existingData, data)
        : data;
      await stampJournalOutputHash(savedData);
      const document = await runtime.translations.save(savedData, guard);
      guard = await captureTranslationWriteGuard(document);
      if (sourceDocument.uuid === runtime.rootUuid && document.uuid) {
        activeTranslations.update(runtime.runId, {
          translatedDocumentUuid: document.uuid,
        });
      }
      return { data: document.toObject() as JournalData, document };
    };

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
      systemTextFieldPaths: systemTextFieldPaths(sourceDocument, source),
      ...(remainingPageIds ? { pageIds: remainingPageIds } : {}),
      beforeBatch: () => checkpointControl(runtime.runId),
      onPageStart: (pageName) => activeTranslations.update(runtime.runId, {
        currentDocument: sourceDocument.name,
        currentUnit: pageName,
      }),
      onQualityFallback: (fallback) => {
        logger.warn("Translation quality fallback requires review.", fallback);
        activeTranslations.addIssue(runtime.runId, {
          type: "fallback",
          documentName: sourceDocument.name,
          reason: fallback.reason,
          detail: fallback.detail,
          sourcePreview: fallback.sourcePreview,
          attempts: fallback.attempts,
          occurrences: fallback.occurrences,
        });
      },
      onCheckpoint: async (checkpoint) => {
        await saveTranslatedData(checkpoint.data, true);
      },
      onProgress: (progress: JournalTranslationProgress) => onProgress({
        ...progress,
        completedPages: progress.completedPages + resumedPages,
        totalPages: requestedPageIds.length,
        documentName: sourceDocument.name,
      }),
    });
    if (existingData && existingFlag) {
      translated.data = mergePartialJournalTranslation(
        existingData,
        translated.data,
      );
    }
    const saved = await saveTranslatedData(translated.data, false);
    translated.data = saved.data;
    const savedFlag = readJournalTranslationFlag(saved.data.flags)!;
    translated.translatedTextPages = savedFlag.translatedTextPages;
    translated.skippedTextPages = savedFlag.skippedTextPages;
    translated.fallbackTextSegments = savedFlag.fallbackTextSegments;
    return {
      ...translated,
      document: saved.document,
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
    const existingData = existing?.toObject() as ActorData | undefined;
    const guard = await captureTranslationWriteGuard(existing);
    await this.#checkExisting(existingData, existingFlag, sourceHash, ACTOR_TRANSLATION_ENGINE_REVISION, runtime);
    if (existing && existingFlag &&
      canReuseActorTranslation(existingFlag, sourceHash, runtime.glossaryHash, runtime.providerHash)) {
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
      beforeBatch: () => checkpointControl(runtime.runId),
      onQualityFallback: (fallback) => {
        logger.warn("Actor translation quality fallback kept the original fragment.", fallback);
        activeTranslations.addIssue(runtime.runId, {
          type: "fallback",
          documentName: sourceDocument.name,
          reason: fallback.reason,
          detail: fallback.detail,
          sourcePreview: fallback.sourcePreview,
          attempts: fallback.attempts,
          occurrences: fallback.occurrences,
        });
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
    await stampActorOutputHash(translated.data);
    const document = await runtime.actorTranslations.save(translated.data, guard);
    return { ...translated, data: document.toObject() as GraphData, document, reused: false };
  }

  async #translateItemOne(
    sourceDocument: FoundryItemWorldDocument,
    runtime: TranslationRuntime,
    onProgress: (progress: JournalTranslationProgress) => void,
  ): Promise<GraphTranslationResult> {
    const source = sourceDocument.toObject() as ItemData;
    const sourceHash = await itemSourceHash(source);
    const existing = await runtime.itemTranslations.find(
      sourceDocument.uuid,
      runtime.settings.targetLanguage,
    );
    const existingFlag = existing ? readItemTranslationFlag(existing.flags) : null;
    const existingData = existing?.toObject() as ItemData | undefined;
    const guard = await captureTranslationWriteGuard(existing);
    await this.#checkExisting(existingData, existingFlag, sourceHash, ITEM_TRANSLATION_ENGINE_REVISION, runtime);
    if (existing && existingFlag &&
      canReuseItemTranslation(existingFlag, sourceHash, runtime.glossaryHash, runtime.providerHash)) {
      return {
        data: existing.toObject() as ItemData,
        document: existing,
        reused: true,
        fallbackTextSegments: existingFlag.fallbackTextSegments,
      };
    }
    const translated = await translateItemData({
      source,
      sourceUuid: sourceDocument.uuid,
      glossary: runtime.glossary,
      provider: runtime.provider,
      settings: {
        providerId: runtime.settings.provider,
        sourceLanguage: runtime.settings.sourceLanguage,
        targetLanguage: runtime.settings.targetLanguage,
      },
      systemHtmlFieldPaths: itemHtmlFieldPaths(sourceDocument, source),
      cache: runtime.cache,
      beforeBatch: () => checkpointControl(runtime.runId),
      onQualityFallback: (fallback) => {
        logger.warn("Item translation quality fallback kept the original fragment.", fallback);
        activeTranslations.addIssue(runtime.runId, {
          type: "fallback",
          documentName: sourceDocument.name,
          reason: fallback.reason,
          detail: fallback.detail,
          sourcePreview: fallback.sourcePreview,
          attempts: fallback.attempts,
          occurrences: fallback.occurrences,
        });
      },
      onProgress: (progress) => onProgress({
        kind: "item-field",
        completedPages: progress.completedFields,
        totalPages: progress.totalFields,
        pageIndex: progress.completedFields - 1,
        pageName: progress.fieldPath.join("."),
        translatedText: true,
        skippedText: false,
        documentName: sourceDocument.name,
      }),
    });
    await assertItemSourceUnchanged(sourceDocument, sourceHash);
    await stampItemOutputHash(translated.data);
    const document = await runtime.itemTranslations.save(translated.data, guard);
    return { ...translated, data: document.toObject() as GraphData, document, reused: false };
  }
}
