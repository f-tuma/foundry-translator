import { readFile, writeFile } from "node:fs/promises";
import { catalogEntries, formatSignature } from "./ui-catalog-format.mjs";
const overrides = JSON.parse(await readFile(new URL("./ui-czech-overrides.json", import.meta.url), "utf8"));
const [name, file] = process.argv.slice(2);
if (!name || !file) throw new Error("Usage: node scripts/apply-ui-overrides.mjs ember public/lang/ember.cs.json");
const catalog = JSON.parse(await readFile(file, "utf8"));
const entries = new Map(catalogEntries(catalog).map(([path, value]) => [path.join("."), { path, value }]));
for (const [key, translation] of Object.entries(overrides[name] || {})) {
  const entry = entries.get(key);
  if (!entry) throw new Error(`Unknown UI key ${key}`);
  if (JSON.stringify(formatSignature(entry.value)) !== JSON.stringify(formatSignature(translation))) throw new Error(`Changed formatting at ${key}`);
  let parent = catalog;
  for (const segment of entry.path.slice(0, -1)) parent = parent[segment];
  parent[entry.path.at(-1)] = translation;
}
await writeFile(file, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Applied ${Object.keys(overrides[name] || {}).length} reviewed UI strings.`);
