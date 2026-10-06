export type HtmlFieldPath = readonly (string | number)[];

interface RuntimeDataField {
  constructor?: { name?: string };
  fields?: Record<string, RuntimeDataField>;
  element?: RuntimeDataField;
}

function isRuntimeDataField(value: unknown): value is RuntimeDataField {
  return !!value && typeof value === "object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function discoverFieldPaths(
  field: RuntimeDataField,
  value: unknown,
  path: readonly (string | number)[],
  paths: HtmlFieldPath[],
): void {
  if (field.constructor?.name === "HTMLField") {
    if (typeof value === "string") paths.push(path);
    return;
  }

  if (field.fields && isRecord(value)) {
    for (const [name, child] of Object.entries(field.fields)) {
      discoverFieldPaths(child, value[name], [...path, name], paths);
    }
    return;
  }

  if (field.element && Array.isArray(value)) {
    value.forEach((entry, index) => {
      discoverFieldPaths(field.element as RuntimeDataField, entry, [...path, index], paths);
    });
  }
}

export function discoverSystemHtmlFieldPaths(
  fields: Record<string, unknown> | undefined,
  system: unknown,
): readonly HtmlFieldPath[] {
  if (!fields || !isRecord(system)) return [];
  const paths: HtmlFieldPath[] = [];
  for (const [name, field] of Object.entries(fields)) {
    if (!isRuntimeDataField(field)) continue;
    discoverFieldPaths(field, system[name], [name], paths);
  }
  return paths;
}

/** Establish the reviewed native schema and unambiguous Action identities. */
function nativeCrucibleActionData(
  fields: Record<string, unknown> | undefined,
  system: unknown,
): Record<string, unknown>[] | null {
  if (!fields || !isRecord(system)) return null;
  const actions = fields.actions;
  if (!isRuntimeDataField(actions) || actions.constructor?.name !== "ArrayField"
    || actions.element?.constructor?.name !== "CrucibleActionField"
    || actions.element.fields?.id?.constructor?.name !== "StringField"
    || actions.element.fields?.name?.constructor?.name !== "StringField"
    || actions.element.fields?.description?.constructor?.name !== "HTMLField"
    || !Array.isArray(system.actions)) return null;
  const ids = new Set<string>();
  for (const action of system.actions) {
    if (!isRecord(action) || typeof action.id !== "string" || !action.id.trim()
      || ids.has(action.id)) return null;
    ids.add(action.id);
  }
  return system.actions as Record<string, unknown>[];
}

/** Native Action names use the title pipeline. Adjacent IDs, tags, hooks and
 * effects remain automation data. An ambiguous array exposes no name slots. */
export function discoverCrucibleActionNameFieldPaths(
  fields: Record<string, unknown> | undefined,
  system: unknown,
): readonly HtmlFieldPath[] {
  return nativeCrucibleActionData(fields, system)?.flatMap((action, index) =>
    typeof action.name === "string" ? [["actions", index, "name"] as HtmlFieldPath] : []) ?? [];
}

/** Crucible's StringField condition is a displayed trigger sentence, not a
 * predicate: native templates escape it inside p.condition.activation > em.
 * Never infer this exception from arbitrary data or another field schema. */
export function discoverCrucibleActionConditionFieldPaths(
  fields: Record<string, unknown> | undefined,
  system: unknown,
): readonly HtmlFieldPath[] {
  const actions = nativeCrucibleActionData(fields, system);
  const array = fields?.actions as RuntimeDataField | undefined;
  if (!actions || array?.element?.fields?.condition?.constructor?.name !== "StringField"
    || actions.some(action => action.condition != null && typeof action.condition !== "string")) return [];
  return actions.flatMap((action, index) => typeof action.condition === "string"
    ? [["actions", index, "condition"] as HtmlFieldPath] : []);
}

/** Positional action prose is safe only while the native action ID sequence is
 * identical. Top-level embedded Item/page remapping must happen before this check. */
export function assertSystemActionFieldIdentity(
  source: unknown,
  translated: unknown,
  sourcePath: HtmlFieldPath,
  translatedPath: HtmlFieldPath = sourcePath,
): void {
  const systemIndex = sourcePath.findIndex((part, index) => part === "system"
    && sourcePath[index + 1] === "actions" && typeof sourcePath[index + 2] === "number");
  if (systemIndex < 0) return;
  const index = sourcePath[systemIndex + 2] as number;
  const sourceActions = readPath(source, sourcePath.slice(0, systemIndex + 2));
  const targetActions = readPath(translated, translatedPath.slice(0, systemIndex + 2));
  const fail = (): never => { throw new Error("Native action identity changed; positional action fields cannot be paired safely."); };
  if (translatedPath[systemIndex] !== "system" || translatedPath[systemIndex + 1] !== "actions"
    || translatedPath[systemIndex + 2] !== index || !Number.isInteger(index) || index < 0
    || !Array.isArray(sourceActions) || !Array.isArray(targetActions)
    || sourceActions.length !== targetActions.length || index >= sourceActions.length) fail();
  const ids = (actions: unknown[]): string[] => {
    const seen = new Set<string>();
    return actions.map(action => {
      if (!isRecord(action) || typeof action.id !== "string" || !action.id.trim() || seen.has(action.id)) fail();
      const id = (action as Record<string, unknown>).id as string;
      seen.add(id);
      return id;
    });
  };
  const sourceIds = ids(sourceActions as unknown[]), targetIds = ids(targetActions as unknown[]);
  if (sourceIds.some((id, position) => id !== targetIds[position])) fail();
}

/** Reviewed Ember UI strings which are not HTMLFields. Never scan every string:
 * adjacent fields contain IDs, enums, scene configuration and automation data. */
const EMBER_LORE_PAGE_TYPES = new Set([
  "ember.lore", "ember.ancestry", "ember.characterClass", "ember.culture",
  "ember.cosmos", "ember.deity", "ember.organization",
]);

export function discoverEmberTextFieldPaths(
  type: string,
  fields: Record<string, unknown> | undefined,
  system: unknown,
): readonly HtmlFieldPath[] {
  if (!type.startsWith("ember.") || !fields || !isRecord(system)) return [];
  const paths: HtmlFieldPath[] = [];
  const subtitle = fields.subtitle as RuntimeDataField | undefined;
  if (subtitle?.constructor?.name === "StringField" && typeof system.subtitle === "string") {
    paths.push(["subtitle"]);
  }
  // EmberLorePage and its reviewed subclasses store the banner quote as plain
  // text. Check the actual nested schema, not just an object named "banner".
  const banner = fields.banner as RuntimeDataField | undefined;
  if (EMBER_LORE_PAGE_TYPES.has(type)
    && banner?.constructor?.name === "SchemaField"
    && banner.fields?.img?.constructor?.name === "FilePathField"
    && banner.fields?.caption?.constructor?.name === "StringField"
    && isRecord(system.banner) && typeof system.banner.caption === "string") {
    paths.push(["banner", "caption"]);
  }
  const edict = fields.edict as RuntimeDataField | undefined;
  if (type === "ember.deity" && edict?.constructor?.name === "StringField"
    && typeof system.edict === "string") {
    paths.push(["edict"]);
  }
  if (type === "ember.questEvent" || type === "ember.standaloneEvent") {
    const outcomes = fields.outcomes as RuntimeDataField | undefined;
    if (outcomes?.element?.fields?.label?.constructor?.name === "StringField" && Array.isArray(system.outcomes)) {
      system.outcomes.forEach((outcome, index) => {
        if (isRecord(outcome) && typeof outcome.label === "string") paths.push(["outcomes", index, "label"]);
      });
    }
  }
  return paths;
}

export function readPath(source: unknown, path: HtmlFieldPath): unknown {
  let value = source;
  for (const part of path) {
    if (typeof part === "number") {
      if (!Array.isArray(value)) return undefined;
      value = value[part];
    } else {
      if (!isRecord(value)) return undefined;
      value = value[part];
    }
  }
  return value;
}

export function writePath(source: unknown, path: HtmlFieldPath, value: string): boolean {
  if (!path.length) return false;
  let parent = source;
  for (const part of path.slice(0, -1)) {
    if (typeof part === "number") {
      if (!Array.isArray(parent)) return false;
      parent = parent[part];
    } else {
      if (!isRecord(parent)) return false;
      parent = parent[part];
    }
  }
  const last = path.at(-1);
  if (typeof last === "number") {
    if (!Array.isArray(parent)) return false;
    parent[last] = value;
    return true;
  }
  if (typeof last !== "string" || !isRecord(parent)) return false;
  parent[last] = value;
  return true;
}
