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
