import { MODULE_ID, MODULE_VERSION } from "../constants";
import { sha256 } from "../translation/hash";

export type UiScope = "core" | "ember" | "crucible";
export const UI_OVERRIDES_SETTING = "uiTranslationOverrides";
export interface UiOverride { scope: UiScope; key: string; source: string; base: string; value: string; at: string; userName: string; verified?: string; importedAt?: string }
export interface UiStore { version: 1; entries: UiOverride[] }
export interface UiRow { scope: UiScope; key: string; source: string; base: string; value: string; override: UiOverride | null; blocked: boolean; verified: boolean }
export interface UiCatalog { rows: UiRow[]; store: UiStore; errors: string[] }
const scopes: UiScope[] = ["core", "ember", "crucible"];
const safeKey = (key: string) => key.length > 0 && key.length <= 500 && !key.split(".").some(part => ["__proto__", "prototype", "constructor"].includes(part));
function fail(key: string): never { throw new Error(`Review.${key}`); }
const gm = () => { if (!game.user?.isGM) fail("GMOnly"); };
export function flattenCatalog(value: unknown, prefix = "", target = new Map<string, string>()): Map<string, string> {
  if (typeof value === "string") { if (safeKey(prefix)) target.set(prefix, value); }
  else if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, item] of Object.entries(value)) flattenCatalog(item, prefix ? `${prefix}.${key}` : key, target);
  return target;
}
/** Preserve all executable formatting, variables and HTML attributes; only prose is editable. */
export function uiFormatSignature(text: string): string {
  const label = /^<(?:Unnamed Category|Multiple Values|Unknown Device|Nepojmenovaná kategorie|Více hodnot|Neznámé zařízení)>$/u.test(text);
  return JSON.stringify({ empty: !text.trim(), tags: label ? [] : text.match(/<[^>]*>/gu) ?? [],
    tokens: (text.match(/\{[^{}]*\}|https?:\/\/[^\s<>"']+|`[^`]+`|@(?:UUID|Embed)\[[^\]]*\]/gu) ?? []).sort() });
}
function readStore(): UiStore {
  const raw = game.settings.get(MODULE_ID, UI_OVERRIDES_SETTING) as UiStore | undefined;
  return raw?.version === 1 && Array.isArray(raw.entries) ? structuredClone(raw) : { version: 1, entries: [] };
}
let sources: Promise<{ rows: Omit<UiRow, "override" | "value" | "verified">[]; errors: string[] }> | undefined;
async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(path); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response.json();
}
function enabled(scope: UiScope): boolean { return scope === "core" || (scope === "ember" ? !!game.modules.get("ember")?.active : game.system?.id === "crucible"); }
async function dictionaries(): Promise<{ rows: Omit<UiRow, "override" | "value" | "verified">[]; errors: string[] }> {
  sources ??= (async () => {
    const rows: Omit<UiRow, "override" | "value" | "verified">[] = [], errors: string[] = [];
    for (const scope of scopes.filter(enabled)) {
      try {
        const sourcePath = scope === "core" ? "lang/en.json" : scope === "ember" ? "modules/ember/lang/en.json" : "systems/crucible/lang/en.json";
        const [source, base] = await Promise.all([fetchJson(sourcePath), fetchJson(`modules/${MODULE_ID}/lang/${scope}.cs.json?v=${MODULE_VERSION}`)]);
        const english = flattenCatalog(source), czech = flattenCatalog(base);
        for (const [key, value] of english) {
          const translation = czech.get(key) ?? value;
          rows.push({ scope, key, source: value, base: translation, blocked: uiFormatSignature(value) !== uiFormatSignature(translation) });
        }
      } catch (error) { errors.push(`${scope}: ${String(error)}`); }
    }
    return { rows, errors };
  })();
  const result = await sources;
  // A temporary failed fetch must be retryable from Refresh.
  if (result.errors.length) sources = undefined;
  return result;
}
const same = (a: UiOverride, b: { scope: UiScope; key: string }) => a.scope === b.scope && a.key === b.key;
function compatible(row: Pick<UiRow, "source" | "base" | "blocked">, entry: UiOverride): boolean {
  return row.source === entry.source && typeof entry.value === "string" && entry.value.length <= 100000 && uiFormatSignature(row.source) === uiFormatSignature(entry.value);
}
const fingerprint = (row: Pick<UiRow, "scope" | "key" | "source" | "value">) => sha256(JSON.stringify([row.scope, row.key, row.source, row.value]));
export async function loadUiCatalog(): Promise<UiCatalog> {
  gm(); const { rows, errors } = await dictionaries(), store = readStore();
  const entries = new Map(store.entries.map(entry => [`${entry.scope}:${entry.key}`, entry]));
  return { store, errors, rows: await Promise.all(rows.map(async row => {
    const override = entries.get(`${row.scope}:${row.key}`) ?? null;
    const value = override && compatible(row, override) ? override.value : row.base;
    const effective = { ...row, value, override, blocked: override ? !compatible(row, override) : row.blocked, verified: false };
    effective.verified = !!override?.verified && override.verified === await fingerprint(effective) && !effective.blocked;
    return effective;
  })) };
}
export async function saveUiRow(catalog: UiCatalog, row: UiRow, value: string, action: "save" | "verify" | "unverify" | "reset"): Promise<UiCatalog> {
  gm();
  const current = readStore(); if (JSON.stringify(current) !== JSON.stringify(catalog.store)) fail("Conflict");
  const known = (await dictionaries()).rows.find(candidate => candidate.scope === row.scope && candidate.key === row.key);
  if (!known) fail("ProtectedText");
  if (action !== "reset" && (value.length > 100000 || uiFormatSignature(known.source) !== uiFormatSignature(value))) fail("UiFormatChanged");
  if (action === "verify" && row.blocked) fail("SourceChanged");
  const entries = current.entries.filter(entry => !same(entry, row));
  if (action !== "reset") {
    const entry: UiOverride = { scope: row.scope, key: row.key, source: known.source, base: known.base, value,
      at: new Date().toISOString(), userName: (game.user as { name?: string }).name ?? "GM" };
    if (action === "verify") entry.verified = await fingerprint({ ...row, source: known.source, value });
    entries.push(entry);
  }
  if (JSON.stringify(readStore()) !== JSON.stringify(current)) fail("Conflict");
  await game.settings.set(MODULE_ID, UI_OVERRIDES_SETTING, { version: 1, entries });
  return loadUiCatalog();
}
export function exportUiOverrides(catalog: UiCatalog): string {
  return JSON.stringify({ format: "foundry-translate-ui", version: 1, language: "cs", createdAt: new Date().toISOString(), entries: catalog.store.entries }, null, 2);
}
export interface UiImport { catalog: UiCatalog; entries: UiOverride[]; skipped: number }
export function previewUiImport(catalog: UiCatalog, text: string): UiImport {
  if (text.length > 10_000_000) fail("UiImportInvalid");
  const parsed = JSON.parse(text) as { format?: string; version?: number; language?: string; entries?: unknown[] };
  if (parsed?.format !== "foundry-translate-ui" || parsed.version !== 1 || parsed.language !== "cs" || !Array.isArray(parsed.entries) || parsed.entries.length > 20000) fail("UiImportInvalid");
  const entries: UiOverride[] = [], seen = new Set<string>(); let skipped = 0;
  for (const item of parsed.entries) {
    if (!item || typeof item !== "object") fail("UiImportInvalid");
    const value = item as UiOverride, key = `${value.scope}:${value.key}`;
    if (!scopes.includes(value.scope) || typeof value.key !== "string" || !safeKey(value.key) || seen.has(key)) fail("UiImportInvalid");
    seen.add(key);
    const row = catalog.rows.find(row => same(value, row));
    if (!row || !compatible(row, value)) { skipped++; continue; }
    if (row.value === value.value) continue;
    // Import never attests someone else's work as locally reviewed.
    entries.push({ scope: row.scope, key: row.key, source: row.source, base: row.base, value: value.value, at: new Date().toISOString(), userName: (game.user as { name?: string }).name ?? "GM" });
  }
  return { catalog, entries, skipped };
}
export async function importUiOverrides(preview: UiImport): Promise<UiCatalog> {
  gm(); const current = readStore();
  if (JSON.stringify(current) !== JSON.stringify(preview.catalog.store)) fail("Conflict");
  // Validate again at the write boundary; a caller cannot bypass the preview contract.
  const checked = previewUiImport(preview.catalog, JSON.stringify({ format: "foundry-translate-ui", version: 1, language: "cs", entries: preview.entries }));
  const entries = [...current.entries.filter(entry => !checked.entries.some(change => same(change, entry))), ...checked.entries];
  await game.settings.set(MODULE_ID, UI_OVERRIDES_SETTING, { version: 1, entries }); return loadUiCatalog();
}

/** Project imports may carry a foreign attestation, always labelled as imported. */
export async function previewUiProject(catalog: UiCatalog, incoming: UiOverride[]): Promise<UiImport> {
  const entries: UiOverride[] = []; let skipped = 0;
  for (const item of incoming) {
    const row = catalog.rows.find(row => same(item, row));
    if (!row || !safeKey(item.key) || !compatible(row, item)) { skipped++; continue; }
    const proof = item.verified && item.verified === await fingerprint(item) ? item.verified : undefined;
    if (row.value === item.value && (!proof || row.verified)) continue;
    entries.push({ scope: row.scope, key: row.key, source: row.source, base: row.base, value: item.value, at: item.at, userName: item.userName,
      ...(proof ? { verified: proof, importedAt: new Date().toISOString() } : {}) });
  }
  return { catalog, entries, skipped };
}
export async function importUiProject(preview: UiImport): Promise<UiCatalog> {
  gm();
  const catalog = await loadUiCatalog();
  if (JSON.stringify(catalog.store) !== JSON.stringify(preview.catalog.store)) fail("Conflict");
  const checked = await previewUiProject(catalog, preview.entries), current = readStore();
  if (checked.skipped || JSON.stringify(current) !== JSON.stringify(catalog.store)) fail("Conflict");
  if (checked.entries.length) await game.settings.set(MODULE_ID, UI_OVERRIDES_SETTING, { version: 1, entries: [...current.entries.filter(entry => !checked.entries.some(change => same(change, entry))), ...checked.entries] });
  return loadUiCatalog();
}

/** Run after native catalogs load, BEFORE Foundry pre-localizes data-model labels.
 * Overrides take effect on next client reload; never force a reload during a game. */
export function registerUiOverrides(): void {
  game.settings.register(MODULE_ID, UI_OVERRIDES_SETTING, { name: "UI translation overrides", hint: "", scope: "world", config: false, type: Object, default: { version: 1, entries: [] } });
  const i18n = game.i18n as typeof game.i18n & { lang?: string; translations?: Record<string, unknown>; setLanguage?: (language: string) => Promise<void> };
  const original = i18n.setLanguage;
  if (!original) return;
  i18n.setLanguage = async function(language: string): Promise<void> {
    await original.call(this, language);
    if (this.lang !== "cs" || !this.translations) return;
    const store = readStore(); if (!store.entries.length) return;
    try {
      const { rows } = await dictionaries();
      for (const entry of store.entries) {
        if (!safeKey(entry.key)) continue;
        const row = rows.find(row => same(entry, row)); if (!row || !compatible(row, entry)) continue;
        const path = entry.key.split("."); let target = this.translations;
        for (const key of path.slice(0, -1)) {
          if (!Object.hasOwn(target, key) || typeof target[key] !== "object" || target[key] === null) target[key] = {};
          target = target[key] as Record<string, unknown>;
        }
        target[path.at(-1)!] = entry.value;
      }
    } catch (error) { console.warn("Foundry Translate | Interface overrides could not be loaded.", error); }
  };
}
