import { labelFor } from "./labels";
import { applyBulk, planBulk, type BulkPlan } from "./bulk";
import { findTextMatches, buildSearchIndex, displayParts, searchReviewsAsync, type SearchHit, type SearchIndex } from "./search";
import { button, checkbox, diffText, el, pager, selectControl, t, type PanelHost } from "./elements";

export class ReviewSearchPanel {
  #host: PanelHost;
  #query = ""; #searched = ""; #fuzzy = true; #side: "source" | "translation" = "translation";
  #kind = "all"; #unverified = false; #index: SearchIndex | null = null; #hits: SearchHit[] = [];
  #selected = new Set<string>(); #replacements = new Map<string, string>(); #variant: string | null = null;
  #plan: BulkPlan | null = null; #page = 0; #previewPage = 0; #stop = false;
  constructor(host: PanelHost) { this.#host = host; }
  get dirty(): boolean { return [...this.#replacements.values()].some(Boolean); }
  discard(): void { this.#selected.clear(); this.#replacements.clear(); this.#plan = null; }
  invalidate(keepReplacements = false): void { this.#index = null; this.#hits = []; this.#plan = null; this.#searched = ""; this.#selected.clear(); if (!keepReplacements) this.#replacements.clear(); }
  stop(): void { this.#stop = true; }
  async search(reload = false): Promise<void> {
    if (!this.#query.trim()) return;
    this.#plan = null; this.#stop = false;
    if (!this.#index || reload) this.#index = await buildSearchIndex(this.#host.language(), (done, total) => this.#host.status(t("IndexProgress").replace("{done}", String(done)).replace("{total}", String(total))), () => this.#stop);
      this.#hits = (await searchReviewsAsync(this.#index, this.#query, this.#fuzzy, this.#side, () => this.#stop)).filter(hit => (this.#kind === "all" || hit.document.kind === this.#kind) && (!this.#unverified || !hit.verified));
      this.#searched = this.#query; this.#page = 0; this.#variant = null; this.#selected.clear();
      this.#replacements = new Map([...this.#replacements].filter(([variant]) => this.#hits.some(hit => hit.variant === variant)));
      this.#host.status(t("SearchCount").replace("{hits}", String(this.#hits.length)).replace("{documents}", String(new Set(this.#hits.map(hit => hit.document.uuid)).size)));
  }
  render(): HTMLElement {
    const root = el("section", "ft-workbench__panel"); root.dataset.searchPanel = "";
    const form = el("form", "ft-workbench__searchbar"), query = el("input"); query.type = "search"; query.value = this.#query; query.placeholder = t("GlobalSearchPlaceholder"); query.maxLength = 160; query.setAttribute("aria-label", t("GlobalSearch"));
    query.addEventListener("input", () => {
      this.#query = query.value; this.#plan = null;
      const preview = root.querySelector<HTMLButtonElement>("[data-preview-changes]"); if (preview) preview.disabled = this.#query !== this.#searched;
    });
    form.append(query, button(t("Find"), () => this.#host.run(() => this.search())), button(t("Reindex"), () => this.#host.run(() => this.search(true))));
    form.addEventListener("submit", event => { event.preventDefault(); this.#host.run(() => this.search()); });
    root.append(form);
    const filters = el("div", "ft-workbench__toolbar");
    const changed = () => { this.#plan = null; this.#host.run(() => this.search()); };
    filters.append(checkbox(t("Fuzzy"), this.#fuzzy, value => { this.#fuzzy = value; changed(); }),
      selectControl(t("SearchSide"), this.#side, [["translation", t("Translation")], ["source", t("Original")]], value => { this.#side = value as "source" | "translation"; changed(); }),
      selectControl(t("DocumentType"), this.#kind, [["all", t("AllTypes")], ...["JournalEntry", "Actor", "Item", "Scene", "ActiveEffect"].map(kind => [kind, t(kind)] as [string, string])], value => { this.#kind = value; changed(); }),
      checkbox(t("OnlyUnverified"), this.#unverified, value => { this.#unverified = value; changed(); }));
    root.append(filters);
    const stop = button(t("StopOperation"), () => this.stop()); stop.dataset.reviewStop = ""; stop.hidden = true; root.append(stop);
    if (this.#index?.skipped.length) {
      const details = el("details", "ft-workbench__warning"); details.append(el("summary", "", t("SkippedDocuments").replace("{count}", String(this.#index.skipped.length))));
      for (const skipped of this.#index.skipped) details.append(el("p", "", `${skipped.entry.name}: ${skipped.reason.startsWith("Review.") ? t(skipped.reason.slice(7)) : skipped.reason}`));
      root.append(details);
    }
    if (this.#plan) { form.hidden = true; filters.hidden = true; root.append(this.#preview()); return root; }
    if (!this.#searched) { root.append(el("div", "ft-workbench__empty", t("SearchIntro"))); return root; }
    const layout = el("div", "ft-workbench__split"), variants = el("aside", "ft-workbench__variants"), results = el("div", "ft-workbench__results");
    variants.append(el("h3", "", t("Variants")));
    const counts = new Map<string, SearchHit[]>(); for (const hit of this.#hits) { const items = counts.get(hit.variant) ?? []; items.push(hit); counts.set(hit.variant, items); }
    variants.append(button(t("AllOccurrences"), () => { this.#variant = null; this.#page = 0; this.#host.render(); }));
    for (const [variant, hits] of counts) {
      const card = el("div", "ft-workbench__variant"); card.classList.toggle("is-current", variant === this.#variant);
      const choose = button(`${variant} · ${hits.length}`, () => { this.#variant = variant; this.#page = 0; this.#host.render(); });
      const percentage = Math.round(Math.max(...hits.map(hit => hit.score)) * 100);
      card.append(choose, el("small", "", `${percentage === 100 ? t("ExactSpelling") : t("SimilarSpelling")} · ${percentage}%`));
      if (this.#side === "translation") {
        const eligible = hits.filter(hit => !hit.blocked);
        const label = checkbox(t("SelectVariant"), eligible.length > 0 && eligible.every(hit => this.#selected.has(hit.id)), checked => {
          for (const hit of eligible) { if (checked) this.#selected.add(hit.id); else this.#selected.delete(hit.id); }
          this.#plan = null; this.#host.render();
        });
        (label.querySelector("input")!).disabled = !eligible.length;
        const replacement = el("input"); replacement.type = "text"; replacement.value = this.#replacements.get(variant) ?? ""; replacement.placeholder = t("Replacement"); replacement.setAttribute("aria-label", `${t("Replacement")} · ${variant}`);
        replacement.addEventListener("input", () => { this.#replacements.set(variant, replacement.value); this.#plan = null; });
        card.append(label, replacement);
      }
      variants.append(card);
    }
    const visible = this.#hits.filter(hit => this.#variant === null || hit.variant === this.#variant);
    results.append(el("h3", "", `${t("Occurrences")} · ${visible.length}`));
    if (!visible.length) results.append(el("p", "", t("NoMatches")));
    for (const hit of visible.slice(this.#page * 30, (this.#page + 1) * 30)) {
      const item = el("article", "ft-workbench__hit"), header = el("header");
      if (this.#side === "translation") {
        const check = checkbox(hit.variant, this.#selected.has(hit.id), checked => { if (checked) this.#selected.add(hit.id); else this.#selected.delete(hit.id); this.#plan = null; });
        check.querySelector("input")!.disabled = !!hit.blocked; header.append(check);
      } else header.append(el("strong", "", hit.variant));
      header.append(button(t("OpenPassage"), () => this.#host.run(() => this.#host.open(hit.document.uuid, hit.group, hit.rowId))));
      item.append(header, el("small", "ft-workbench__location", `${hit.document.name} › ${hit.groupName} › ${labelFor(hit.label)}${hit.segment.reference !== null ? ` · ${t("LinkLabel")}` : ""}`));
      const pair = el("div", "ft-workbench__pair");
      for (const [label, value] of [["Original", hit.source], ["Translation", hit.translation]]) {
        const side = el("div"); side.append(el("small", "", t(label!)), highlightExcerpt(value!, hit.variant)); pair.append(side);
      }
      item.append(pair);
      if (hit.blocked) item.append(el("small", "ft-workbench__warning", t(hit.blocked)));
      if (hit.verified) item.append(el("span", "ft-review__badge", t("Verified")));
      results.append(item);
    }
    results.append(pager(visible.length, this.#page, 30, page => { this.#page = page; this.#host.render(); }));
    layout.append(variants, results); root.append(layout);
    if (this.#side === "translation") {
      const preview = button(t("PreviewChanges"), () => this.#host.run(async () => {
      const changes = this.#hits.filter(hit => this.#selected.has(hit.id)).map(hit => ({ hit, replacement: this.#replacements.get(hit.variant) ?? "" }));
      this.#plan = planBulk(this.#index!, changes, `${this.#searched}`); this.#previewPage = 0;
      this.#host.status(t("PreviewReady"));
      }), "ft-workbench__primary");
      preview.dataset.previewChanges = ""; preview.disabled = this.#query !== this.#searched; root.append(preview);
    }
    return root;
  }
  #preview(): HTMLElement {
    const plan = this.#plan!, root = el("div", "ft-workbench__preview"), rows = plan.documents.flatMap(doc => doc.changes.map(change => ({ doc, change })));
    const toolbar = el("div", "ft-workbench__toolbar");
    toolbar.append(button(t("BackToResults"), () => { this.#plan = null; this.#host.render(); }), el("strong", "", t("BatchSummary").replace("{occurrences}", String(plan.occurrences)).replace("{rows}", String(rows.length)).replace("{documents}", String(plan.documents.length))));
    root.append(toolbar);
    const list = el("div", "ft-workbench__results");
    for (const { doc, change } of rows.slice(this.#previewPage * 25, (this.#previewPage + 1) * 25)) {
      const before = doc.snapshot.rows.find(row => row.id === change.rowId)!, article = el("article", "ft-workbench__hit");
      article.append(el("strong", "", `${doc.snapshot.entry.name} › ${doc.snapshot.groups.find(group => group.id === before.group)!.name} › ${labelFor(before.label)}`));
      const source = el("details"); source.append(el("summary", "", t("Original")), el("p", "ft-workbench__excerpt", displayParts(before.source))); article.append(source);
      const pair = el("div", "ft-workbench__pair"), old = el("div"), updated = el("div");
      old.append(el("small", "", t("Before")), diffText(displayParts(before.translation), displayParts(change.parts), false));
      updated.append(el("small", "", t("After")), diffText(displayParts(before.translation), displayParts(change.parts), true));
      pair.append(old, updated); article.append(pair); list.append(article);
    }
    list.append(pager(rows.length, this.#previewPage, 25, page => { this.#previewPage = page; this.#host.render(); })); root.append(list);
    root.append(el("p", "ft-workbench__warning", t("BatchWarning")));
    root.append(button(t("ApplySelected"), () => this.#host.run(async () => {
      this.#stop = false;
      try {
        const result = await applyBulk(plan, (done, total) => this.#host.status(t("BatchProgress").replace("{done}", String(done)).replace("{total}", String(total))), () => this.#stop);
        this.#host.status(`${t("BatchDone").replace("{done}", String(result.completed.length)).replace("{total}", String(plan.documents.length))}${result.error ? ` · ${result.error.startsWith("Review.") ? t(result.error.slice(7)) : result.error}` : ""}`, !!result.error);
      } finally { this.invalidate(); }
    }), "ft-workbench__primary"));
    return root;
  }
}

function highlightExcerpt(value: string, phrase: string): HTMLElement {
  const p = el("p", "ft-workbench__excerpt"); let end = 0;
  for (const match of findTextMatches(value, phrase)) {
    p.append(document.createTextNode(value.slice(end, match.start)), el("mark", "", value.slice(match.start, match.end))); end = match.end;
  }
  p.append(document.createTextNode(value.slice(end))); return p;
}
