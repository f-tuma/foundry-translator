import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import { getTranslatorSettings } from "../settings/settings";
import { GlossaryCompendiumRepository } from "./compendium-repository";
import { collectNameContexts } from "./name-context";
import { MAX_GLOSSARY_BYTES, parseGlossaryFile, planGlossaryImport, serializeGlossaryFile, validateSelectedImport, type GlossaryFile, type GlossaryImportRow } from "./files";
import type { GlossaryEntry } from "./types";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Glossary.Files.${key}`);
const escape = (text: string) => text.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const help = (key: string) => renderHelpTooltip(t(`${key}Hint`), t(key));
const metadata = (entry: GlossaryEntry) => t(entry.customized ? "Reviewed" : "NotReviewed") + " · " + `${game.i18n.localize(`FOUNDRY_TRANSLATE.Glossary.Category.${entry.category}`)} · ${game.i18n.localize(`FOUNDRY_TRANSLATE.Glossary.Mode.${entry.enabled === false ? "off" : entry.mode ?? "fixed"}`)}${entry.aliases.length ? ` · ${t("Aliases")}: ${entry.aliases.join("; ")}` : ""}${entry.notes ? ` · ${entry.notes}` : ""}`;

export function renderGlossaryFilesView(rows: readonly GlossaryImportRow[], selected: ReadonlySet<string>, fileName: string, loaded: boolean): HTMLElement {
  const root = document.createElement("section");
  root.className = "ft-settings ft-bundles ft-glossary-files";
  root.innerHTML = `
    <header class="ft-settings__intro"><span class="ft-settings__brand-icon"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i></span><div class="ft-heading-with-help"><h2>${t("Heading")}</h2>${help("Heading")}</div></header>
    <section class="ft-bundles__card"><div class="ft-heading-with-help"><h3>${t("Export")}</h3>${help("Export")}</div>
      <label class="ft-glossary-files__check"><input type="checkbox" data-file-context checked> ${t("Context")}</label>
      <div class="ft-glossary-files__actions"><button type="button" class="ft-button ft-button--secondary" data-file-export="csv"><i class="fa-solid fa-table" aria-hidden="true"></i>${t("ExportCsv")}</button><button type="button" class="ft-button ft-button--secondary" data-file-export="json"><i class="fa-solid fa-download" aria-hidden="true"></i>${t("ExportJson")}</button></div>
    </section>
    <section class="ft-bundles__card"><div class="ft-heading-with-help"><h3>${t("Import")}</h3>${help("Import")}</div>
      <label class="ft-bundles__file">${t("ChooseFile")}<input type="file" accept=".json,.csv,application/json,text/csv" data-glossary-file></label>
    </section>
    ${loaded ? `<section class="ft-bundles__card"><h3>${t("Preview")}</h3><p>${escape(fileName)}</p>
      <p>${t("Counts").replace("{new}", String(rows.filter((r) => r.state === "new").length)).replace("{changed}", String(rows.filter((r) => r.state === "changed").length)).replace("{unchanged}", String(rows.filter((r) => r.state === "unchanged").length))}</p>
      <label class="ft-glossary-files__check"><input type="checkbox" data-select-changed ${rows.some((r) => r.state === "changed") ? "" : "disabled"}> ${t("SelectChanged")}</label>
      <input type="search" data-import-search placeholder="${t("Search")}" aria-label="${t("Search")}">
      <ul class="ft-glossary-files__rows">${rows.map((row, index) => `<li data-import-row="${index}" data-state="${row.state}">
        <label class="ft-glossary-files__check"><input type="checkbox" data-import-select="${index}" ${row.state === "unchanged" ? "disabled" : ""} ${selected.has(row.key) ? "checked" : ""}><strong>${escape(row.after.source)}</strong><span class="ft-glossary-files__state">${t(`State.${row.state}`)}</span></label>
        <div class="ft-glossary-files__comparison">${row.before ? `<div><small>${t("Current")}</small><span>${escape(row.before.replacement)}</span><small>${escape(metadata(row.before))}</small></div>` : ""}<div><small>${t("Incoming")}</small><span>${escape(row.after.replacement)}</span><small>${escape(metadata(row.after))}</small></div></div>
      </li>`).join("") || `<li>${t("Empty")}</li>`}</ul>
      <button type="button" class="ft-button ft-button--primary" data-file-apply disabled>${t("Apply").replace("{count}", String(selected.size))}</button>
    </section>` : ""}
    <p class="ft-bundles__status" data-file-status role="status" aria-live="polite">${t("Ready")}</p>`;
  activateHelpTooltips(root);
  return root;
}

export class GlossaryFilesApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "foundry-translate-glossary-files", classes: ["foundry-translate", "foundry-translate-glossary-files-window"],
    position: { width: 760, height: 780 }, window: { title: "FOUNDRY_TRANSLATE.Glossary.Files.Heading", icon: "fa-solid fa-file-arrow-up", resizable: true } };
  hasUnsavedEdits: () => boolean = () => false;
  readonly #repository = new GlossaryCompendiumRepository();
  #file: GlossaryFile | undefined;
  #rows: GlossaryImportRow[] = [];
  #selected = new Set<string>();
  #fileName = "";
  #busy = false;
  #statusText = "";
  #error = false;

  protected async _renderHTML(): Promise<HTMLElement> { return renderGlossaryFilesView(this.#rows, this.#selected, this.#fileName, !!this.#file); }
  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void { content.replaceChildren(result); }
  protected async _onRender(): Promise<void> {
    for (const button of this.element.querySelectorAll<HTMLButtonElement>("[data-file-export]")) button.addEventListener("click", () => void this.#run(async () => {
      if (this.hasUnsavedEdits()) throw new Error(t("Unsaved"));
      const entries = await this.#repository.loadExisting();
      const language = getTranslatorSettings().targetLanguage;
      const format = button.dataset.fileExport as "csv" | "json";
      const contexts = this.element.querySelector<HTMLInputElement>("[data-file-context]")?.checked ? collectNameContexts(entries) : new Map<string, string>();
      const text = serializeGlossaryFile(entries, language, format, contexts);
      const url = URL.createObjectURL(new Blob([text], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `foundry-glossary-${language}-${new Date().toISOString().slice(0, 10)}.${format}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.#status(t("Exported").replace("{count}", String(entries.length)));
    }));
    this.element.querySelector<HTMLInputElement>("[data-glossary-file]")?.addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void this.#run(async () => {
        this.#file = undefined; this.#rows = []; this.#selected.clear(); this.#fileName = file.name;
        await this.render({ force: true });
        if (file.size > MAX_GLOSSARY_BYTES) throw new Error(t("TooLarge"));
        const extension = file.name.split(".").at(-1)?.toLowerCase();
        if (extension !== "csv" && extension !== "json") throw new Error(t("InvalidFile"));
        const language = getTranslatorSettings().targetLanguage;
        const parsed = parseGlossaryFile(await file.text(), extension, language);
        this.#rows = planGlossaryImport(await this.#repository.loadExisting(), parsed, language);
        this.#file = parsed;
        this.#selected = new Set(this.#rows.filter((r) => r.state === "new").map((r) => r.key));
        this.#status(t("PreviewReady"));
        await this.render({ force: true });
      });
    });
    this.element.querySelector<HTMLInputElement>("[data-select-changed]")?.addEventListener("change", (event) => {
      const checked = (event.target as HTMLInputElement).checked;
      this.#rows.filter((row) => row.state === "changed").forEach((row) => checked ? this.#selected.add(row.key) : this.#selected.delete(row.key));
      this.#updateControls();
    });
    for (const checkbox of this.element.querySelectorAll<HTMLInputElement>("[data-import-select]")) checkbox.addEventListener("change", () => {
      const row = this.#rows[Number(checkbox.dataset.importSelect)];
      if (row && row.state !== "unchanged") checkbox.checked ? this.#selected.add(row.key) : this.#selected.delete(row.key);
      this.#updateControls();
    });
    this.element.querySelector<HTMLInputElement>("[data-import-search]")?.addEventListener("input", (event) => {
      const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase();
      for (const row of this.element.querySelectorAll<HTMLElement>("[data-import-row]")) row.hidden = !row.textContent?.toLocaleLowerCase().includes(query);
    });
    this.element.querySelector("[data-file-apply]")?.addEventListener("click", () => void this.#run(async () => {
      if (!this.#file || !this.#selected.size) return;
      if (this.hasUnsavedEdits()) throw new Error(t("Unsaved"));
      if (getTranslatorSettings().targetLanguage.toLowerCase() !== this.#file.language.toLowerCase()) throw new Error(t("LanguageMismatch"));
      const selected = this.#rows.filter((row) => this.#selected.has(row.key) && row.state !== "unchanged");
      validateSelectedImport(await this.#repository.loadExisting(), selected);
      await this.#repository.importEntries(selected);
      this.#rows = planGlossaryImport(await this.#repository.loadExisting(), this.#file, this.#file.language);
      this.#selected.clear();
      this.#status(t("Imported").replace("{count}", String(selected.length)));
      await this.render({ force: true });
    }));
    this.#updateControls();
    if (this.#statusText) this.#status(this.#statusText, this.#error);
  }

  #updateControls(): void {
    for (const input of this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>("[data-file-export],[data-glossary-file],[data-file-context],[data-import-select],[data-select-changed],[data-file-apply],[data-import-search]")) input.disabled = this.#busy;
    for (const input of this.element.querySelectorAll<HTMLInputElement>("[data-import-select]")) {
      const row = this.#rows[Number(input.dataset.importSelect)];
      input.checked = !!row && this.#selected.has(row.key);
      input.disabled = this.#busy || row?.state === "unchanged";
    }
    const changed = this.#rows.filter((row) => row.state === "changed");
    const bulk = this.element.querySelector<HTMLInputElement>("[data-select-changed]");
    if (bulk) { bulk.disabled = this.#busy || !changed.length; bulk.checked = !!changed.length && changed.every((row) => this.#selected.has(row.key)); bulk.indeterminate = changed.some((row) => this.#selected.has(row.key)) && !bulk.checked; }
    const apply = this.element.querySelector<HTMLButtonElement>("[data-file-apply]");
    if (apply) { apply.disabled = this.#busy || !this.#selected.size; apply.textContent = t("Apply").replace("{count}", String(this.#selected.size)); }
  }
  async #run(work: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true; this.#updateControls(); this.#status(t("Working"));
    try { await work(); }
    catch (error) { this.#status(error instanceof Error ? error.message : String(error), true); }
    finally { this.#busy = false; this.#updateControls(); }
  }
  #status(message: string, error = false): void {
    this.#statusText = message; this.#error = error;
    const element = this.element.querySelector<HTMLElement>("[data-file-status]");
    if (element) { element.textContent = message; element.dataset.error = String(error); }
  }
}
