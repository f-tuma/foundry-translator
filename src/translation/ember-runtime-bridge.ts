import { MODULE_ID } from "../constants";
import { logger } from "../logger";
import { sourceReferenceUuid } from "./document-identity";

type Method = (this: any, ...args: any[]) => any;
interface RuntimeEvent { id: string; page?: string; [key: string]: unknown }
interface EmberModel {
  parent: EmberPage;
  eventId?: string;
  questId?: string;
  event?: RuntimeEvent;
  _source: Record<string, unknown>;
}
interface EmberPage extends FoundryUuidDocument {
  type: string;
  parent: FoundryUuidDocument;
  system: EmberModel;
}
interface EmberRuntime {
  narrative: { events: Record<string, RuntimeEvent>; quests: Record<string, RuntimeEvent> };
  api: { applications: { EmberEventPageSheet: { prototype: Record<string, Method> } } };
}
interface BridgeEnvironment {
  resolve(uuid: string): EmberPage | null;
  runtime(): EmberRuntime | undefined;
}
const environment: BridgeEnvironment = {
  resolve: uuid => (globalThis as any).fromUuidSync(uuid) as EmberPage | null,
  runtime: () => (globalThis as any).ember as EmberRuntime | undefined,
};

export function isTranslatedEmberPage(page: EmberPage): boolean {
  return !!page.parent?.flags?.[MODULE_ID] && "translation" in page.parent.flags[MODULE_ID]!;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** The adapter supports Ember's reviewed event schema, never guessed name matching. */
export function eventMechanics(source: Record<string, unknown>): string {
  const { overview: _overview, exposition: _exposition, summary: _summary, development: _development,
    outcomes, ...mechanics } = source;
  return stable({ ...mechanics, outcomes: Array.isArray(outcomes) ? outcomes.map(outcome => {
    const { label: _label, summary: _text, ...rules } = outcome as Record<string, unknown>;
    return rules;
  }) : outcomes });
}

export interface EmberBinding {
  status: "original" | "bound" | "missing-source" | "mismatch" | "unregistered";
  sourceUuid?: string;
  event?: RuntimeEvent;
}

/** Pure lookup: no initialize/register/update calls and no registry or state writes. */
export function resolveEmberBinding(model: EmberModel, env: BridgeEnvironment = environment): EmberBinding {
  const page = model.parent;
  if (!isTranslatedEmberPage(page)) return { status: "original" };
  const sourceUuid = sourceReferenceUuid(page.uuid, page.parent);
  if (!sourceUuid) return { status: "mismatch" };
  let source: EmberPage | null;
  try { source = env.resolve(sourceUuid); } catch { source = null; }
  if (!source || source.uuid !== sourceUuid) return { status: "missing-source", sourceUuid };
  if (isTranslatedEmberPage(source) || source.type !== page.type || !source.system) return { status: "mismatch", sourceUuid };
  const runtime = env.runtime();
  if (page.type === "ember.quest") {
    const id = source.system.questId;
    const event = id && id === model.questId ? runtime?.narrative.quests[id] : undefined;
    return event && event.page === sourceUuid ? { status: "bound", sourceUuid, event } : { status: "unregistered", sourceUuid };
  }
  if (!["ember.questEvent", "ember.standaloneEvent"].includes(page.type)
    || !model.eventId || model.eventId !== source.system.eventId
    || eventMechanics(model._source) !== eventMechanics(source.system._source)) return { status: "mismatch", sourceUuid };
  const event = runtime?.narrative.events[model.eventId];
  if (!event || event !== source.system.event || event.page !== sourceUuid) return { status: "unregistered", sourceUuid };
  return { status: "bound", sourceUuid, event };
}

const boundModels = new WeakSet<object>();
export function bindTranslatedEmberModel(model: EmberModel, env: BridgeEnvironment = environment): EmberBinding {
  if (isTranslatedEmberPage(model.parent) && !boundModels.has(model)) {
    // A live getter prevents stale state when Ember reinitializes the source event.
    // There is deliberately no second event object and no copied game state.
    Object.defineProperty(model, "event", { configurable: true, enumerable: false,
      get: () => resolveEmberBinding(model, env).event,
      set: () => { /* A translated view never replaces the authoritative event. */ },
    });
    boundModels.add(model);
  }
  return resolveEmberBinding(model, env);
}

const guardedMethods = new WeakMap<object, Set<string>>();
export function guardEmberInitializer(prototype: Record<string, Method>, name: string, env: BridgeEnvironment = environment): void {
  const original = prototype[name];
  if (typeof original !== "function") return;
  const guarded = guardedMethods.get(prototype) ?? new Set<string>();
  if (guarded.has(name)) return;
  guarded.add(name);
  guardedMethods.set(prototype, guarded);
  prototype[name] = function(this: EmberModel, ...args: unknown[]) {
    if (!isTranslatedEmberPage(this.parent)) return original.apply(this, args);
    // Prevent copied/imported pages from re-registering an event, replacing its
    // source page, deleting outcomes or changing quest labels on form submission.
    const binding = bindTranslatedEmberModel(this, env);
    // Ember's world initializer dereferences initializeQuest().id after its
    // try/catch. Throw inside that boundary so an imported invalid copy is
    // skipped rather than interrupting initialization of the original quests.
    if (name === "initializeQuest" && !binding.event) throw new Error("Foundry Translate: translated quest has no valid original runtime binding.");
    return binding.event;
  };
}

const installedSheets = new WeakSet<object>();
const observedElements = new WeakSet<HTMLElement>();
const GAME_ACTIONS = "button,input,select,textarea,a,[data-action]";
const localize = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.EmberBridge.${key}`);

/** Localize rendered choice labels only; the canonical event/outcome objects stay untouched. */
export function translateOutcomeLabels(root: HTMLElement, outcomes: unknown): void {
  if (!Array.isArray(outcomes)) return;
  for (const input of root.querySelectorAll<HTMLInputElement>("input.event-outcome-checkbox")) {
    const matches = outcomes.filter(outcome => outcome?.id === input.value);
    if (matches.length !== 1 || typeof matches[0].label !== "string") continue;
    const label = input.closest("label");
    if (!label) continue;
    const texts = [...label.childNodes].filter(node => node.nodeType === 3);
    // Ember's template has leading indentation before the checkbox. Preserve
    // the visible label's position after the control, not that whitespace slot.
    const text = texts.find(node => node.textContent?.trim()) ?? root.ownerDocument.createTextNode("");
    text.textContent = ` ${matches[0].label}.`;
    for (const extra of texts) if (extra !== text) extra.remove();
    if (!text.parentNode) label.append(text);
  }
}

/** Render-only integration, with a fresh validity check before every game action. */
export function decorateEmberTranslation(sheet: { document: EmberPage; element: HTMLElement }): void {
  const model = sheet.document.system;
  if (!isTranslatedEmberPage(sheet.document)) return;
  const binding = bindTranslatedEmberModel(model);
  const root = sheet.element;
  if (!(root instanceof HTMLElement)) return;
  if (binding.status === "bound") translateOutcomeLabels(root, model._source.outcomes);
  root.querySelector(".ft-ember-bridge")?.remove();
  const note = document.createElement("aside");
  note.className = "ft-ember-bridge notification";
  note.classList.add(binding.status === "bound" ? "info" : "warning");
  note.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = localize(binding.status === "bound" ? "Connected" : "Unavailable");
  if (binding.status === "bound") text.setAttribute("title", localize("Explanation"));
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = localize("OpenSource");
  button.disabled = !binding.sourceUuid;
  button.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation();
    const current = resolveEmberBinding(model);
    if (!current.sourceUuid) return;
    const source = environment.resolve(current.sourceUuid);
    (source?.parent as any)?.sheet?.render({ force: true, pageId: source?.id });
  });
  note.append(text, button);
  root.prepend(note);
  if (binding.status !== "bound") {
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLButtonElement>(GAME_ACTIONS)) {
      if (!control.closest(".ft-ember-bridge")) control.disabled = true;
    }
  }
  if (!observedElements.has(root)) {
    observedElements.add(root);
    const guard = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(GAME_ACTIONS)) return;
      if (event.target.closest(".ft-ember-bridge")) return;
      if (resolveEmberBinding(sheet.document.system).status === "bound") return;
      event.preventDefault(); event.stopImmediatePropagation();
      ui.notifications.warn(localize("Unavailable"));
    };
    root.addEventListener("click", guard, true);
    root.addEventListener("change", guard, true);
  }
}

export function registerEmberRuntimeBridge(): void {
  if (!game.modules.get("ember")?.active) return;
  const models = (CONFIG as any).JournalEntryPage?.dataModels;
  const sheetPrototype = environment.runtime()?.api.applications.EmberEventPageSheet?.prototype;
  if (!models || !sheetPrototype || typeof sheetPrototype._prepareContext !== "function") {
    logger.warn("Ember runtime adapter unavailable: expected event model/sheet API was not found.");
    return;
  }
  for (const type of ["ember.standaloneEvent", "ember.questEvent", "ember.quest"]) {
    const prototype = models[type]?.prototype;
    if (!prototype) continue;
    for (const name of ["initializeEvent", "reinitializeEvent", "initializeQuest"]) guardEmberInitializer(prototype, name);
  }
  if (installedSheets.has(sheetPrototype)) return;
  installedSheets.add(sheetPrototype);
  const prepare = sheetPrototype._prepareContext!;
  sheetPrototype._prepareContext = function(...args: unknown[]) {
    bindTranslatedEmberModel(this.document.system);
    return prepare.apply(this, args);
  };
  const render = sheetPrototype._onRender!;
  sheetPrototype._onRender = async function(...args: unknown[]) {
    await render.apply(this, args);
    decorateEmberTranslation(this);
  };
}
