import { renderHelpTooltip } from "../ui/help-tooltip";
import { button, checkbox, diffText, downloadJson, el, pager, t, type PanelHost } from "./elements";
import { MAX_PROJECT_BYTES } from "./project-format";
import { readEditorialFile } from "./community";
import { exportEditorialProject, importEditorialProject, planEditorialProject, uiProjectId, type ProjectDocumentPlan, type ProjectPlan } from "./project";

export class EditorialProjectPanel {
  #plan: ProjectPlan | null = null; #selected = new Set<string>(); #ui = new Set<string>(); #glossary = false;
  #expanded: string | null = null; #page = 0; #detailsPage = 0; #report: string[] = [];
  constructor(private host: PanelHost, private dirty: () => boolean, private changed: () => Promise<void>) {}
  #clean(): void { if (this.dirty()) throw new Error("Review.SaveFirst"); }
  render(): HTMLElement {
    const root = el("section", "ft-workbench__panel ft-project"), toolbar = el("div", "ft-workbench__toolbar"), help = el("span");
    help.innerHTML = renderHelpTooltip(t("ProjectHelp"), t("Project"));
    toolbar.append(button(t("ExportProject"), () => this.host.run(async () => {
      this.#clean(); const result = await exportEditorialProject(this.host.language(), message => this.host.status(message));
      downloadJson(`foundry-editorial-${this.host.language()}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(result.project, null, 2));
      this.#report = result.skipped; this.host.status(t("ProjectExported").replace("{count}", String(result.project.bundle.documents.length)).replace("{skipped}", String(result.skipped.length)));
    })), help);
    const label = el("label", "ft-workbench__file", t("ImportProject")), file = el("input"); file.type = "file"; file.accept = ".json,application/json";
    file.addEventListener("change", () => {
      const selected = file.files?.[0]; if (!selected) return;
      this.host.run(async () => {
        this.#clean(); if (selected.size > MAX_PROJECT_BYTES) throw new Error("Review.ProjectInvalid");
        this.#plan = null; this.#selected.clear(); this.#ui.clear(); this.#glossary = false; this.#page = 0; this.#expanded = null; this.#report = [];
        this.#plan = await planEditorialProject(await readEditorialFile(await selected.text()));
      });
    }); label.append(file); toolbar.append(label); root.append(toolbar);
    for (const issue of this.#report) root.append(el("p", "ft-workbench__warning", issue === "Review.Conflict" ? t("ProjectWriteConflict") : issue.startsWith("Review.") ? t(issue.slice(7)) : issue));
    const plan = this.#plan;
    if (!plan) { root.append(el("p", "ft-workbench__notice", t("ProjectNotice"))); return root; }
    root.append(el("p", "ft-workbench__notice", t("ProjectPreviewNotice")));
    root.append(el("strong", "", t("ProjectLanguage").replace("{language}", plan.project.bundle.targetLanguage.toUpperCase())));
    const glossary = checkbox(t("ProjectGlossary").replace("{count}", String(plan.bundle.glossary.length)), this.#glossary, value => { this.#glossary = value; this.host.render(); });
    root.append(glossary);
    if (plan.bundle.glossaryConflicts.length) root.append(el("p", "ft-workbench__warning", `${t("ProjectGlossaryKept")} ${plan.bundle.glossaryConflicts.join(", ")}`));
    if (plan.ui.skipped || plan.ui.catalog.errors.length) root.append(el("p", "ft-workbench__warning", `${t("ProjectUiSkipped")} ${plan.ui.skipped}. ${plan.ui.catalog.errors.join(" · ")}`));
    const list = el("div", "ft-workbench__results");
    const items = [...plan.documents.map(doc => ({ doc })), ...plan.ui.entries.map(ui => ({ ui }))];
    for (const item of items.slice(this.#page * 20, (this.#page + 1) * 20)) {
      const article = el("article", "ft-workbench__hit");
      if ("doc" in item) {
        const doc = item.doc, check = checkbox(`${doc.name} · ${t(doc.state === "new" ? "ProjectNew" : doc.state === "update" ? "ProjectUpdate" : "Unavailable")}`, this.#selected.has(doc.sourceUuid), value => { if (value) this.#selected.add(doc.sourceUuid); else this.#selected.delete(doc.sourceUuid); this.host.render(); });
        check.querySelector("input")!.disabled = doc.state === "blocked"; article.append(check);
        if (doc.detail) article.append(el("p", "ft-workbench__warning", doc.detail.startsWith("Review.") ? t(doc.detail.slice(7)) : doc.detail));
        article.append(el("small", "", t("ProjectCounts").replace("{changes}", String(doc.state === "new" ? doc.patches.length : doc.changes.length)).replace("{proofs}", String(doc.metadata.filter(row => row.proof).length)).replace("{notes}", String(doc.metadata.filter(row => row.editorial).length))));
        if (doc.skippedMetadata) article.append(el("p", "ft-workbench__warning", t("ProjectMetadataSkipped").replace("{count}", String(doc.skippedMetadata))));
        article.append(button(t("Preview"), () => { this.#expanded = this.#expanded === doc.sourceUuid ? null : doc.sourceUuid; this.#detailsPage = 0; this.host.render(); }));
        if (this.#expanded === doc.sourceUuid) article.append(this.#documentPreview(doc));
      } else {
        const entry = item.ui, id = uiProjectId(entry), current = plan.ui.catalog.rows.find(row => uiProjectId(row) === id)!;
        article.append(checkbox(`${entry.scope} · ${entry.key}`, this.#ui.has(id), value => { if (value) this.#ui.add(id); else this.#ui.delete(id); this.host.render(); }));
        const pair = el("div", "ft-workbench__pair"); pair.append(diffText(current.value, entry.value, false), diffText(current.value, entry.value, true)); article.append(pair);
        if (entry.verified) article.append(el("small", "", `${t("ImportedVerification")} · ${entry.userName} · ${entry.at}`));
      }
      list.append(article);
    }
    root.append(list, pager(items.length, this.#page, 20, page => { this.#page = page; this.host.render(); }));
    const actions = el("div", "ft-workbench__toolbar"), apply = button(t("ApplySelected"), () => this.host.run(async () => {
      this.#clean();
      const result = await importEditorialProject(plan, { documents: [...this.#selected], ui: [...this.#ui], glossary: this.#glossary }, message => this.host.status(message))
        .catch(error => { if (error instanceof Error && error.message === "Review.Conflict") throw new Error("Review.ProjectPreviewChanged"); throw error; });
      this.#plan = null; this.#report = result.issues; await this.changed();
      this.host.status(t("ProjectImported").replace("{documents}", String(result.documents)).replace("{ui}", String(result.ui)).replace("{glossary}", String(result.glossary)), !!result.issues.length);
    })); apply.disabled = !this.#selected.size && !this.#ui.size && !this.#glossary;
    actions.append(apply, button(t("Cancel"), () => { this.#plan = null; this.host.render(); })); root.append(actions); return root;
  }
  #documentPreview(doc: ProjectDocumentPlan): HTMLElement {
    const root = el("div", "ft-project__details");
    const changes = doc.state === "new" ? doc.patches.map(patch => ({ label: patch.path.join(" / "), before: [patch.source], parts: [patch.translation] })) : doc.changes;
    const views: (() => HTMLElement)[] = changes.map(change => () => {
      const row = el("section"), pair = el("div", "ft-workbench__pair"); row.append(el("strong", "", change.label));
      for (const updated of [false, true]) { const side = el("div"); side.append(el("small", "", t(updated ? "ImportedText" : "CurrentText")), diffText(change.before.join("\n"), change.parts.join("\n"), updated)); pair.append(side); }
      row.append(pair); return row;
    });
    for (const meta of doc.metadata) views.push(() => {
      const row = el("section"), current = doc.snapshot?.rows.find(row => row.id === meta.rowId);
      const incoming = doc.reviewText[meta.rowId]!;
      row.append(el("strong", "", incoming.label), el("p", "ft-workbench__excerpt", incoming.parts.join(" ")));
      if (meta.protected) row.append(el("p", "ft-workbench__location", t("ProtectedRow")));
      if (meta.proof) row.append(el("p", "ft-workbench__location", `${t("ImportedVerification")} · ${meta.proof.userName} · ${new Date(meta.proof.at).toLocaleString()}`));
      if (meta.editorial) {
        row.append(el("strong", "", t("EditorialNote")), diffText(current?.editorial?.note ?? "", meta.editorial.note, false), diffText(current?.editorial?.note ?? "", meta.editorial.note, true),
          el("small", "", `${t(meta.editorial.state === "meaning" ? "EditorialMeaning" : meta.editorial.state === "discussion" ? "EditorialDiscussion" : "EditorialNone")} · ${meta.editorial.userName}${meta.editorial.stale ? ` · ${t("NoteStale")}` : ""}`));
      }
      return row;
    });
    for (const view of views.slice(this.#detailsPage * 20, (this.#detailsPage + 1) * 20)) root.append(view());
    root.append(pager(views.length, this.#detailsPage, 20, page => { this.#detailsPage = page; this.host.render(); })); return root;
  }
}
