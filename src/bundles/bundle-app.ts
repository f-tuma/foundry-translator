import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import { getTranslatorSettings } from "../settings/settings";
import { MAX_BUNDLE_BYTES, parseTranslationBundle } from "./format";
import { exportTranslationBundle, importTranslationBundle, planBundleImport, type BundleImportPlan } from "./service";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Bundles.${key}`);
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function renderBundleView(plan?: BundleImportPlan, fileName = ""): HTMLElement {
  const root = document.createElement("section");
  root.className = "ft-settings ft-bundles";
  root.innerHTML = `
    <header class="ft-settings__intro"><span class="ft-settings__brand-icon"><i class="fa-solid fa-box-archive" aria-hidden="true"></i></span><div><div class="ft-heading-with-help"><h2>${t("Heading")}</h2>${renderHelpTooltip(t("Intro"), t("Heading"))}</div></div></header>
    <section class="ft-bundles__card"><div class="ft-heading-with-help"><h3>${t("ExportHeading")}</h3>${renderHelpTooltip(t("ExportHint"), t("ExportHeading"))}</div><button type="button" class="ft-button ft-button--secondary" data-bundle-export><i class="fa-solid fa-download" aria-hidden="true"></i>${t("Export")}</button></section>
    <section class="ft-bundles__card"><div class="ft-heading-with-help"><h3>${t("ImportHeading")}</h3>${renderHelpTooltip(t("ImportHint"), t("ImportHeading"))}</div><label class="ft-bundles__file">${t("ChooseFile")}<input type="file" accept=".json,application/json" data-bundle-file></label></section>
    ${plan ? `<section class="ft-bundles__card"><h3>${t("Preview")} · ${escape(plan.bundle.targetLanguage.toUpperCase())}</h3><p class="ft-bundles__filename">${escape(fileName)}</p>
      <p>${t("PreviewCount").replace("{ready}", String(plan.rows.filter((r) => r.state === "ready").length)).replace("{total}", String(plan.rows.length)).replace("{glossary}", String(plan.glossary.length))}</p>
      ${plan.glossaryConflicts.length ? `<p class="ft-bundles__warning">${t("GlossaryConflicts").replace("{count}", String(plan.glossaryConflicts.length))}</p>` : ""}
      ${plan.bundle.targetLanguage !== getTranslatorSettings().targetLanguage ? `<p class="ft-bundles__warning">${t("LanguageHint")}</p>` : ""}
      <ul class="ft-bundles__rows">${plan.rows.map((row) => `<li data-state="${row.state}"><div><strong>${escape(row.entry.sourceName)}</strong><small>${row.entry.kind}${row.entry.partial ? ` · ${t("Partial")}` : ""}${row.entry.fallbackTextSegments ? ` · ${t("Fallbacks").replace("{count}", String(row.entry.fallbackTextSegments))}` : ""}</small></div><span title="${escape(row.detail)}">${t(`State.${row.state}`)}</span></li>`).join("")}</ul>
      <button type="button" class="ft-button ft-button--primary" data-bundle-import ${plan.rows.some((r) => r.state === "ready") || plan.glossary.length ? "" : "disabled"}><i class="fa-solid fa-file-import" aria-hidden="true"></i>${t("Import")}</button>
    </section>` : ""}
    <p class="ft-bundles__status" role="status" aria-live="polite" data-bundle-status>${t("Ready")}</p>
    <details data-bundle-issues hidden><summary>${t("Details")}</summary><pre></pre></details>`;
  activateHelpTooltips(root);
  return root;
}

function downloadBundle(text: string, language: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `foundry-translate-${language}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export class BundleApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "foundry-translate-bundles", classes: ["foundry-translate", "foundry-translate-bundle-window"],
    position: { width: 720, height: 740 }, window: { title: "FOUNDRY_TRANSLATE.Bundles.Heading", icon: "fa-solid fa-box-archive", resizable: true } };
  #plan: BundleImportPlan | undefined;
  #fileName = "";
  #busy = false;
  protected async _renderHTML(): Promise<HTMLElement> { return renderBundleView(this.#plan, this.#fileName); }
  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void { content.replaceChildren(result); }
  protected async _onRender(): Promise<void> {
    this.element.querySelector("[data-bundle-export]")?.addEventListener("click", () => void this.#run(async () => {
      const language = getTranslatorSettings().targetLanguage;
      const result = await exportTranslationBundle(language, (message) => this.#status(message));
      downloadBundle(JSON.stringify(result.bundle, null, 2), language);
      this.#status(t("Exported").replace("{count}", String(result.bundle.documents.length)).replace("{skipped}", String(result.skipped.length)));
      this.#issues(result.skipped);
    }));
    this.element.querySelector<HTMLInputElement>("[data-bundle-file]")?.addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void this.#run(async () => {
        // Selecting a different file always discards the old import preview.
        this.#plan = undefined;
        this.#fileName = file.name;
        await this.render({ force: true });
        if (file.size > MAX_BUNDLE_BYTES) throw new Error(t("TooLarge"));
        this.#plan = await planBundleImport(parseTranslationBundle(await file.text()));
        await this.render({ force: true });
      });
    });
    this.element.querySelector("[data-bundle-import]")?.addEventListener("click", () => void this.#run(async () => {
      if (!this.#plan) return;
      const result = await importTranslationBundle(this.#plan, (message) => this.#status(message));
      this.#plan = await planBundleImport(this.#plan.bundle);
      await this.render({ force: true });
      this.#status(t("Imported").replace("{count}", String(result.imported)).replace("{skipped}", String(result.skipped)).replace("{glossary}", String(result.glossaryAdded)));
      if (result.issues.length) this.#status(t("ImportIssues").replace("{count}", String(result.imported)).replace("{issues}", String(result.issues.length)), true);
      this.#issues(result.issues);
    }));
    this.#updateControls();
  }
  #updateControls(): void {
    for (const el of this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>("[data-bundle-file],[data-bundle-export],[data-bundle-import]")) {
      const canImport = this.#plan && (this.#plan.rows.some((r) => r.state === "ready") || this.#plan.glossary.length > 0);
      el.disabled = this.#busy || (el.hasAttribute("data-bundle-import") && !canImport);
    }
  }
  async #run(work: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#updateControls();
    this.#issues([]);
    this.#status(t("Working"));
    try { await work(); }
    catch (error) { this.#status(error instanceof Error ? error.message : String(error), true); }
    finally { this.#busy = false; this.#updateControls(); }
  }
  #status(message: string, error = false): void {
    const el = this.element.querySelector<HTMLElement>("[data-bundle-status]");
    if (el) { el.textContent = message; el.dataset.error = String(error); }
  }
  #issues(issues: string[]): void {
    const el = this.element.querySelector<HTMLElement>("[data-bundle-issues]");
    if (el) { el.hidden = !issues.length; el.querySelector("pre")!.textContent = issues.join("\n"); }
  }
}
