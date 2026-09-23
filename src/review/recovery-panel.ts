import { draftIdentity, recoverText, type LocalReviewDrafts, type SavedDraft } from "./drafts";
import { restoreReviewReferences } from "./text-plan";
import { button, diffText, downloadJson, el, t, type PanelHost } from "./elements";
import { loadReview, reviewCatalog, type ReviewSnapshot } from "./service";
import { loadUiCatalog, type UiCatalog, type UiRow } from "./ui-catalog";

export interface RecoveryPreview { saved: SavedDraft; current: string[]; draft: string[]; conflict: boolean; blocked: boolean; snapshot?: ReviewSnapshot; ui?: { catalog: UiCatalog; row: UiRow } }
export async function previewRecovery(saved: SavedDraft, language: string): Promise<RecoveryPreview> {
  const p = saved.payload;
  if (p.kind === "ui") {
    const catalog = await loadUiCatalog(), row = catalog.rows.find(row => row.scope === p.scope && row.key === p.key);
    if (!row) throw new Error("Review.BookmarkMissing");
    return { saved, current: [row.value], draft: [p.value], conflict: row.value !== p.baseline || row.source !== p.source,
      blocked: row.source !== p.source, ui: { catalog, row } };
  }
  const entry = (await reviewCatalog(language)).find(entry => entry.uuid === p.uuid && entry.sourceUuid === p.sourceUuid);
  if (!entry) throw new Error("Review.TranslationMissing");
  const snapshot = await loadReview(entry), row = snapshot.rows.find(row => row.id === p.rowId);
  if (!row) throw new Error("Review.BookmarkMissing");
  const sameSource = snapshot.fields.find(field => field.id === row.fieldId)?.source === p.source;
  let draft: string[];
  if (p.kind === "note") draft = [t(p.state === "meaning" ? "EditorialMeaning" : p.state === "discussion" ? "EditorialDiscussion" : "EditorialNone"), p.note];
  else { try { const text = recoverText(p); draft = text.text.map((part, index) => restoreReviewReferences(part, text.references[index]!)); } catch { draft = p.text; } }
  return { saved, snapshot, blocked: !!row.blocked || !sameSource || row.translation.length !== p.baseline.length,
    conflict: !sameSource || JSON.stringify(row.translation) !== JSON.stringify(p.baseline) || (p.kind === "note" && JSON.stringify(row.editorial ?? null) !== JSON.stringify(p.baselineNote)),
    current: p.kind === "note" ? [t(row.editorial?.state === "meaning" ? "EditorialMeaning" : row.editorial?.state === "discussion" ? "EditorialDiscussion" : "EditorialNone"), row.editorial?.note ?? ""] : row.translation,
    draft };
}
export class RecoveryPanel {
  #preview: RecoveryPreview | null = null;
  constructor(private host: PanelHost, private store: LocalReviewDrafts, private restore: (preview: RecoveryPreview) => Promise<void>) {}
  render(): HTMLElement {
    const root = el("section", "ft-workbench__panel"), list = el("div", "ft-workbench__results");
    root.append(el("p", "ft-workbench__notice", t("RecoveryNotice")));
    if (this.#preview) {
      const preview = this.#preview, box = el("article", "ft-workbench__hit");
      box.append(el("strong", "", t(preview.blocked ? "RecoveryBlocked" : preview.conflict ? "RecoveryConflict" : "RecoveryReady")));
      const pair = el("div", "ft-workbench__pair");
      for (const updated of [false, true]) { const side = el("div"); side.append(el("strong", "", t(updated ? "RecoveredDraft" : "CurrentText")), diffText(preview.current.join("\n"), preview.draft.join("\n"), updated)); pair.append(side); }
      box.append(pair);
      const restore = button(t(preview.conflict ? "RecoverChanged" : "RecoverDraft"), () => this.host.run(async () => { await this.restore(preview); this.#preview = null; })); restore.disabled = preview.blocked;
      box.append(restore, button(t("Cancel"), () => { this.#preview = null; this.host.render(); })); list.append(box);
    }
    const records = this.store.list();
    for (const saved of records) {
      const p = saved.payload, row = el("article", "ft-workbench__hit"), actions = el("div", "ft-workbench__toolbar");
      row.append(el("strong", "", p.kind === "ui" ? `${p.scope} · ${p.key}` : p.name));
      if (p.kind !== "ui" && p.section) row.append(el("p", "ft-workbench__location", p.section));
      row.append(el("p", "ft-workbench__location", `${t(p.kind === "note" ? "EditorialNote" : "Translation")} · ${new Date(saved.at).toLocaleString()}`));
      const discard = button(t("Discard"), () => { this.store.discard(saved); if (this.#preview?.saved.id === saved.id) this.#preview = null; this.host.render(); });
      discard.disabled = this.store.isActive(saved); if (discard.disabled) discard.title = t("SaveFirst");
      actions.append(button(t("Preview"), () => this.host.run(async () => { this.#preview = await previewRecovery(saved, this.host.language()); })),
        button(t("DownloadDraft"), () => downloadJson("foundry-review-draft.json", JSON.stringify(saved, null, 2))), discard);
      row.dataset.draftIdentity = draftIdentity(p); row.append(actions); list.append(row);
    }
    if (!records.length) list.append(el("p", "", t("NoDrafts")));
    root.append(list); return root;
  }
}
