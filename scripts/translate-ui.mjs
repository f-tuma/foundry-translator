// Offline draft generation; never runs in Foundry or sends text to a cloud API.
// Usage: node scripts/translate-ui.mjs SOURCE.json OUTPUT.json [CHECKPOINT.json]
import { readFile, writeFile } from "node:fs/promises";
import { formatSignature } from "./ui-catalog-format.mjs";
const [input, output, checkpoint = `${output}.checkpoint.json`] = process.argv.slice(2);
if (!input || !output) throw new Error("Provide a source and an output JSON path.");
const source = JSON.parse(await readFile(input, "utf8"));
const glossary = process.env.FOUNDRY_GLOSSARY
  ? JSON.parse(await readFile(process.env.FOUNDRY_GLOSSARY, "utf8")).entries.filter(entry => entry.enabled !== false)
  : [];
let saved = {};
try { saved = JSON.parse(await readFile(checkpoint, "utf8")); } catch {}
const entries = [];
function visit(value, path = []) {
  if (typeof value === "string") entries.push({ path, key: path.join("."), source: value });
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) => visit(child, [...path, key]));
}
visit(source);
for (const entry of entries) {
  // Empty values and interpolation-only layouts are intentional, not prose.
  if (!entry.source.replace(/\{[^{}]*\}/gu, "").match(/\p{L}/u)) {
    saved[entry.key] = { source: entry.source, translation: entry.source };
    continue;
  }
  const approved = glossary.find(term => [term.source, ...term.aliases].includes(entry.source.trim()));
  if (approved && JSON.stringify(formatSignature(entry.source)) === JSON.stringify(formatSignature(approved.replacement))) {
    saved[entry.key] = { source: entry.source, translation: approved.replacement };
  }
}
const valid = (before, after) => typeof after === "string" && (after.trim().length > 0 || !before.trim()) &&
  (!/\p{L}/u.test(before) || /\p{L}/u.test(after)) &&
  after.length >= before.length * 0.2 &&
  JSON.stringify(formatSignature(before)) === JSON.stringify(formatSignature(after)) &&
  !/__FT|\bi[0-9]+\s*:/u.test(after);
const instructions = `Translate these English user-interface strings for Foundry VTT, Crucible and Ember into natural concise Czech. The key identifies UI context; translate only the text, never echo the context. Return the requested JSON object of translated strings. Use sentence case, not title case. Preserve meaning, negation, numbers and every occurrence of placeholders such as {name}, HTML tags and their attributes, URLs and backtick code EXACTLY. Do not translate product names Foundry VTT, Crucible, Ember, Dungeons & Dragons, JavaScript, WebRTC, WebGL. No commentary. Quest means úkol (never květ or zážitek); UI assets means prvky (never financial aktiva). In character creation, translate Background as zázemí. For an image backdrop, translate Background as pozadí. Attunement means Sladění, not binding magic items. Use imperative verbs for action buttons. Toggle means přepnout, not only enable. Keep identifiers and code examples literal.
Terminology: Actor = postava; Item = předmět; Scene = scéna; Token = token; Tile = dlaždice; Journal = deník; Journal Entry = záznam deníku; Compendium = kompendium; Pack = balíček; Roll Table = náhodná tabulka; Roll = hod; Gamemaster = vypravěč; Player = hráč; Party = družina; Ability = vlastnost; Skill = dovednost; Talent = talent; Ancestry = původ; Background = zázemí; Defense = obrana; Armor = zbroj; Check = ověření; Saving throw = záchranný hod; Damage = zranění; Health = zdraví; Movement = pohyb; Turn = tah; Round = kolo; Encounter = střetnutí; Action = akce; Initiative = iniciativa; Sheet = list; Vision = vidění; Elevation = výška; Level = úroveň; Ownership = oprávnění; Condition = stav; Status effect = stavový efekt; Advantage = výhoda; Disadvantage = nevýhoda; Critical = kritický; Inventory = inventář; Proficiency = zběhlost; Rank = stupeň; Stamina = výdrž; Focus = soustředění. Inflect this terminology to fit each Czech sentence.`;
async function translate(batch, retry = false) {
  const started = Date.now();
  const payload = Object.fromEntries(batch.map((entry, index) => [`i${index}`, entry.source]));
  const contexts = batch.map((entry, index) => `i${index}: ${entry.key}`).join("\n");
  const approvedTerms = glossary.filter(term => batch.some(entry => [term.source, ...term.aliases].some(name => entry.source.includes(name))))
    .map(term => `${term.source} → ${term.replacement}`).join("\n");
  const keys = Object.keys(payload);
  const response = await fetch(`${process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1"}/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({ model: process.env.LM_STUDIO_MODEL || "hy-mt2-30b-a3b-apex", temperature: 0, top_p: 1, max_tokens: 6000,
      messages: [{ role: "user", content: `${instructions}${retry ? "\nA previous draft damaged formatting. Copy all placeholders and HTML tags exactly, including punctuation." : ""}${approvedTerms ? `\n\nReviewed terminology (takes priority):\n${approvedTerms}` : ""}\n\nUI context (not part of the output):\n${contexts}\n\nTranslate every value in this JSON object. Keep exactly the same keys and return only this object with translated string values:\n${JSON.stringify(payload)}` }],
      response_format: { type: "json_schema", json_schema: { name: "translated_ui", strict: true,
        schema: { type: "object", properties: Object.fromEntries(keys.map(k => [k, { type: "string" }])), required: keys, additionalProperties: false } } },
    }),
  });
  if (!response.ok) throw new Error(`LM Studio ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const envelope = await response.json();
  console.log(`REQUEST ${batch.length} strings ${((Date.now() - started) / 1000).toFixed(1)}s ${envelope.usage?.completion_tokens ?? "?"} tokens`);
  return JSON.parse(envelope.choices[0].message.content);
}
const pending = entries.filter(e => !saved[e.key] || saved[e.key].source !== e.source || !valid(e.source, saved[e.key].translation));
let completed = entries.length - pending.length;
for (let offset = 0; offset < pending.length;) {
  const batch = [];
  let size = 0;
  while (offset < pending.length && batch.length < Number(process.env.UI_BATCH_SIZE || 24) && (size < 2200 || !batch.length)) {
    const entry = pending[offset++]; batch.push(entry); size += entry.source.length + entry.key.length;
  }
  const translated = await translate(batch);
  for (const [index, entry] of batch.entries()) {
    let value = translated[`i${index}`];
    if (!valid(entry.source, value)) value = (await translate([entry], true)).i0;
    if (!valid(entry.source, value)) {
      console.error("REVIEW_FORMAT", entry.key);
      saved[entry.key] = { source: entry.source, translation: entry.source, review: true };
    } else saved[entry.key] = { source: entry.source, translation: value };
    completed++;
  }
  await writeFile(checkpoint, JSON.stringify(saved, null, 2));
  console.log(`${completed}/${entries.length} ${batch.at(-1).key}`);
}
const result = structuredClone(source);
for (const { path, key } of entries) {
  let parent = result;
  for (const segment of path.slice(0, -1)) parent = parent[segment];
  parent[path.at(-1)] = saved[key].translation;
}
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(`Saved ${entries.length} strings; ${Object.values(saved).filter(e => e.review).length} formatting cases require manual review.`);
