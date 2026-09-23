import { exportUiOverrides, importUiOverrides, loadUiCatalog, previewUiImport, saveUiRow, type UiCatalog, type UiImport, type UiRow, type UiScope } from "./ui-catalog";
import { findTextMatches, normalizeSearch } from "./search";
import { button, checkbox, diffText, downloadJson, el, pager, selectControl, t, type PanelHost } from "./elements";

export class UiReviewPanel {
  #host: PanelHost; #catalog: UiCatalog | null = null; #scope: UiScope = "core";
  #search = ""; #fuzzy = false; #onlyOverrides = false; #unverified = false; #page = 0;
  #drafts = new Map<string, string>(); #import: UiImport | null = null; #reset: string | null = null;
  constructor(host: PanelHost) { this.#host = host; }
  get dirty(): boolean { return this.#drafts.size > 0 || this.#import !== null; }
  discard(): void { this.#drafts.clear(); this.#import = null; this.#reset = null; }
  async load(): Promise<void> { this.#catalog = await loadUiCatalog(); }
  async render(): Promise<HTMLElement> {
    if (!this.#catalog) await this.load();
    const catalog = this.#catalog!, root = el("section", "ft-workbench__panel");
    const toolbar = el("div", "ft-workbench__toolbar");
    toolbar.append(selectControl(t("UiCatalog"), this.#scope, [["core", "Foundry"], ["ember", "Ember"], ["crucible", "Crucible"]], value => { this.#scope = value as UiScope; this.#page = 0; this.#host.render(); }),
      button(t("Refresh"), () => {
        if (this.dirty) { this.#host.status(t("UnsavedNavigation"), true); return; }
        this.#host.run(() => this.load());
      }), button(t("ExportUi"), () => downloadJson(`foundry-ui-cs-${new Date().toISOString().slice(0, 10)}.json`, exportUiOverrides(catalog))));
    const fileLabel = el("label", "ft-workbench__file", t("ImportUi")), file = el("input"); file.type = "file"; file.accept = ".json,application/json";
    file.addEventListener("change", () => {
      const selected = file.files?.[0]; if (!selected) return;
      if (this.#drafts.size) { this.#host.status(t("UnsavedNavigation"), true); return; }
      this.#host.run(async () => { if (selected.size > 10_000_000) throw new Error("Review.UiImportInvalid"); this.#import = previewUiImport(catalog, await selected.text()); });
    }); fileLabel.append(file); toolbar.append(fileLabel); root.append(toolbar);
    root.append(el("p", "ft-workbench__notice", t("UiReloadNotice")));
    for (const error of catalog.errors) root.append(el("p", "ft-workbench__warning", error));
    if (this.#import) { root.append(this.#importPreview()); return root; }
    const searchbar = el("form", "ft-workbench__searchbar"), search = el("input"); search.type = "search"; search.value = this.#search; search.placeholder = t("UiSearch"); search.setAttribute("aria-label", t("UiSearch"));
    search.addEventListener("input", () => { this.#search = search.value; });
    const find = () => { this.#page = 0; this.#host.render(); };
    searchbar.append(search, button(t("Find"), find), checkbox(t("Fuzzy"), this.#fuzzy, value => { this.#fuzzy = value; find(); }));
    searchbar.addEventListener("submit", event => { event.preventDefault(); find(); }); root.append(searchbar);
    const filters = el("div", "ft-workbench__toolbar"); filters.append(checkbox(t("OnlyOverrides"), this.#onlyOverrides, value => { this.#onlyOverrides = value; find(); }), checkbox(t("OnlyUnverified"), this.#unverified, value => { this.#unverified = value; find(); })); root.append(filters);
    const query = normalizeSearch(this.#search.trim());
    const rows = catalog.rows.filter(row => row.scope === this.#scope && (!this.#onlyOverrides || row.override) && (!this.#unverified || !row.verified) &&
      (!query || [row.key, row.source, row.value].some(value => normalizeSearch(value).includes(query) || (this.#fuzzy && findTextMatches(value, this.#search, true).length))));
    const scroll = el("div", "ft-workbench__results"), table = el("table", "ft-review__table ft-ui-review__table"), head = el("thead"), headings = el("tr");
    for (const label of ["Original", "Translation", "Review"]) headings.append(el("th", "", t(label))); head.append(headings); table.append(head);
    const body = el("tbody");
    for (const row of rows.slice(this.#page * 30, (this.#page + 1) * 30)) {
      const id = `${row.scope}:${row.key}`, tr = el("tr"), original = el("td", "ft-review__original"), translation = el("td"), actions = el("td", "ft-review__actions");
      const key = el("details", "ft-ui-review__key"); key.append(el("summary", "", row.key.split(".").slice(-2).join(" › ")), el("code", "", row.key));
      original.append(key, el("p", "", row.source));
      const input = el("textarea"); input.value = this.#drafts.get(id) ?? row.value; input.rows = Math.min(8, Math.max(2, Math.ceil(input.value.length / 52))); input.lang = "cs"; input.spellcheck = true; input.setAttribute("aria-label", `${t("Translation")} · ${row.key}`);
      const save = button(t("Save"), () => this.#host.run(async () => {
        this.#catalog = await saveUiRow(catalog, row, this.#drafts.get(id) ?? row.value, "save"); this.#drafts.delete(id); this.#host.status(t("UiSaved"));
      }));
      const verify = button(t(row.verified ? "Unverify" : "Verify"), () => this.#host.run(async () => { this.#catalog = await saveUiRow(catalog, row, row.value, row.verified ? "unverify" : "verify"); this.#host.status(t(row.verified ? "Unverified" : "Verified")); }));
      const badge = el("span", "ft-review__badge"), changed = () => {
        const dirty = this.#drafts.has(id); badge.textContent = t(dirty ? "Unsaved" : row.blocked ? "Unavailable" : row.verified ? "Verified" : row.override ? "Customized" : "Bundled");
        save.disabled = !dirty; verify.disabled = dirty || row.blocked;
      };
      input.addEventListener("input", () => { if (input.value === row.value) this.#drafts.delete(id); else this.#drafts.set(id, input.value); changed(); });
      translation.append(input);
      if (row.override) { const base = el("details"); base.append(el("summary", "", t("Bundled")), el("p", "ft-workbench__excerpt", row.base)); translation.append(base); }
      actions.append(badge, save, verify);
      if (row.override) actions.append(button(t("ResetOverride"), () => { this.#reset = id; this.#host.render(); }));
      if (this.#reset === id) {
        const reset = el("div", "ft-workbench__reset"); reset.append(el("p", "", t("ResetPreview")), diffText(row.value, row.base, true), button(t("ConfirmReset"), () => this.#host.run(async () => {
          this.#catalog = await saveUiRow(catalog, row, row.base, "reset"); this.#reset = null; this.#drafts.delete(id); this.#host.status(t("UiSaved"));
        })), button(t("Cancel"), () => { this.#reset = null; this.#host.render(); })); translation.append(reset);
      }
      if (row.blocked) actions.append(el("small", "ft-workbench__warning", t("UiSourceChanged")));
      if (row.verified && row.override) badge.title = `${row.override.userName} · ${new Date(row.override.at).toLocaleString()}`;
      changed(); tr.append(original, translation, actions); body.append(tr);
    }
    table.append(body); scroll.append(table);
    if (!rows.length) scroll.append(el("p", "ft-workbench__empty", t("NoMatches")));
    root.append(scroll, pager(rows.length, this.#page, 30, page => { this.#page = page; this.#host.render(); })); return root;
  }
  #importPreview(): HTMLElement {
    const preview = this.#import!, root = el("div", "ft-workbench__preview"), list = el("div", "ft-workbench__results");
    root.append(el("strong", "", t("UiImportSummary").replace("{count}", String(preview.entries.length)).replace("{skipped}", String(preview.skipped))));
    for (const entry of preview.entries) {
      const old = preview.catalog.rows.find(row => row.scope === entry.scope && row.key === entry.key)!, article = el("article", "ft-workbench__hit"), pair = el("div", "ft-workbench__pair");
      article.append(el("strong", "", `${entry.scope} · ${entry.key}`)); pair.append(diffText(old.value, entry.value, false), diffText(old.value, entry.value, true)); article.append(pair); list.append(article);
    }
    root.append(list, button(t("Cancel"), () => { this.#import = null; this.#host.render(); }));
    const apply = button(t("ApplySelected"), () => this.#host.run(async () => { this.#catalog = await importUiOverrides(preview); this.#import = null; this.#host.status(t("UiSaved")); })); apply.disabled = !preview.entries.length; root.append(apply); return root;
  }
}
