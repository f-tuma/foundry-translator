import { GlossaryCompendiumRepository } from "../glossary/compendium-repository";
import type { GlossaryEntry } from "../glossary/types";
import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import { auditNames, isNameConcern, nameFormKey, readNameForms, saveNameForm, type NameAudit, type NameForms } from "./name-consistency";
import { buildSearchIndex, type SearchIndex } from "./search";
import { button, checkbox, downloadJson, el, pager, t, type PanelHost } from "./elements";

export class NameConsistencyPanel {
  #host: PanelHost; #index: SearchIndex | null = null; #audit: NameAudit | null = null;
  #glossary: GlossaryEntry[] = []; #forms: NameForms = { version: 1, entries: [] };
  #page = 0; #all = false; #query = ""; #stop = false; #language = "";
  constructor(host: PanelHost) { this.#host = host; }
  stop(): void { this.#stop = true; }
  invalidate(): void { this.#audit = null; this.#index = null; this.#page = 0; }
  async scan(): Promise<void> {
    this.invalidate(); this.#stop = false; this.#language = this.#host.language();
    this.#glossary = await new GlossaryCompendiumRepository().loadExisting(); this.#forms = readNameForms();
    const index = await buildSearchIndex(this.#language, (done, total) => this.#host.status(t("IndexProgress").replace("{done}", String(done)).replace("{total}", String(total))), () => this.#stop);
    const audit = await auditNames(index, this.#glossary, this.#language, this.#forms, () => this.#stop,
      (done, total) => this.#host.status(t("NameScanProgress").replace("{done}", String(done)).replace("{total}", String(total))));
    this.#index = index; this.#audit = audit; this.#host.status(t("NameScanDone"));
  }
  render(): HTMLElement {
    const root = el("section", "ft-workbench__panel"), toolbar = el("div", "ft-workbench__toolbar"); root.dataset.namePanel = "";
    const help = el("span"); help.innerHTML = renderHelpTooltip(t("NameHelp"), t("NameConsistency"));
    toolbar.append(button(t("NameScan"), () => this.#host.run(() => this.scan())), help,
      checkbox(t("NameShowAll"), this.#all, value => { this.#all = value; this.#page = 0; this.#host.render(); }));
    const search = el("input"); search.type = "search"; search.value = this.#query; search.placeholder = t("NameFilter"); search.setAttribute("aria-label", t("NameFilter"));
    search.addEventListener("change", () => { this.#query = search.value; this.#page = 0; this.#host.render(); }); toolbar.append(search);
    const stop = button(t("StopOperation"), () => { this.#stop = true; }); stop.dataset.reviewStop = ""; stop.hidden = true; toolbar.append(stop); root.append(toolbar);
    if (!this.#audit) { root.append(el("p", "ft-workbench__empty", t("NameIntro"))); activateHelpTooltips(root); return root; }
    const concerns = this.#audit.findings.filter(isNameConcern);
    root.append(el("p", "ft-workbench__summary", t("NameSummary").replace("{terms}", String(this.#audit.checkedTerms)).replace("{concerns}", String(concerns.length)).replace("{skipped}", String(this.#audit.skippedRows))));
    if (this.#index?.skipped.length) {
      const skipped = el("details", "ft-workbench__warning"); skipped.append(el("summary", "", t("SkippedDocuments").replace("{count}", String(this.#index.skipped.length))));
      for (const item of this.#index.skipped) skipped.append(el("p", "", `${item.entry.name} · ${item.reason.startsWith("Review.") ? t(item.reason.slice(7)) : item.reason}`)); root.append(skipped);
    }
    const query = this.#query.toLocaleLowerCase(), findings = (this.#all ? this.#audit.findings : concerns).filter(item => [item.term.source, item.term.replacement, item.candidate, item.document.name].some(text => text.toLocaleLowerCase().includes(query)));
    this.#page = Math.min(this.#page, Math.max(0, Math.ceil(findings.length / 20) - 1));
    const results = el("div", "ft-workbench__results");
    if (!findings.length) results.append(el("p", "ft-workbench__empty", t("NameNoConcerns")));
    for (const finding of findings.slice(this.#page * 20, (this.#page + 1) * 20)) {
      const card = el("article", "ft-workbench__hit"), header = el("header");
      header.append(el("strong", "", `${finding.term.source} → ${finding.term.replacement}`), el("span", "ft-review__badge", t(`NameStatus.${finding.status}`)));
      card.append(header, el("small", "", `${finding.document.name} › ${finding.groupName}`));
      if (finding.candidate) card.append(el("p", "ft-name__candidate", finding.candidate));
      const pair = el("div", "ft-workbench__pair");
      for (const [label, text] of [["Original", finding.source], ["Translation", finding.translation]]) { const side = el("div"); side.append(el("small", "", t(label!)), el("p", "ft-workbench__excerpt", text)); pair.append(side); } card.append(pair);
      const actions = el("div", "ft-workbench__toolbar");
      actions.append(button(t("OpenPassage"), () => this.#host.run(() => this.#host.open(finding.document.uuid, finding.group, finding.rowId))));
      if (finding.candidate && isNameConcern(finding) && this.#host.find) actions.append(button(t("NameFindVariant"), () => this.#host.run(() => this.#host.find!(finding.candidate))));
      if (["variant", "missing"].includes(finding.status) && finding.term.mode === "inflect") {
        const form = el("input"); form.type = "text"; form.value = finding.candidate; form.placeholder = t("NameForm"); form.setAttribute("aria-label", t("NameForm")); form.maxLength = 300;
        actions.append(form, button(t("NameApproveForm"), () => this.#host.run(async () => {
          this.#forms = await saveNameForm(this.#forms, finding.term, this.#language, form.value.trim());
          await this.scan();
        })));
      }
      card.append(actions); results.append(card);
    }
    root.append(results, pager(findings.length, this.#page, 20, page => { this.#page = page; this.#host.render(); }));
    const accepted = el("details", "ft-name__approved"); accepted.append(el("summary", "", t("NameApprovedForms")));
    for (const entry of this.#forms.entries) {
      const term = this.#glossary.find(term => term.enabled !== false && nameFormKey(term, this.#language) === entry.key); if (!term) continue;
      const item = el("div", "ft-workbench__toolbar"); item.append(el("span", "", `${term.replacement} → ${entry.form} · ${entry.userName}`), button(t("NameForgetForm"), () => this.#host.run(async () => {
        this.#forms = await saveNameForm(this.#forms, term, this.#language, entry.form, true); await this.scan();
      }))); accepted.append(item);
    }
    root.append(accepted, button(t("NameExport"), () => downloadJson(`foundry-name-audit-${this.#language}.json`, JSON.stringify({ format: "foundry-translate-name-audit", version: 1, language: this.#language, at: new Date().toISOString(), ...this.#audit, skippedDocuments: this.#index?.skipped, approvedForms: this.#forms }, null, 2))));
    activateHelpTooltips(root); return root;
  }
}
