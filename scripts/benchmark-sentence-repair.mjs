// Local experiment: direct translation vs repair of the whole Czech sentence.
// LM_STUDIO_MODEL=hy-mt2-7b LM_STUDIO_RESULT=/tmp/repair-7b.json node scripts/benchmark-sentence-repair.mjs
// No Foundry documents/settings are changed; every example is synthetic.
import { writeFile } from 'node:fs/promises';
const model = process.env.LM_STUDIO_MODEL || 'hy-mt2-7b';
const baseUrl = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const outputFile = process.env.LM_STUDIO_RESULT || '/tmp/sentence-repair.json';
const variant = process.env.LM_REPAIR_PROMPT || 'baseline';
if (!['baseline', 'source-first'].includes(variant)) throw new Error('Unknown LM_REPAIR_PROMPT');
const temperature = Number(process.env.LM_REPAIR_TEMPERATURE ?? 0.7);
if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('Invalid temperature');
const cases = [
  { id: 'dashboard-agreement', source: 'The new dashboard was created.', draft: 'Nová nástěnka byla vytvořena.', glossary: [['dashboard', 'řídicí panel', 'INFLECT']] },
  { id: 'guardian-agreement', source: 'The wounded Frost Warden arrived. He was exhausted.', draft: 'Zraněná Ledová Strážkyně dorazila. Byla vyčerpaná.', glossary: [['Frost Warden', 'Mrazový Strážce', 'INFLECT']] },
  { id: 'plural-negation', source: 'The Forest Spirits were tired, but they did not leave.', draft: 'Lesní Duch byl unavený, ale neodešel.', glossary: [['Forest Spirits', 'Lesní Duchové', 'INFLECT']] },
  { id: 'delvers-dative', source: 'They fight against Delvers.', draft: 'Bojují proti Permonícům.', glossary: [['Delvers', 'Permoníci', 'INFLECT']] },
  { id: 'ownership', source: 'The tracks belong to Spirit Beasts.', draft: 'Stopám patří Přízračné Šelmy.', glossary: [['Spirit Beasts', 'Přízračné Šelmy', 'INFLECT']] },
  { id: 'quantity-preposition', source: 'Only two guards returned from Old Carinth. They did not open the gate.', draft: 'Dva strážní se vrátili z Starého Carinthu. Neotevřeli bránu.', glossary: [['Old Carinth', 'Starý Carinth', 'INFLECT']] },
  { id: 'exact-and-inflect', source: 'They spoke about Dawn Star, but did not enter Old Carinth.', draft: 'Mluvili o Jitřní Hvězdě, ale nevstoupili do Starý Carinth.', glossary: [['Dawn Star', 'Dawn Star', 'EXACT'], ['Old Carinth', 'Starý Carinth', 'INFLECT']] },
  { id: 'already-correct', source: 'The tracks belong to Spirit Beasts. They do not belong to the guards.', draft: 'Stopy patří Přízračným Šelmám. Nepatří strážným.', glossary: [['Spirit Beasts', 'Přízračné Šelmy', 'INFLECT']] },
  { id: 'uuid-label', source: 'Travel to @UUID[Scene.old]{Old Carinth} before dawn.', draft: 'Cestujte do @UUID[Scene.old]{Starý Carinth} před úsvitem.', glossary: [['Old Carinth', 'Starý Carinth', 'INFLECT']] },
];
const rules = [
  'Glossary terms are Czech dictionary forms. Inflect them correctly and adjust agreement of surrounding adjectives, pronouns and verbs. Keep terms marked EXACT literally unchanged. Never change the meaning of the English original.',
  'Preserve people, numbers, negation, tense and relationships: who does what and who owns what. Keep the glossary vocabulary and capitalization; do not invent different names.',
  'Preserve @UUID[identifier]{label} syntax. Never change the identifier; only the visible label may be translated and inflected.',
  'Output ONLY the final Czech text, without explanations, headings or quotation marks.',
].join('\n');
const sampling = { temperature, top_p: /30b-a3b/i.test(model) ? 1 : 0.6, max_tokens: 512, stream: false };
const report = { model, variant, createdAt: new Date().toISOString(), sampling,
  note: 'One observed sample per mode/case, no automatic semantic score. Inspect agreement, vocabulary, meaning, EXACT and syntax. Not a production pipeline run.', results: [] };
async function request(row, mode, draft) {
  const task = mode === 'direct' ? 'Translate the whole English source into Czech using the glossary.'
    : 'Correct the entire current Czech translation using the English original and the glossary. Do not merely replace individual names. If the translation is already correct, leave it unchanged.';
  const compactRules = [
    'Translate the English source into correct Czech using the approved terminology. The English source is authoritative for meaning, numbers, negation, tense and who owns or does what.',
    ...(draft === undefined ? [] : ['The earlier Czech draft is only a suggestion. It may have wrong grammar, wrong terms or reversed relationships. Correct the whole sentence, including surrounding agreement.']),
    'Inflect dictionary forms naturally; adjust surrounding adjectives, pronouns and verbs. Preserve glossary vocabulary and capitalization.',
    ...(row.glossary.some(([, , mode]) => mode === 'EXACT') ? ['Names marked EXACT must appear literally unchanged.'] : []),
    ...(row.source.includes('@UUID[') ? ['Preserve @UUID[identifier]{label} syntax and its exact identifier. Translate and inflect only the visible label.'] : []),
    'Output only the final Czech translation without any explanations.',
  ].join('\n');
  const terminology = row.glossary.map(([source, replacement, mode]) =>
    `${source} translates to ${replacement}${mode === 'EXACT' ? ' (EXACT)' : ' (Czech dictionary form)'}`).join('\n');
  const prompt = variant === 'source-first'
    ? `[Background Information]\nApproved terminology:\n${terminology}\n${draft === undefined ? '' : `\nEarlier Czech draft:\n${draft}\n`}\n${compactRules}\n\n[Source Text]\n${row.source}`
    : `${task}\n${rules}\n\n[English original]\n${row.source}\n\n${draft === undefined ? '' : `[Current Czech translation]\n${draft}\n\n`}[Glossary]\n${row.glossary.map(([source, replacement, mode]) => `${mode}: ${source} → ${replacement}`).join('\n')}`;
  const start = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model, messages: [{role: 'user', content: prompt}], ...sampling}), signal: AbortSignal.timeout(120_000) });
  const data = await response.json();
  const result = { id: row.id, mode, source: row.source, ...(draft === undefined ? {} : {draft}), glossary: row.glossary,
    prompt, durationMs: Date.now() - start, status: response.status, output: data.choices?.[0]?.message?.content,
    finishReason: data.choices?.[0]?.finish_reason, usage: data.usage, ...(data.error ? {error: data.error} : {}) };
  report.results.push(result);
  await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify({id: row.id, mode, durationMs: result.durationMs, output: result.output, finishReason: result.finishReason, error: result.error}));
  if (!response.ok) throw new Error(`HTTP ${response.status}; see ${outputFile}`);
  return result;
}
for (const row of cases) {
  const direct = await request(row, 'direct');
  if (direct.finishReason === 'stop' && typeof direct.output === 'string' && direct.output.trim() && direct.output.length <= Math.max(200, row.source.length * 4)) {
    await request(row, 'repair-generated', direct.output);
  }
  await request(row, 'repair-seeded', row.draft);
}
