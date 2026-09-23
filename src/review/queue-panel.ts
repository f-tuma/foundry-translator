import { button, el, pager, selectControl, t, type PanelHost } from "./elements";
import { buildSearchIndex, displayParts, type SearchIndex } from "./search";
import { queueItems, readBookmark, type QueueFilter, type ReviewBookmark } from "./editorial";

export class EditorialQueuePanel {
  #index: SearchIndex | null = null;
  #filter: QueueFilter = "unverified";
  #page = 0;
  #cancelled = false;
  constructor(private host: PanelHost) {}
  stop(): void { this.#cancelled = true; }
  invalidate(): void { this.#index = null; }
  async scan(): Promise<void> {
    this.#cancelled = false;
    this.#index = await buildSearchIndex(this.host.language(), (done, total) => this.host.status(`${t("Indexing")} ${done} / ${total}`), () => this.#cancelled);
  }
  async next(after?: ReviewBookmark): Promise<void> {
    await this.scan();
    const all = this.#index!.snapshots.flatMap(snapshot => snapshot.groups.flatMap(group => snapshot.rows.filter(row => row.group === group.id).map(row => ({ entry: snapshot.entry, row }))));
    const start = after ? all.findIndex(item => item.entry.uuid === after.uuid && item.entry.sourceUuid === after.sourceUuid && item.row.id === after.rowId) : -1;
    const ordered = [...all.slice(start + 1), ...all.slice(0, start + 1)];
    const next = ordered.find(item => !item.row.blocked && !item.row.verified && !(item.entry.uuid === after?.uuid && item.row.id === after?.rowId));
    if (next) await this.host.open(next.entry.uuid, next.row.group, next.row.id);
    this.host.status([next ? t("QueueOpened") : t("QueueEnd"), this.#index!.skipped.length ? t("QueueSkipped").replace("{count}", String(this.#index!.skipped.length)) : ""].filter(Boolean).join(" "));
  }
  render(): HTMLElement {
    const root = el("section", "ft-workbench__panel");
    const controls = el("div", "ft-workbench__toolbar");
    controls.append(button(t("QueueRefresh"), () => this.host.run(async () => { await this.scan(); this.#page = 0; })),
      selectControl(t("QueueFilter"), this.#filter, [["unverified", t("NeedsReview")], ["discussion", t("EditorialDiscussion")], ["meaning", t("EditorialMeaning")], ["notes", t("EditorialNotes")]], value => { this.#filter = value as QueueFilter; this.#page = 0; this.host.render(); }));
    const stop = button(t("StopSearch"), () => this.stop()); stop.dataset.reviewStop = ""; stop.hidden = true; controls.append(stop); root.append(controls);
    if (!this.#index) { root.append(el("p", "", t("QueueStart"))); return root; }
    for (const skip of this.#index.skipped) root.append(el("p", "ft-review__warning", `${skip.entry.name} · ${skip.reason.startsWith("Review.") ? t(skip.reason.slice(7)) : skip.reason}`));
    const blocked = this.#index.snapshots.reduce((sum, snapshot) => sum + snapshot.rows.filter(row => row.blocked).length, 0);
    if (blocked) root.append(el("p", "ft-review__warning", t("QueueBlocked").replace("{count}", String(blocked))));
    const items = queueItems(this.#index, this.#filter), size = 20;
    this.#page = Math.min(this.#page, Math.max(0, Math.ceil(items.length / size) - 1));
    root.append(el("p", "", t("QueueCount").replace("{count}", String(items.length))));
    const list = el("div", "ft-workbench__results");
    for (const { entry, row, groupName } of items.slice(this.#page * size, (this.#page + 1) * size)) {
      const card = el("article", "ft-editorial__card"), heading = el("header");
      heading.append(el("strong", "", `${entry.name} · ${groupName}`), button(t("OpenPassage"), () => this.host.run(() => this.host.open(entry.uuid, row.group, row.id))));
      card.append(heading);
      const pair = el("div", "ft-editorial__pair"); for (const [title, parts] of [["Original", row.source], ["Translation", row.translation]] as const) { const column = el("div"); column.append(el("small", "", t(title)), el("p", "", displayParts(parts))); pair.append(column); } card.append(pair);
      if (row.editorial) {
        if (row.editorial.state !== "none") card.append(el("strong", "", t(row.editorial.state === "discussion" ? "EditorialDiscussion" : "EditorialMeaning")));
        if (row.editorial.note) card.append(el("p", "ft-editorial__note", row.editorial.note));
        if (row.editorial.fingerprint !== row.fingerprint) card.append(el("small", "ft-review__warning", t("EditorialStale")));
      }
      list.append(card);
    }
    root.append(list, pager(items.length, this.#page, size, page => { this.#page = page; this.host.render(); })); return root;
  }
  async resume(): Promise<void> {
    const mark = readBookmark(this.host.language());
    if (!mark) throw new Error("Review.BookmarkMissing");
    // host.open validates both the live document and the row before changing selection.
    await this.host.open(mark.uuid, mark.group, mark.rowId);
  }
}
