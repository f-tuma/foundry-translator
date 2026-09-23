import { reviewHistory, undoReview, type ReviewHistoryDocument } from "./service";
import { displayParts } from "./search";
import { button, diffText, downloadJson, el, pager, t, type PanelHost } from "./elements";

export class ReviewHistoryPanel {
  #host: PanelHost; #history: ReviewHistoryDocument[] | null = null; #page = 0; #confirm: string | null = null;
  constructor(host: PanelHost) { this.#host = host; }
  invalidate(): void { this.#history = null; this.#confirm = null; }
  async render(): Promise<HTMLElement> {
    this.#history ??= await reviewHistory(this.#host.language());
    const root = el("section", "ft-workbench__panel"), toolbar = el("div", "ft-workbench__toolbar");
    toolbar.append(button(t("Refresh"), () => this.#host.run(async () => { this.invalidate(); })), button(t("ExportHistory"), () => downloadJson(`foundry-review-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: "foundry-translate-review-history", version: 1, documents: this.#history }, null, 2))));
    root.append(toolbar);
    const entries = this.#history.flatMap(doc => doc.operations.map(operation => ({ doc, operation }))).sort((a, b) => b.operation.at.localeCompare(a.operation.at));
    const list = el("div", "ft-workbench__results");
    if (!entries.length) list.append(el("p", "ft-workbench__empty", t("HistoryEmpty")));
    for (const { doc, operation } of entries.slice(this.#page * 20, (this.#page + 1) * 20)) {
      const item = el("article", "ft-workbench__hit"), header = el("header");
      header.append(el("strong", "", doc.entry.name), button(t("OpenPassage"), () => this.#host.run(() => this.#host.open(doc.entry.uuid, operation.rows[0]?.group, operation.rows[0]?.rowId))));
      item.append(header, el("small", "", `${new Date(operation.at).toLocaleString()} · ${operation.userName} · ${t("Passages")}: ${operation.rows.length} · ${["Undo", "Correction"].includes(operation.label) ? t(operation.label) : operation.label}`));
      const details = el("details"); details.open = this.#confirm === `${doc.entry.uuid}:${operation.id}`;
      details.append(el("summary", "", t("ShowChanges")));
      for (const row of operation.rows) {
        const pair = el("div", "ft-workbench__pair"); pair.append(diffText(displayParts(row.before), displayParts(row.after), false), diffText(displayParts(row.before), displayParts(row.after), true)); details.append(pair);
      }
      item.append(details);
      if (operation.undoneAt) item.append(el("span", "ft-review__badge", t("Undone")));
      else {
        const id = `${doc.entry.uuid}:${operation.id}`;
        item.append(button(t("Undo"), () => { this.#confirm = id; this.#host.render(); }));
        if (this.#confirm === id) item.append(el("p", "ft-workbench__warning", t("UndoWarning")), button(t("ConfirmUndo"), () => this.#host.run(async () => {
          await undoReview(doc.entry, operation.id); this.invalidate(); this.#host.status(t("UndoDone"));
        })), button(t("Cancel"), () => { this.#confirm = null; this.#host.render(); }));
      }
      list.append(item);
    }
    root.append(list, pager(entries.length, this.#page, 20, page => { this.#page = page; this.#host.render(); })); return root;
  }
}
