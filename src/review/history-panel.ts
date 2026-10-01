import { reviewHistory, undoReview, type ReviewHistoryDocument } from "./service";
import { displayParts } from "./search";
import { button, diffText, downloadJson, el, pager, t, type PanelHost } from "./elements";

export class ReviewHistoryPanel {
  #host: PanelHost; #history: ReviewHistoryDocument[] | null = null; #page = 0; #confirm: string | null = null;
  #loading: AbortController | null = null; #generation = 0; #stopped = false;
  #root: HTMLElement | null = null; #progress = ""; #error = "";
  constructor(host: PanelHost) { this.#host = host; }
  stop(): void {
    this.#generation++; this.#loading?.abort(); this.#loading = null;
    this.#stopped = true; this.#progress = t("HistoryStopped"); this.#paint();
  }
  invalidate(): void {
    this.#generation++; this.#loading?.abort(); this.#loading = null;
    this.#history = null; this.#confirm = null; this.#stopped = false; this.#error = ""; this.#progress = ""; this.#root = null;
  }
  render(): HTMLElement {
    const root = el("section", "ft-workbench__panel"); this.#root = root;
    if (!this.#history && !this.#loading && !this.#stopped && !this.#error) this.#load();
    this.#paint(); return root;
  }
  #load(): void {
    const controller = new AbortController(), generation = ++this.#generation;
    this.#loading = controller;
    void reviewHistory(this.#host.language(), { signal: controller.signal, progress: (done, total) => {
      if (generation !== this.#generation) return;
      this.#progress = t("HistoryLoading").replace("{done}", String(done)).replace("{total}", String(total)); this.#paint();
    } }).then(history => {
      if (generation !== this.#generation) return;
      this.#history = history; this.#loading = null; this.#progress = ""; this.#paint();
    }, error => {
      if (generation !== this.#generation) return;
      this.#loading = null; this.#error = error instanceof Error ? error.message : String(error); this.#paint();
    });
  }
  #paint(): void {
    const root = this.#root; if (!root) return;
    root.replaceChildren();
    const toolbar = el("div", "ft-workbench__toolbar");
    toolbar.append(button(t("Refresh"), () => { this.invalidate(); this.#host.render(); }));
    const exportButton = button(t("ExportHistory"), () => {
      if (!this.#history || this.#loading) return;
      downloadJson(`foundry-review-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: "foundry-translate-review-history", version: 1, documents: this.#history }, null, 2));
    }); exportButton.disabled = !this.#history || !!this.#loading; toolbar.append(exportButton);
    if (this.#loading) toolbar.append(button(t("StopSearch"), () => this.stop()));
    root.append(toolbar);
    if (this.#progress) { const status = el("p", "", this.#progress); status.setAttribute("role", "status"); root.append(status); }
    if (this.#error) root.append(el("p", "ft-review__error", this.#error));
    if (!this.#history) return;
    const entries = this.#history.flatMap(doc => doc.operations.map(operation => ({ doc, operation }))).sort((a, b) => b.operation.at.localeCompare(a.operation.at));
    this.#page = Math.min(this.#page, Math.max(0, Math.ceil(entries.length / 20) - 1));
    const list = el("div", "ft-workbench__results");
    if (!entries.length) list.append(el("p", "ft-workbench__empty", t("HistoryEmpty")));
    for (const { doc, operation } of entries.slice(this.#page * 20, (this.#page + 1) * 20)) {
      const item = el("article", "ft-workbench__hit"), header = el("header");
      header.append(el("strong", "", doc.entry.name), button(t("OpenPassage"), () => this.#host.run(() => this.#host.open(doc.entry.uuid, operation.rows[0]?.group, operation.rows[0]?.rowId))));
      item.append(header, el("small", "", `${new Date(operation.at).toLocaleString()} · ${operation.userName} · ${t("Passages")}: ${operation.rows.length} · ${["Undo", "Correction", "ProjectImport"].includes(operation.label) ? t(operation.label) : operation.label}`));
      const details = el("details"), body = el("div"); let rowPage = 0;
      const paintChanges = () => {
        body.replaceChildren(); if (!details.open) return;
        for (const row of operation.rows.slice(rowPage * 20, (rowPage + 1) * 20)) {
          const pair = el("div", "ft-workbench__pair"); pair.append(diffText(displayParts(row.before), displayParts(row.after), false), diffText(displayParts(row.before), displayParts(row.after), true)); body.append(pair);
        }
        if (operation.rows.length > 20) body.append(pager(operation.rows.length, rowPage, 20, page => { rowPage = page; paintChanges(); }));
      };
      details.open = this.#confirm === `${doc.entry.uuid}:${operation.id}`;
      details.append(el("summary", "", t("ShowChanges")), body);
      details.addEventListener("toggle", paintChanges); if (details.open) paintChanges();
      item.append(details);
      if (operation.undoneAt) item.append(el("span", "ft-review__badge", t("Undone")));
      else {
        const id = `${doc.entry.uuid}:${operation.id}`;
        item.append(button(t("Undo"), () => { this.#confirm = id; this.#paint(); }));
        if (this.#confirm === id) item.append(el("p", "ft-workbench__warning", t("UndoWarning")), button(t("ConfirmUndo"), () => this.#host.run(async () => {
          await undoReview(doc.entry, operation.id); this.invalidate(); this.#host.status(t("UndoDone"));
        })), button(t("Cancel"), () => { this.#confirm = null; this.#paint(); }));
      }
      list.append(item);
    }
    root.append(list, pager(entries.length, this.#page, 20, page => { this.#page = page; this.#paint(); }));
  }
}
