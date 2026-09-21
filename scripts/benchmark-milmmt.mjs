// Opt-in local diagnostic for MiLMMT's documented raw-completion template.
// This does not change Foundry settings or select a production provider.
// LM_STUDIO_RESULT=/tmp/milmmt-paragraphs.json node scripts/benchmark-milmmt.mjs
import { writeFile } from 'node:fs/promises';

const model = process.env.LM_STUDIO_MODEL || 'milmmt-46-12b-v1.0';
const baseUrl = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const resultPath = process.env.LM_STUDIO_RESULT || '/tmp/milmmt-paragraphs.json';
const terminology = [
  ['Old Carinth', 'Starý Carinth'], ['Brackus von Tet', 'Brackus Z Tetu'],
  ['Delvers', 'Permoníci'], ['Spirit Beasts', 'Přízračné Šelmy'],
  ['Silver Tower', 'Stříbrná Věž'],
];
const sources = [
  'Fresh paw prints cross the muddy path. The tracks belong to Spirit Beasts. The creatures are hiding in the forest, not inside the Silver Tower.',
  'Three guards defend the bridge against Delvers. They let the party pass without a fight. No one is injured.',
  'Speak with Brackus von Tet before leaving Old Carinth. He gives the party a silver key, but he does not travel with them.',
  'Before nightfall, the party returns to @UUID[Scene.old]{Old Carinth}. The road to the Silver Tower is closed. The guards will not open the gate until morning.',
];
const report = {
  model, createdAt: new Date().toISOString(),
  note: 'Raw completion probes, not the production protection pipeline. Review names, grammar, meaning and syntax manually. Glossary-free timing is not directly comparable to protected translation.',
  source: 'https://huggingface.co/xiaomi-research/MiLMMT-46-12B-v1.0',
  sampling: { temperature: 0, max_tokens: 700, stream: false },
  results: [],
};
for (const mode of ['plain', 'terminology']) {
  for (const source of sources) {
    const relevant = terminology.filter(([name]) => source.includes(name));
    const reference = mode === 'terminology'
      ? `Preserve Foundry @UUID references exactly. Use these approved Czech names, inflected naturally in context:\n${relevant.map(([a, b]) => `${a} = ${b}`).join('\n')}\n\n`
      : '';
    const prompt = `${reference}Translate this from English to Czech:\nEnglish: ${source}\nCzech:`;
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, ...report.sampling }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json();
    const row = { mode, source, prompt, status: response.status, durationMs: Date.now() - startedAt,
      output: data.choices?.[0]?.text, finishReason: data.choices?.[0]?.finish_reason, usage: data.usage,
      ...(data.error ? { error: data.error } : {}),
    };
    report.results.push(row);
    await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n');
    console.info(JSON.stringify(row));
    if (!response.ok) throw new Error(`MiLMMT returned HTTP ${response.status}; see ${resultPath}`);
  }
}
