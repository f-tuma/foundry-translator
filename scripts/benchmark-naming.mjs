import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite";

const { values } = parseArgs({ options: {
  model: { type: "string" },
  url: { type: "string", default: "http://127.0.0.1:1234/v1" },
  profile: { type: "string", default: "production" },
  repetitions: { type: "string", default: "2" },
  output: { type: "string" },
  help: { type: "boolean" },
} });
if (values.help || !values.model) {
  console.log("npm run benchmark:naming -- --model <server-model-id> [--profile production|granite|qwen] [--repetitions 2] [--output report.json] [--url http://127.0.0.1:1234/v1]");
  process.exit(values.help ? 0 : 1);
}
const repetitions = Number(values.repetitions);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error("Use 1–10 repetitions.");
if (!["production", "granite", "qwen"].includes(values.profile)) throw new Error("Unknown sampling profile.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cases = JSON.parse(await readFile(join(root, "tests/fixtures/naming-cases.cs.json"), "utf8"));
const work = await mkdtemp(join(tmpdir(), "foundry-naming-"));
const output = resolve(values.output ?? join(tmpdir(), `naming-${values.model.replace(/[^a-z0-9.-]/giu, "_")}-${values.profile}-${Date.now()}.json`));
const report = { model: values.model, profile: values.profile, startedAt: new Date().toISOString(),
  note: "Fixture references are examples, not exact-match scores. Inspect Czech meaning and grammar manually. JSON acceptance is not language quality.",
  cases, batches: [] };
let requests = [];

try {
  // Bundle the real client, not a duplicate prompt/parser. No Foundry instance is used.
  await build({ configFile: false, root, publicDir: false, logLevel: "error", build: {
    target: "esnext", outDir: work, minify: false,
    lib: { entry: join(root, "src/glossary/name-analysis.ts"), formats: ["es"], fileName: () => "client.mjs" },
  } });
  const { NameAnalysisClient } = await import(pathToFileURL(join(work, "client.mjs")).href);
  globalThis.game = { i18n: { localize: () => "Selected naming model is unavailable on the server." } };
  const request = async (url, init) => {
    if (init?.body && values.profile !== "production") {
      if (!new URL(url).pathname.endsWith("/api/v1/chat")) throw new Error("Sampling profiles require the LM Studio native API.");
      const body = JSON.parse(init.body);
      // Only documented native parameters: Qwen's presence_penalty is unavailable here.
      Object.assign(body, values.profile === "granite"
        ? { temperature: 1, top_p: 0.95 }
        : { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1 });
      init = { ...init, body: JSON.stringify(body) };
    }
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
    const data = await response.clone().json();
    requests.push({ parameters: init?.body ? JSON.parse(init.body) : undefined, status: response.status,
      stats: data.stats, usage: data.usage, error: data.error,
      // Record final output and token counts, never hidden reasoning text.
      raw: data.output?.filter((part) => part.type === "message").map((part) => part.content).join("")
        ?? data.choices?.[0]?.message?.content });
    return response;
  };
  const client = new NameAnalysisClient({ provider: "openai-compatible", openAiBaseUrl: values.url,
    openAiApiKey: "", openAiModel: "hy-mt2-7b", glossaryAiModel: values.model,
    sourceLanguage: "en", targetLanguage: "cs", apiKey: "",
    worldContext: "An original fantasy world with dramatic adventures, ancient cities, trading caravans and religious orders.",
  }, request);
  await client.model();
  // Quantization/runtime metadata is useful when the server exposes it. Optional on other servers.
  const metadata = await fetch(`${new URL(values.url).origin}/api/v1/models`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok ? r.json() : null).catch(() => null);
  report.modelMetadata = metadata?.models?.find((m) => m.key === values.model || m.loaded_instances?.some((instance) => instance.id === values.model));
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (let start = 0; start < cases.length; start += 8) {
      const subset = cases.slice(start, start + 8);
      const entries = subset.map((c, i) => ({ source: c.source, replacement: c.source, category: c.category, aliases: [], sourceUuid: `Test.${start + i}` }));
      const contexts = new Map(subset.map((c) => [c.source, c.context]));
      requests = [];
      const began = performance.now();
      let decisions, error;
      try { decisions = await client.analyze(entries, contexts, values.model); }
      catch (cause) { error = cause.message; }
      const batch = { repeat, start, seconds: Number(((performance.now() - began) / 1000).toFixed(3)), error, requests, decisions };
      report.batches.push(batch);
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify({ repeat, start, seconds: batch.seconds, error,
        decisions: decisions?.map((d) => ({ source: d.source, replacement: d.replacement })) }));
    }
  }
  console.log(JSON.stringify({ output, acceptedBatches: report.batches.filter((b) => !b.error).length, totalBatches: report.batches.length }));
} finally {
  await rm(work, { recursive: true, force: true });
}
