import { assertPortableText } from "../bundles/format";
import { proseNumbers } from "../polish/quality-guards";
import { readItemTranslationFlag } from "./item";
import { translatedOutputHash } from "./output-hash";
import { discoverCrucibleActionConditionFieldPaths, discoverCrucibleActionNameFieldPaths, type HtmlFieldPath } from "./system-html-fields";

export type AffixActionTextProperty = "name" | "description" | "condition";
export interface AffixActionDisplayField { path: string[]; format: "text" | "html"; source: string }
type Data = Record<string, unknown>;
type AffixModelConstructor = { name?: string; schema?: { fields?: Record<string, unknown> } };
export interface AffixSchemaRuntime { system?: { constructor?: AffixModelConstructor } }
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const record = (value: unknown): value is Data => !!value && typeof value === "object" && !Array.isArray(value);

/** The allowlist comes from the installed Crucible model, never a translation record. */
function schema(runtime?: AffixSchemaRuntime): Record<string, unknown> | undefined {
  if (typeof game === "undefined" || game.system?.id !== "crucible" || typeof CONFIG === "undefined") return;
  const model = (CONFIG as unknown as { ActiveEffect?: { dataModels?: { affix?: AffixModelConstructor } } }).ActiveEffect?.dataModels?.affix;
  if (model?.name !== "CrucibleAffixActiveEffect" || (runtime && runtime.system?.constructor !== model)) return;
  return model.schema?.fields;
}

function actions(source: Data, runtime?: AffixSchemaRuntime): Data[] | null {
  if (source.type !== "affix" || !record(source.system)) return null;
  const fields = schema(runtime), paths = discoverCrucibleActionNameFieldPaths(fields, source.system);
  const data = source.system.actions;
  if (!Array.isArray(data) || !data.length || !paths.length || paths.length !== data.length
    || data.some(action => !record(action) || typeof action.id !== "string" || forbidden.has(action.id)
      || typeof action.name !== "string" || typeof action.description !== "string")) return null;
  return data as Data[];
}

/** Canonical paths address stored Affix Actions by ID; preparation/reordering is irrelevant. */
export function affixActionDisplayFields(source: Data, runtime?: AffixSchemaRuntime): AffixActionDisplayField[] {
  const stored = actions(source, runtime);
  if (!stored) return [];
  const conditionIndexes = new Set(discoverCrucibleActionConditionFieldPaths(schema(runtime), source.system).map(path => path[1]));
  return stored.flatMap((action, index) => (["name", "description", "condition"] as const).flatMap(property => {
    const value = action[property];
    if (typeof value !== "string" || !value.trim() || (property === "condition" && !conditionIndexes.has(index))) return [];
    return [{ path: ["system", "actions", action.id as string, property], format: property === "description" ? "html" as const : "text" as const, source: value }];
  }));
}

/** Shape validation only. A source-derived field allowlist is also required at import/save. */
export function isAffixActionDisplayPath(path: readonly (string | number)[], format?: string): boolean {
  return path.length === 4 && path[0] === "system" && path[1] === "actions"
    && typeof path[2] === "string" && !!path[2].trim() && !forbidden.has(path[2])
    && ["name", "description", "condition"].includes(String(path[3]))
    && (format === undefined || format === (path[3] === "description" ? "html" : "text"));
}

/** Resolve a canonical Action-ID path only after strict schema/unique-ID validation. */
export function affixActionIndexPath(source: Data, path: readonly string[], runtime?: AffixSchemaRuntime): HtmlFieldPath | null {
  if (!isAffixActionDisplayPath(path)) return null;
  const stored = actions(source, runtime);
  const index = stored?.findIndex(action => action.id === path[2]) ?? -1;
  if (index < 0 || !affixActionDisplayFields(source, runtime).some(field => JSON.stringify(field.path) === JSON.stringify(path))) return null;
  return ["system", "actions", index, path[3]!];
}

export function canonicalAffixActionDisplayPath(source: Data, path: HtmlFieldPath, runtime?: AffixSchemaRuntime): string[] | null {
  const stored = actions(source, runtime);
  if (path.length !== 4 || path[0] !== "system" || path[1] !== "actions" || typeof path[2] !== "number"
    || !Number.isInteger(path[2]) || path[2] < 0 || !stored?.[path[2]]) return null;
  const canonical = ["system", "actions", stored[path[2]]!.id as string, String(path[3])];
  return affixActionIndexPath(source, canonical, runtime) ? canonical : null;
}

export function readAffixActionDisplayField(source: Data, path: readonly string[], runtime?: AffixSchemaRuntime): string | null {
  const resolved = affixActionIndexPath(source, path, runtime);
  if (!resolved) return null;
  const value = (source.system as Data).actions as Data[];
  return value[resolved[2] as number]![String(resolved[3])] as string;
}

/** Include all Affix data, IDs, flags and nested mechanics; omit only volatile _stats.
 * Wrapping prevents the generic output hash from dropping root flags/ownership. */
export function affixActionSourceHash(source: Data): Promise<string> {
  return translatedOutputHash({ affix: source });
}

export interface NativeAffixDocument extends FoundryUuidDocument, AffixSchemaRuntime {
  type: string;
  toObject(): Data;
  testUserPermission?(user: unknown, level: string): boolean;
}
export interface NativeAffixAction {
  id: string; name: string; description?: string; condition?: string;
  parent?: unknown; item?: NativeAffixItem; affix?: NativeAffixDocument;
  toObject?(source: boolean): Data;
}
export interface NativeAffixItem extends FoundryUuidDocument {
  actions?: readonly NativeAffixAction[];
  effects?: { contents: readonly NativeAffixDocument[] };
  toObject(): Data;
  testUserPermission?(user: unknown, level: string): boolean;
}
export interface AffixActionDisplay {
  source: NativeAffixDocument;
  sourceHash: string;
  name?: string;
  description?: string;
  condition?: string;
  /** Call after any asynchronous native enrichment before publishing HTML. */
  current(): boolean;
}
export type AffixActionTextLookup = (source: NativeAffixDocument, path: readonly string[], sourceHash: string) => string | null;

/** Resolve presentation text only. The caller must keep/enrich the original Action.
 * No translated Item, Affix, Action model or mechanical configuration is returned. */
export async function resolveAffixActionDisplay(item: NativeAffixItem, action: NativeAffixAction,
  lookup: AffixActionTextLookup): Promise<AffixActionDisplay | null> {
  try {
    const user = game.user, affix = action.affix;
    if (!user || !affix || item.documentName !== "Item" || readItemTranslationFlag(item.flags)
      || affix.documentName !== "ActiveEffect" || affix.type !== "affix" || affix.parent !== item
      || !affix.id || affix.uuid !== `${item.uuid}.ActiveEffect.${affix.id}`
      || action.item !== item || action.parent !== affix.system || typeof action.toObject !== "function"
      || item.testUserPermission?.(user, "OBSERVER") !== true || affix.testUserPermission?.(user, "OBSERVER") !== true
      || item.effects?.contents.filter(effect => effect.id === affix.id).length !== 1
      || !item.effects.contents.includes(affix) || item.actions?.filter(candidate => candidate.id === action.id).length !== 1
      || !item.actions.includes(action)) return null;
    const data = affix.toObject(), itemData = item.toObject();
    if (data._id !== affix.id || data.type !== "affix" || !record(itemData.system)) return null;
    const ownActions = itemData.system.actions;
    if (!Array.isArray(ownActions) || ownActions.some(candidate => !record(candidate) || candidate.id === action.id)) return null;
    const embedded = itemData.effects;
    if (!Array.isArray(embedded) || embedded.filter(candidate => record(candidate) && candidate._id === affix.id).length !== 1
      || JSON.stringify(embedded.find(candidate => record(candidate) && candidate._id === affix.id)) !== JSON.stringify(data)) return null;
    const fields = affixActionDisplayFields(data, affix).filter(field => field.path[2] === action.id);
    if (!fields.some(field => field.path[3] === "name") || fields.some(field => action[field.path[3] as AffixActionTextProperty] !== field.source)) return null;
    const affixProof = JSON.stringify(data), itemProof = JSON.stringify(itemData), actionProof = JSON.stringify(action.toObject(false));
    const sourceHash = await affixActionSourceHash(data);
    const itemUuid = item.uuid, affixUuid = affix.uuid, results = new Map<string, string | null>();
    const current = () => { try { return game.user === user && game.system?.id === "crucible" && item.uuid === itemUuid && affix.uuid === affixUuid
      && affix.type === "affix" && affix.documentName === "ActiveEffect" && item.documentName === "Item"
      && !!actions(affix.toObject(), affix) && item.testUserPermission?.(user, "OBSERVER") === true
      && affix.testUserPermission?.(user, "OBSERVER") === true && affix.parent === item && action.item === item
      && action.parent === affix.system && item.effects?.contents.filter(effect => effect.id === affix.id).length === 1
      && item.effects.contents.includes(affix) && item.actions?.filter(candidate => candidate.id === action.id).length === 1
      && item.actions.includes(action) && JSON.stringify(affix.toObject()) === affixProof
      && JSON.stringify(item.toObject()) === itemProof && JSON.stringify(action.toObject?.(false)) === actionProof
      && fields.every(field => !results.has(JSON.stringify(field.path))
        || lookup(affix, field.path, sourceHash) === results.get(JSON.stringify(field.path))); } catch { return false; } };
    const output: AffixActionDisplay = { source: affix, sourceHash, current };
    for (const field of fields) {
      const value = lookup(affix, field.path, sourceHash);
      results.set(JSON.stringify(field.path), value);
      if (!value?.trim()) continue;
      assertPortableText(field.source, value, field.format);
      if (JSON.stringify(proseNumbers([field.source])) !== JSON.stringify(proseNumbers([value]))) return null;
      output[field.path[3] as AffixActionTextProperty] = value;
    }
    return current() && (output.name || output.description || output.condition) ? output : null;
  } catch { return null; }
}
