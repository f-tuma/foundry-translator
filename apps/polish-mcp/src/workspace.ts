import { constants } from "node:fs";
import { open, mkdir, realpath, readdir, rename, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MAX_PROJECT_BYTES } from "../../../src/review/project-format";
import { hash, PolishContent, type ProposalInput, type Suggestion } from "./content";

const suggestionSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), unitId: z.string(), revision: z.string(),
  parts: z.array(z.string().max(60000)).min(1).max(1000), reason: z.string().min(1).max(3000),
  category: z.enum(["grammar", "meaning", "terminology", "style"]), warnings: z.array(z.string()), at: z.string() }).strict();
const sessionSchema = z.object({ version: z.literal(1), inputHash: z.string(), suggestions: z.array(suggestionSchema).max(10000) }).strict();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export class PolishWorkspace {
  private active?: { file: string; hash: string; content: PolishContent; suggestions: Suggestion[] };
  private constructor(readonly root: string) {}
  static async create(path: string) {
    await mkdir(resolve(path), { recursive: true, mode: 0o700 });
    const workspace = new PolishWorkspace(await realpath(resolve(path)));
    for (const dir of ["input", "sessions", "output"]) await workspace.directory(dir);
    return workspace;
  }
  private async directory(dir: string) {
    const path = join(this.root, dir);
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (await realpath(path) !== path) throw new Error("Workspace directories must not be symlinks.");
    return path;
  }
  private async read(path: string) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_PROJECT_BYTES) throw new Error("Expected a regular JSON file no larger than 100 MB.");
      const text = await file.readFile("utf8");
      if (Buffer.byteLength(text) > MAX_PROJECT_BYTES) throw new Error("File exceeded the size limit while reading.");
      return text;
    } finally { await file.close(); }
  }
  private async atomic(path: string, text: string) {
    if (Buffer.byteLength(text) > MAX_PROJECT_BYTES) throw new Error("Output exceeds 100 MB.");
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      await rename(temp, path);
    } finally { await rm(temp, { force: true }); }
  }
  async files() {
    const dir = await this.directory("input");
    return { directory: dir, files: (await readdir(dir, { withFileTypes: true })).filter(f => f.isFile() && f.name.endsWith(".json")).map(f => f.name).sort() };
  }
  async load(name: string) {
    if (!name.endsWith(".json") || name.length > 200 || basename(name) !== name || /[\\/\x00-\x1f]/u.test(name)) throw new Error("Use a JSON filename from list_exports, not a path.");
    const file = join(await this.directory("input"), name), json = await this.read(file), inputHash = hash(json);
    const content = new PolishContent(json);
    let suggestions: Suggestion[] = [];
    try {
      const saved = sessionSchema.parse(JSON.parse(await this.read(join(await this.directory("sessions"), `${inputHash}.json`))));
      if (saved.inputHash !== inputHash) throw new Error("Session belongs to another export.");
      suggestions = saved.suggestions;
      if (new Set(suggestions.map(s => s.id)).size !== suggestions.length) throw new Error("Duplicate saved suggestions.");
      // Each alternative is validated separately because alternatives share a row.
      for (const suggestion of suggestions) content.export([suggestion]);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.active = { file, hash: inputHash, content, suggestions };
    return this.status();
  }
  current() {
    if (!this.active) throw new Error("Call open_export with a filename from list_exports first.");
    return this.active;
  }
  status() {
    const active = this.current();
    return { file: basename(active.file), inputHash: active.hash, language: active.content.project.bundle.targetLanguage,
      documents: active.content.documents.length, paragraphs: active.content.units.length, glossary: active.content.project.bundle.glossary.length,
      suggestions: active.suggestions.length, uiOverridesExcluded: active.content.project.ui.length,
      status: "Suggestions are unverified. Export only user-selected suggestion IDs. Input is never modified." };
  }
  private async fresh() {
    const active = this.current();
    await this.directory("input");
    if (hash(await this.read(active.file)) !== active.hash) throw new Error("Input export changed on disk. Reopen it before proposing or exporting corrections.");
    return active;
  }
  async propose(input: ProposalInput) {
    const active = await this.fresh(), suggestion = active.content.propose(input);
    const existing = active.suggestions.find(s => s.id === suggestion.id);
    if (existing) return existing;
    if (active.suggestions.length >= 10000) throw new Error("Session suggestion limit reached.");
    const suggestions = [...active.suggestions, suggestion];
    const dir = await this.directory("sessions"), path = join(dir, `${active.hash}.json`), lockPath = `${path}.lock`;
    const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Another process is saving this export. Retry; if it persists, close MCP clients and inspect the session .lock file."); });
    try {
      let current: Suggestion[] = [];
      try { current = sessionSchema.parse(JSON.parse(await this.read(path))).suggestions; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (JSON.stringify(current) !== JSON.stringify(active.suggestions)) throw new Error("Suggestions changed in another client. Reopen the export to recover them before saving.");
      await this.atomic(path, JSON.stringify({ version: 1, inputHash: active.hash, suggestions }, null, 2));
      active.suggestions = suggestions;
    } finally { await lock.close(); await rm(lockPath, { force: true }); }
    return suggestion;
  }
  async export(ids: string[]) {
    const active = await this.fresh();
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Provide unique selected suggestion IDs.");
    const suggestions = ids.map(id => {
      const found = active.suggestions.find(s => s.id === id);
      if (!found) throw new Error("Unknown suggestion ID.");
      return found;
    });
    const project = active.content.export(suggestions), output = await this.directory("output");
    const run = join(output, randomUUID()); await mkdir(run, { mode: 0o700 });
    try {
      await this.atomic(join(run, "corrections.json"), JSON.stringify(project, null, 2));
      await this.atomic(join(run, "suggestions.json"), JSON.stringify({ format: "foundry-polish-audit", version: 1,
        inputHash: active.hash, createdAt: new Date().toISOString(), verified: false,
        suggestions: suggestions.map(s => ({ ...s, source: active.content.unit(s.unitId).source, before: active.content.unit(s.unitId).translation })),
      }, null, 2));
      await this.atomic(join(run, "review.html"), this.report(suggestions));
    } catch (error) { await rm(run, { recursive: true, force: true }); throw error; }
    return { importFile: join(run, "corrections.json"), reviewFile: join(run, "review.html"), auditFile: join(run, "suggestions.json"),
      suggestions: suggestions.length, documents: project.bundle.documents.length,
      instructions: "Review the report, then import corrections.json via Foundry Translation Editor → Project import (Foundry Translate 0.30.0+). Human verification remains separate. Changes since the input export block import. Public/community release import is not supported for this file." };
  }
  private report(suggestions: Suggestion[]) {
    const content = this.current().content;
    const rows = suggestions.map(s => { const u = content.unit(s.unitId); return `<section><h2>${escapeHtml(content.doc(u).sourceName)} · ${escapeHtml(u.section)}</h2><p>${escapeHtml(s.reason)}</p>${s.warnings.map(w => `<p class="warning">${escapeHtml(w)}</p>`).join("")}<div class="original"><h3>Originál</h3><pre>${escapeHtml(u.source.join(""))}</pre></div><div class="comparison"><div><h3>Stávající překlad</h3><pre>${escapeHtml(u.translation.join(""))}</pre></div><div><h3>Návrh · neověřeno</h3><pre>${escapeHtml(s.parts.join(""))}</pre></div></div></section>`; }).join("");
    return `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Korektury překladu</title><style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui;max-width:1150px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.3}h2{font-size:20px}h3{font:600 13px system-ui;opacity:.7}section{border-top:1px solid #8887;margin-top:32px;padding-top:20px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:28px}.original{opacity:.8;padding-bottom:12px}.warning{border-left:3px solid #b88628;padding-left:12px}small{opacity:.7}@media(max-width:650px){.comparison{grid-template-columns:1fr}}</style><h1>Korektury překladu</h1><p>${suggestions.length} návrhů. Zkontroluj význam proti originálu; návrhy nejsou lidsky ověřené. Import vyžaduje Foundry Translate 0.30.0 nebo novější.</p><small>Originál exportu: ${this.current().hash}</small>${rows}</html>`;
  }
}
