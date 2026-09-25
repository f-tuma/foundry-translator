import { EditorialQueuePanel } from "./queue-panel";
import { ReviewContextPanel, noteFor, type NoteDraft } from "./context-panel";
import { readBookmark, saveBookmark } from "./editorial";
import { NameConsistencyPanel } from "./name-panel";
import { labelFor } from "./labels";
import { ReviewSearchPanel } from "./search-panel";
import { UiReviewPanel } from "./ui-panel";
import { ReviewHistoryPanel } from "./history-panel";
import { resolveReviewTarget } from "./target";
import { LocalReviewDrafts, documentDraft, draftFor, recoverText, textPayload, type TextDraft } from "./drafts";
import { RecoveryPanel, previewRecovery, type RecoveryPreview } from "./recovery-panel";
import { EditorialProjectPanel } from "./project-panel";
import type { PanelHost } from "./elements";
import { getTranslatorSettings } from "../settings/settings";
import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import { loadReview, reviewCatalog, updateReview, type ReviewDocument, type ReviewRow, type ReviewSnapshot } from "./service";
import { maskReviewParts, restoreReviewParts } from "./text-plan";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Review.${key}`);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const button = (label: string, action: () => void): HTMLButtonElement => {
  const node = el("button", "", label); node.type = "button"; node.addEventListener("click", action); return node;
};

export class TranslationReviewApplication extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "foundry-translate-review", classes: ["foundry-translate", "ft-review-window"],
    position: { width: 1240, height: 850 }, window: { title: "FOUNDRY_TRANSLATE.Review.Title", icon: "fa-solid fa-list-check", resizable: true } };
  #catalog: ReviewDocument[] | null = null;
  #snapshot: ReviewSnapshot | null = null;
  #group = "document";
  #noteDrafts = new Map<string, NoteDraft>();
  #selectedRow: string | undefined;
  #contextVisible = false;
  #drafts = new Map<string, TextDraft>();
  #draftWarning = "";
  #localDrafts = new LocalReviewDrafts(() => getTranslatorSettings().targetLanguage, key => {
    this.#draftWarning = t(key); const warning = this.element?.querySelector<HTMLElement>("[data-draft-warning]");
    if (warning) { warning.textContent = this.#draftWarning; warning.hidden = false; }
  });
  #busy = false;
  #onlyUnverified = false;
  #search = "";
  #message = "";
  #error = false;
  #scrollTop = 0;
  #mode: "documents" | "search" | "interface" | "history" | "names" | "queue" | "recovery" | "project" = "documents";
  #focusRow: string | undefined;
  #host: PanelHost = {
    run: action => { void this.#run(action); }, render: () => { void this.render({ force: true }); },
    status: (message, error) => this.#status(message, error), language: () => getTranslatorSettings().targetLanguage,
    open: (uuid, group, rowId) => this.#selectDocument(uuid, group, rowId),
    find: async query => { await this.#searchPanel.openQuery(query); this.#mode = "search"; },
  };
  #queuePanel = new EditorialQueuePanel(this.#host);
  #contextPanel = new ReviewContextPanel();
  #searchPanel = new ReviewSearchPanel(this.#host);
  #uiPanel = new UiReviewPanel(this.#host, this.#localDrafts);
  #recoveryPanel = new RecoveryPanel(this.#host, this.#localDrafts, preview => this.#recover(preview));
  #projectPanel = new EditorialProjectPanel(this.#host, () => this.#hasDrafts(), async () => { this.#catalog = null; this.#snapshot = null; this.#queuePanel.invalidate(); this.#searchPanel.invalidate(); await this.#uiPanel.load(); });
  #namePanel = new NameConsistencyPanel(this.#host);
  #historyPanel = new ReviewHistoryPanel(this.#host);
  #hasDrafts(): boolean { return this.#drafts.size > 0 || this.#noteDrafts.size > 0 || this.#uiPanel.dirty || this.#searchPanel.dirty; }

  async #recover(preview: RecoveryPreview): Promise<void> {
    if (this.#hasDrafts()) throw new Error("Review.UnsavedNavigation");
    const fresh = await previewRecovery(preview.saved, getTranslatorSettings().targetLanguage);
    if (fresh.blocked || JSON.stringify(fresh.current) !== JSON.stringify(preview.current) || fresh.snapshot?.guard.fingerprint !== preview.snapshot?.guard.fingerprint || JSON.stringify(fresh.ui?.catalog.store) !== JSON.stringify(preview.ui?.catalog.store) || JSON.stringify(fresh.snapshot?.rows.map(row => row.editorial)) !== JSON.stringify(preview.snapshot?.rows.map(row => row.editorial))) throw new Error("Review.Conflict");
    const p = preview.saved.payload;
    if (p.kind === "ui") {
      this.#uiPanel.recover(fresh.ui!, p.value); this.#mode = "interface";
      this.#localDrafts.adopt(preview.saved, { ...p, baseline: fresh.ui!.row.value });
    } else {
      await this.#selectDocument(p.uuid, p.group, p.rowId);
      const row = this.#snapshot!.rows.find(row => row.id === p.rowId)!;
      // A second load in selectDocument must still be the previewed version.
      if (row.blocked || this.#snapshot!.sourceHash !== fresh.snapshot!.sourceHash || this.#snapshot!.guard.fingerprint !== fresh.snapshot!.guard.fingerprint || JSON.stringify(row.editorial) !== JSON.stringify(fresh.snapshot!.rows.find(item => item.id === p.rowId)?.editorial)) throw new Error("Review.Conflict");
      if (p.kind === "text") this.#drafts.set(row.id, recoverText(p));
      else this.#noteDrafts.set(row.id, { state: p.state, note: p.note });
      this.#localDrafts.adopt(preview.saved, { ...p, ...documentDraft(this.#snapshot!, row), ...(p.kind === "note" ? { baselineNote: row.editorial ?? null } : {}) });
    }
    this.#status(t("DraftRecovered"));
  }
  #clearDraft(kind: "text" | "note", rowId: string): void { if (this.#snapshot) this.#localDrafts.clear(`${kind}:${this.#snapshot.entry.uuid}:${rowId}`); }

  #watchingUnload = false;
  #beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.#hasDrafts() && !this.#busy) return;
    event.preventDefault(); event.returnValue = "";
  };
  async openAt(uuid: string, group?: string, rowId?: string): Promise<void> {
    if (this.#busy) { this.#status(t("Working"), true); return; }
    this.#busy = true;
    try { await this.#selectDocument(uuid, group, rowId); }
    finally { this.#busy = false; }
    await this.render({ force: true });
  }
  async #selectDocument(uuid: string, group?: string, rowId?: string): Promise<void> {
    if (this.#drafts.size || this.#noteDrafts.size) throw new Error("Review.UnsavedNavigation");
    this.#catalog = await reviewCatalog(getTranslatorSettings().targetLanguage);
    const target = resolveReviewTarget(this.#catalog, uuid);
    if (!target) throw new Error("Review.TranslationMissing");
    const next = await loadReview(target.entry);
    if (rowId && !next.rows.some(row => row.id === rowId)) throw new Error("Review.BookmarkMissing");
    this.#snapshot = next; this.#group = group ?? target.group;
    this.#selectedRow = rowId; this.#contextVisible = !!rowId;
    if (rowId) { const row = next.rows.find(row => row.id === rowId)!; saveBookmark(next.entry, row); await this.#contextPanel.load(); }
    this.#status(""); this.#focusRow = rowId; this.#mode = "documents"; this.#search = ""; this.#onlyUnverified = false; this.#scrollTop = 0;
  }

  async close(options?: Record<string, unknown>): Promise<FoundryApplicationV2> {
    if (this.#busy || this.#hasDrafts()) {
      this.#status(t(this.#busy ? "Working" : "UnsavedNavigation"), true);
      return this;
    }
    if (typeof window !== "undefined") window.removeEventListener("beforeunload", this.#beforeUnload);
    this.#watchingUnload = false;
    return super.close(options);
  }

  async #run(action: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#scrollTop = this.element.querySelector(".ft-review__scroll")?.scrollTop ?? 0;
    this.element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | HTMLSelectElement>(".ft-review input,.ft-review textarea,.ft-review button,.ft-review select").forEach(input => { input.disabled = true; });
    const stop = this.element.querySelector<HTMLButtonElement>("[data-review-stop]");
    if (stop) { stop.hidden = false; stop.disabled = false; stop.onclick = () => { this.#searchPanel.stop(); this.#namePanel.stop(); this.#queuePanel.stop(); }; }
    this.#status(t("Working"));
    try { await action(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#status(message.startsWith("Review.") ? t(message.slice(7)) : message, true);
    } finally { this.#busy = false; if (this.#message === t("Working")) this.#status(""); this.#historyPanel.invalidate(); await this.render({ force: true }); }
  }

  #status(message: string, error = false): void {
    this.#message = message; this.#error = error;
    const node = this.element?.querySelector<HTMLElement>("[data-review-status]");
    if (node) { node.textContent = message; node.classList.toggle("ft-review__error", error); }
  }
  #canNavigate(): boolean {
    if (!this.#drafts.size && !this.#noteDrafts.size) return true;
    this.#status(t("UnsavedNavigation"), true); return false;
  }
  #counts(): string {
    const rows = this.#snapshot?.rows ?? [];
    return t("Progress").replace("{verified}", String(rows.filter(row => row.verified).length)).replace("{total}", String(rows.filter(row => !row.blocked).length));
  }

  protected async _renderHTML(): Promise<HTMLElement> {
    const root = el("section", "ft-review");
    root.addEventListener("keydown", event => this.#shortcut(event));
    const header = el("header", "ft-review__header");
    const heading = el("div", "ft-heading-with-help");
    heading.append(el("h2", "", t("Heading")));
    const help = el("span"); help.innerHTML = renderHelpTooltip(t("Help"), t("Heading")); heading.append(help);
    header.append(heading);
    const tabs = el("div", "ft-workbench__tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", t("Workspaces"));
    const savedDrafts = this.#localDrafts.list();
    for (const [mode, label] of [["documents", "Documents"], ["queue", "Queue"], ["search", "GlobalSearch"], ["names", "NameConsistency"], ["interface", "Interface"], ["history", "History"], ["recovery", "Recovery"], ["project", "Project"]] as const) {
      const tab = button(t(label), () => {
        void this.#run(async () => {
          this.#mode = mode; this.#scrollTop = 0;
          if (mode === "queue") this.#queuePanel.invalidate();
          if (mode === "history") this.#historyPanel.invalidate();
          if (mode === "names") this.#namePanel.invalidate();
          if (mode === "documents" && this.#snapshot && !this.#drafts.size && !this.#noteDrafts.size) this.#snapshot = await loadReview(this.#snapshot.entry);
        });
      });
      if (mode === "recovery" && savedDrafts.length) tab.textContent += ` (${savedDrafts.length})`;
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(this.#mode === mode)); tab.classList.toggle("is-current", this.#mode === mode); tabs.append(tab);
    }
    header.append(tabs);
    const draftWarning = el("p", "ft-review__error", this.#draftWarning); draftWarning.dataset.draftWarning = ""; draftWarning.hidden = !this.#draftWarning; header.append(draftWarning);
    if (this.#mode !== "documents") {
      root.append(header);
      try { root.append(this.#mode === "project" ? this.#projectPanel.render() : this.#mode === "recovery" ? this.#recoveryPanel.render() : this.#mode === "queue" ? this.#queuePanel.render() : this.#mode === "search" ? this.#searchPanel.render() : this.#mode === "interface" ? await this.#uiPanel.render() : this.#mode === "names" ? this.#namePanel.render() : await this.#historyPanel.render()); }
      catch (error) { this.#message = String(error); this.#error = true; }
      root.append(this.#footer()); activateHelpTooltips(root); return root;
    }
    if (!this.#catalog) {
      try {
        this.#catalog = await reviewCatalog(getTranslatorSettings().targetLanguage);
        if (this.#catalog[0]) this.#snapshot = await loadReview(this.#catalog[0]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#message = message.startsWith("Review.") ? t(message.slice(7)) : message; this.#error = true;
        this.#catalog ??= [];
      }
    }
    const controls = el("div", "ft-review__controls");
    const documentLabel = el("label", "ft-review__document", t("Document"));
    const select = el("select"); select.setAttribute("aria-label", t("Document"));
    for (const entry of this.#catalog) {
      const option = el("option", "", `${t(entry.kind)} · ${entry.name}`); option.value = entry.uuid;
      option.selected = entry.uuid === this.#snapshot?.entry.uuid; select.append(option);
    }
    select.addEventListener("change", () => {
      if (!this.#canNavigate()) { select.value = this.#snapshot?.entry.uuid ?? ""; return; }
      const entry = this.#catalog!.find(entry => entry.uuid === select.value);
      if (entry) void this.#run(async () => { this.#snapshot = await loadReview(entry); this.#selectedRow = undefined; this.#contextVisible = false; this.#group = "document"; this.#scrollTop = 0; this.#search = ""; this.#status(""); });
    });
    documentLabel.append(select); controls.append(documentLabel);
    controls.append(button(t("Refresh"), () => {
      if (!this.#canNavigate()) return;
      void this.#run(async () => {
        this.#contextPanel.invalidate();
        if (this.#contextVisible) await this.#contextPanel.load();
        this.#catalog = await reviewCatalog(getTranslatorSettings().targetLanguage);
        const entry = this.#catalog.find(entry => entry.uuid === this.#snapshot?.entry.uuid) ?? this.#catalog[0];
        this.#snapshot = entry ? await loadReview(entry) : null; this.#status(t("Refreshed"));
      });
    }));
    const next = button(t("QueueNext"), () => this.#next()); next.dataset.reviewNext = "";
    const resume = button(t("QueueResume"), () => { if (this.#canNavigate()) void this.#run(() => this.#queuePanel.resume()); });
    resume.dataset.reviewResume = ""; resume.disabled = !readBookmark(getTranslatorSettings().targetLanguage);
    const shortcuts = el("span"); shortcuts.innerHTML = renderHelpTooltip(t("ShortcutHelp"), t("Shortcuts"));
    controls.append(next, resume, shortcuts);
    const stop = button(t("StopSearch"), () => this.#queuePanel.stop()); stop.dataset.reviewStop = ""; stop.hidden = true; controls.append(stop);
    header.append(controls); root.append(header);
    const filters = el("div", "ft-review__filters");
    const search = el("input"); search.type = "search"; search.placeholder = t("Search"); search.setAttribute("aria-label", t("Search")); search.value = this.#search;
    search.addEventListener("input", () => { this.#search = search.value; this.#applyFilters(root); });
    const label = el("label"); const checkbox = el("input"); checkbox.type = "checkbox"; checkbox.checked = this.#onlyUnverified;
    checkbox.addEventListener("change", () => { this.#onlyUnverified = checkbox.checked; this.#applyFilters(root); });
    label.append(checkbox, document.createTextNode(t("OnlyUnverified")));
    filters.append(search, label, el("span", "ft-review__progress", this.#counts())); root.append(filters);
    if (this.#snapshot?.warning) root.append(el("p", "ft-review__warning", t(this.#snapshot.warning)));
    else if (this.#snapshot?.partial) root.append(el("p", "ft-review__warning", t(this.#snapshot.protection === "tracked" ? "ProtectedPartial" : this.#snapshot.protection === "untracked" ? "UntrackedPartial" : "PartialWarning")));
    const layout = el("div", "ft-review__layout");
    const nav = el("nav", "ft-review__nav"); nav.setAttribute("aria-label", t("Sections"));
    const groups = this.#snapshot?.groups ?? [];
    if (!groups.some(group => group.id === this.#group)) this.#group = groups[0]?.id ?? "document";
    for (const group of groups) {
      const rows = this.#snapshot!.rows.filter(row => row.group === group.id);
      const item = button("", () => { this.#group = group.id; this.#selectedRow = undefined; this.#contextVisible = false; this.#scrollTop = 0; void this.render({ force: true }); });
      item.classList.toggle("is-current", group.id === this.#group); item.setAttribute("aria-current", group.id === this.#group ? "true" : "false");
      const ready = rows.filter(row => !row.blocked).length;
      item.append(el("span", "", group.id === "document" ? t("DocumentDetails") : group.name), el("small", "", ready ? `${rows.filter(row => row.verified).length} / ${ready}` : t("Pending")));
      nav.append(item);
    }
    const main = el("div", "ft-review__scroll");
    main.append(el("h3", "ft-review__section-title", groups.find(group => group.id === this.#group)?.name ?? t("Empty")));
    const table = el("table", "ft-review__table");
    const thead = el("thead"), headers = el("tr");
    for (const key of ["Original", "Translation", "Review"]) { const th = el("th", "", t(key)); th.scope = "col"; headers.append(th); }
    thead.append(headers); table.append(thead);
    const body = el("tbody"); let lastField = "";
    for (const row of this.#snapshot?.rows.filter(row => row.group === this.#group) ?? []) {
      if (row.fieldId !== lastField) {
        const field = el("tr", "ft-review__field"); field.dataset.fieldId = row.fieldId;
        const th = el("th", "", labelFor(row.label)); th.colSpan = 3; th.scope = "rowgroup"; field.append(th); body.append(field); lastField = row.fieldId;
      }
      body.append(this.#row(row));
    }
    table.append(body); main.append(table);
    const empty = el("p", "ft-review__empty", this.#snapshot ? t("NoMatches") : t("Empty")); empty.dataset.reviewEmpty = ""; main.append(empty);
    layout.append(nav, main);
    const selected = this.#snapshot?.rows.find(row => row.id === this.#selectedRow);
    if (this.#contextVisible && selected) { layout.classList.add("has-context"); layout.append(this.#context(selected)); }
    root.append(layout);
    root.append(this.#footer());
    this.#applyFilters(root); activateHelpTooltips(root); return root;
  }
  #footer(): HTMLElement {
    const footer = el("footer", "ft-review__footer");
    const status = el("p", this.#error ? "ft-review__error" : "", this.#message); status.dataset.reviewStatus = ""; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const dirty = el("span", "", (this.#drafts.size + this.#noteDrafts.size) ? t("UnsavedCount").replace("{count}", String(this.#drafts.size + this.#noteDrafts.size)) : ""); dirty.dataset.reviewDirtyCount = "";
    const discard = button(t("DiscardAll"), () => { for (const id of this.#drafts.keys()) this.#clearDraft("text", id); for (const id of this.#noteDrafts.keys()) this.#clearDraft("note", id); this.#drafts.clear(); this.#noteDrafts.clear(); this.#uiPanel.discard(); this.#searchPanel.discard(); this.#status(t("Discarded")); void this.render({ force: true }); });
    discard.dataset.reviewDiscard = ""; footer.append(status, dirty, discard); return footer;
  }

  #row(row: ReviewRow): HTMLTableRowElement {
    const tr = el("tr", row.heading ? "ft-review__row is-heading" : "ft-review__row"); tr.dataset.reviewRow = row.id; tr.classList.toggle("is-target", row.id === this.#selectedRow);
    tr.addEventListener("focusin", () => this.#remember(row)); tr.dataset.fieldId = row.fieldId;
    const original = el("td", "ft-review__original"), translated = el("td", "ft-review__translation"), actions = el("td", "ft-review__actions");
    original.setAttribute("data-label", t("Original")); translated.setAttribute("data-label", t("Translation")); actions.setAttribute("data-label", t("Review"));
    const source = maskReviewParts(row.source);
    for (const [index, part] of source.text.entries()) {
      const masked = { text: part, references: source.references[index]! }; const text = el("p", "", masked.text);
      original.append(text);
      for (const ref of masked.references) original.append(el("small", "ft-review__reference", `${ref.marker} ${ref.label || t("LinkedDocument")}`));
    }
    const draft = this.#drafts.get(row.id) ?? draftFor(row);
    const changed = () => {
      this.#drafts.set(row.id, draft);
      if (JSON.stringify(draft) === JSON.stringify(draftFor(row))) this.#drafts.delete(row.id);
      if (this.#drafts.has(row.id)) this.#localDrafts.write(textPayload(this.#snapshot!, row, draft)); else this.#clearDraft("text", row.id);
      this.#updateRowState(tr, row);
      const discard = this.element.querySelector<HTMLButtonElement>("[data-review-discard]"); if (discard) discard.disabled = !this.#drafts.size && !this.#noteDrafts.size;
      const count = this.element.querySelector("[data-review-dirty-count]"); if (count) count.textContent = (this.#drafts.size + this.#noteDrafts.size) ? t("UnsavedCount").replace("{count}", String(this.#drafts.size + this.#noteDrafts.size)) : "";
    };
    draft.text.forEach((text, index) => {
      const input = el("textarea"); input.value = text; input.rows = Math.max(2, Math.min(12, Math.ceil(text.length / 48)));
      input.disabled = !!row.blocked; input.lang = this.#snapshot!.entry.language; input.spellcheck = true;
      input.setAttribute("aria-label", `${t("Translation")} · ${labelFor(row.label)} · ${index + 1}`);
      input.addEventListener("input", () => { draft.text[index] = input.value; changed(); this.#grow(input); });
      input.addEventListener("focus", () => { original.querySelectorAll("p").forEach((p, i) => p.classList.toggle("is-focused", i === index)); });
      input.addEventListener("blur", () => { original.querySelectorAll("p").forEach(p => p.classList.remove("is-focused")); });
      translated.append(input);
    });
    if (draft.references.some(parts => parts.length)) {
      const help = el("div", "ft-review__reference-help");
      help.innerHTML = renderHelpTooltip(t("ReferenceHelp"), t("LinkLabel")); translated.append(help);
    }
    for (const reference of draft.references.flat()) {
        const label = el("label", "ft-review__reference", `${reference.marker} ${t("LinkLabel")}`);
        if (reference.editable) {
          const name = el("input"); name.type = "text"; name.value = reference.label; name.placeholder = t("AutomaticLabel"); name.setAttribute("aria-label", `${reference.marker} ${t("LinkLabel")}`); name.disabled = !!row.blocked;
          name.addEventListener("input", () => { reference.label = name.value; changed(); }); label.append(name);
        } else label.append(el("span", "", t("ProtectedCommand")));
        translated.append(label);
    }
    const validation = el("p", "ft-review__error"); validation.dataset.referenceError = ""; validation.setAttribute("role", "status"); translated.append(validation);
    const status = el("span", "ft-review__badge"); status.dataset.rowStatus = ""; actions.append(status);
    actions.append(button(t("Context"), () => void this.#run(async () => { await this.#contextPanel.load(); this.#contextVisible = true; this.#remember(row); this.#focusRow = row.id; })));
    if (row.editorial?.state && row.editorial.state !== "none") actions.append(el("small", "ft-review__warning", t(row.editorial.state === "discussion" ? "EditorialDiscussion" : "EditorialMeaning")));
    if (row.protected) actions.append(el("small", "ft-review__protected", t("ProtectedRow")));
    if (row.blocked) actions.append(el("small", "ft-review__reason", t(row.blocked)));
    else {
      const save = button(t("Save"), () => void this.#run(async () => {
        const current = this.#drafts.get(row.id); if (!current) return;
        const parts = restoreReviewParts(current);
        this.#snapshot = await updateReview(this.#snapshot!, row.id, { type: "save", parts });
        this.#clearDraft("text", row.id); this.#drafts.delete(row.id); this.#searchPanel.invalidate(true); this.#status(t("Saved"));
      })); save.dataset.reviewSave = "";
      const verify = button(row.verified ? t("Unverify") : t("Verify"), () => void this.#run(async () => {
        this.#snapshot = await updateReview(this.#snapshot!, row.id, { type: row.verified ? "unverify" : "verify" });
        this.#status(t(row.verified ? "Unverified" : "Verified"));
      })); verify.dataset.reviewVerify = "";
      const discard = button(t("Discard"), () => { this.#scrollTop = this.element.querySelector(".ft-review__scroll")?.scrollTop ?? 0; this.#clearDraft("text", row.id); this.#drafts.delete(row.id); void this.render({ force: true }); }); discard.dataset.reviewDiscardRow = "";
      actions.append(save, verify, discard);
    }
    tr.append(original, translated, actions); this.#updateRowState(tr, row); return tr;
  }

  #updateRowState(tr: HTMLElement, row: ReviewRow): void {
    const draft = this.#drafts.get(row.id), dirty = !!draft;
    let invalid = false;
    if (draft) { try { restoreReviewParts(draft); } catch { invalid = true; } }
    const error = tr.querySelector<HTMLElement>("[data-reference-error]");
    if (error) { error.textContent = invalid ? t("ReferenceChanged") : ""; error.hidden = !invalid; }
    for (const input of tr.querySelectorAll("textarea")) input.setAttribute("aria-invalid", String(invalid));
    tr.classList.toggle("is-dirty", dirty); tr.classList.toggle("is-verified", !!row.verified && !dirty);
    const status = tr.querySelector<HTMLElement>("[data-row-status]")!;
    status.textContent = t(dirty ? "Unsaved" : row.blocked ? "Unavailable" : row.verified ? "Verified" : "NeedsReview");
    status.title = row.verified ? `${row.verified.importedAt ? `${t("ImportedVerification")} · ` : ""}${row.verified.userName} · ${new Date(row.verified.at).toLocaleString()}` : "";
    if (row.verified?.importedAt && !dirty) status.textContent = t("ImportedVerification");
    const save = tr.querySelector<HTMLButtonElement>("[data-review-save]"); if (save) { save.disabled = !dirty || invalid; save.hidden = !dirty; }
    const verify = tr.querySelector<HTMLButtonElement>("[data-review-verify]"); if (verify) { verify.disabled = dirty; verify.title = dirty ? t("SaveFirst") : ""; }
    const discard = tr.querySelector<HTMLButtonElement>("[data-review-discard-row]"); if (discard) discard.hidden = !dirty;
  }
  #remember(row: ReviewRow): void {
    this.#selectedRow = row.id; saveBookmark(this.#snapshot!.entry, row);
    const resume = this.element.querySelector<HTMLButtonElement>("[data-review-resume]"); if (resume) resume.disabled = !readBookmark(this.#snapshot!.entry.language);
    this.element.querySelectorAll<HTMLElement>("[data-review-row]").forEach(node => node.classList.toggle("is-target", node.dataset.reviewRow === row.id));
    const context = this.element.querySelector("[data-review-context]");
    if (context && context.getAttribute("data-row-id") !== row.id) context.replaceWith(this.#context(row));
  }
  #context(row: ReviewRow): HTMLElement {
    const draft = this.#noteDrafts.get(row.id) ?? noteFor(row);
    const root = this.#contextPanel.render(this.#snapshot!, row, draft, {
      change: value => {
        if (JSON.stringify(value) === JSON.stringify(noteFor(row))) this.#noteDrafts.delete(row.id); else this.#noteDrafts.set(row.id, value);
        if (this.#noteDrafts.has(row.id)) this.#localDrafts.write({ ...documentDraft(this.#snapshot!, row), kind: "note", baselineNote: row.editorial ?? null, ...value }); else this.#clearDraft("note", row.id);
        const count = this.element.querySelector("[data-review-dirty-count]"); if (count) count.textContent = this.#drafts.size + this.#noteDrafts.size ? t("UnsavedCount").replace("{count}", String(this.#drafts.size + this.#noteDrafts.size)) : "";
        const discard = this.element.querySelector<HTMLButtonElement>("[data-review-discard]"); if (discard) discard.disabled = !this.#hasDrafts();
      },
      save: () => void this.#run(async () => {
        this.#snapshot = await updateReview(this.#snapshot!, row.id, { type: "editorial", ...draft });
        this.#clearDraft("note", row.id); this.#noteDrafts.delete(row.id); this.#queuePanel.invalidate(); this.#status(t("NoteSaved"));
      }),
      discard: () => { this.#clearDraft("note", row.id); this.#noteDrafts.delete(row.id); void this.render({ force: true }); },
      close: () => { this.#contextVisible = false; void this.render({ force: true }); },
      go: next => { this.#remember(next); this.#focusRow = next.id; void this.render({ force: true }); },
      open: uuid => void this.#run(async () => { const doc = await fromUuid(uuid) as { sheet?: { render(options: { force: boolean }): unknown } } | null; if (!doc?.sheet) throw new Error("Review.TranslationMissing"); doc.sheet.render({ force: true }); }),
    });
    root.dataset.rowId = row.id; return root;
  }
  #next(): void {
    if (!this.#canNavigate()) return;
    const row = this.#snapshot?.rows.find(row => row.id === this.#selectedRow);
    const mark = row ? { uuid: this.#snapshot!.entry.uuid, sourceUuid: this.#snapshot!.entry.sourceUuid, rowId: row.id, group: row.group } : undefined;
    void this.#run(() => this.#queuePanel.next(mark));
  }
  #shortcut(event: KeyboardEvent): void {
    if (event.isComposing || event.repeat || this.#mode !== "documents") return;
    const save = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
    const verify = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === "Enter";
    const next = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === "ArrowDown";
    if (!save && !verify && !next) return;
    event.preventDefault(); event.stopPropagation(); if (this.#busy) return;
    if (next) { this.#next(); return; }
    const target = event.target as HTMLElement;
    if (save && target.closest("[data-review-context]")) { this.element.querySelector<HTMLButtonElement>("[data-editorial-save]")?.click(); return; }
    const row = this.#snapshot?.rows.find(row => row.id === this.#selectedRow);
    if (!row || row.blocked || (verify && (row.verified || this.#drafts.has(row.id)))) return;
    const node = [...this.element.querySelectorAll<HTMLElement>("[data-review-row]")].find(node => node.dataset.reviewRow === row.id);
    node?.querySelector<HTMLButtonElement>(save ? "[data-review-save]" : "[data-review-verify]")?.click();
  }
  #applyFilters(root: HTMLElement): void {
    const query = this.#search.trim().toLocaleLowerCase(); let visible = 0;
    for (const node of root.querySelectorAll<HTMLElement>("[data-review-row]")) {
      const row = this.#snapshot?.rows.find(row => row.id === node.dataset.reviewRow);
      const text = row ? [...row.source, ...(this.#drafts.get(row.id)?.text ?? row.translation)].join(" ") : "";
      node.hidden = !row || (!!row.verified && this.#onlyUnverified && !this.#drafts.has(row.id)) || !text.toLocaleLowerCase().includes(query);
      if (!node.hidden) visible += 1;
    }
    for (const field of root.querySelectorAll<HTMLElement>(".ft-review__field")) {
      field.hidden = ![...root.querySelectorAll<HTMLElement>("[data-review-row]")].some(row => !row.hidden && row.dataset.fieldId === field.dataset.fieldId);
    }
    const empty = root.querySelector<HTMLElement>("[data-review-empty]"); if (empty) empty.hidden = visible > 0;
  }
  #grow(input: HTMLTextAreaElement): void { input.style.height = "auto"; input.style.height = `${Math.max(58, input.scrollHeight + 2)}px`; }
  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void { content.replaceChildren(result); }
  protected _onRender(): void {
    if (typeof window !== "undefined" && !this.#watchingUnload) { window.addEventListener("beforeunload", this.#beforeUnload); this.#watchingUnload = true; }
    this.element.querySelectorAll<HTMLTextAreaElement>("textarea").forEach(input => this.#grow(input));
    const scroll = this.element.querySelector(".ft-review__scroll"); if (scroll) scroll.scrollTop = this.#scrollTop;
    if (this.#focusRow) {
      const row = [...this.element.querySelectorAll<HTMLElement>("[data-review-row]")].find(row => row.dataset.reviewRow === this.#focusRow);
      row?.scrollIntoView?.({ block: "center" }); row?.classList.add("is-target"); this.#focusRow = undefined;
    }
  }
}
