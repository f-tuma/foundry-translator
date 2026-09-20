import { activateHelpTooltips, renderHelpTooltip } from "../ui/help-tooltip";
import { GLOSSARY_CATEGORIES, isGlossaryCategory, type GlossaryEntry } from "./types";
import type { GlossaryCandidate } from "./candidates";

export interface GlossaryViewData {
  discovered: GlossaryEntry[];
  stored: GlossaryEntry[];
  candidates?: GlossaryCandidate[];
  error?: string;
}
function localize(key: string): string {
  return game.i18n.localize(key);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}

const help = (key: string, topic: string) => renderHelpTooltip(localize(key), localize(topic));

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

function categoryOptions(selected = "term"): string {
  return GLOSSARY_CATEGORIES.map((category) => `<option value="${category}" ${category === selected ? "selected" : ""}>${localize(`FOUNDRY_TRANSLATE.Glossary.Category.${category}`)}</option>`).join("");
}

export interface GlossaryFilterResult {
  matches: number;
  total: number;
}

export function updateGlossaryFilter(root: ParentNode, query: string): GlossaryFilterResult {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-glossary-row]"));
  const category = root.querySelector<HTMLSelectElement>("[name='categoryFilter']")?.value ?? "";
  const naming = root.querySelector<HTMLSelectElement>("[name='namingFilter']")?.value ?? "";
  let matches = 0;

  for (const row of rows) {
    const source = row.querySelector<HTMLElement>(".ft-glossary__source")?.textContent ?? "";
    const replacement = row.querySelector<HTMLInputElement>("[data-glossary-replacement]")?.value ?? "";
    const aliases = row.querySelector<HTMLInputElement>("[data-glossary-aliases-input]")?.value ?? row.dataset.glossaryAliases ?? "";
    const searchable = normalizeSearchText(`${source} ${replacement} ${aliases}`);
    const rowCategory = row.querySelector<HTMLSelectElement>("[data-glossary-category]")?.value;
    const isMatch = (!category || rowCategory === category) && (!naming || row.dataset.namingStatus === naming)
      && terms.every((term) => searchable.includes(term));
    row.hidden = !isMatch;
    if (isMatch) matches += 1;
  }

  const status = root.querySelector<HTMLElement>("[data-glossary-filter-status]");
  const statusText = status?.querySelector<HTMLElement>("[data-glossary-filter-text]");
  if (status) {
    status.hidden = terms.length === 0 && !category && !naming;
    status.dataset.empty = String(matches === 0);
  }
  if (statusText) {
    const template = matches === 0
      ? status?.dataset.emptyTemplate ?? ""
      : status?.dataset.resultsTemplate ?? "";
    statusText.textContent = terms.length === 0 && !category && !naming
      ? ""
      : template.replace("{count}", String(matches)).replace("{total}", String(rows.length));
  }

  return { matches, total: rows.length };
}

export function renderGlossaryRow(entry: GlossaryEntry): HTMLElement {
  const container = document.createElement("div");
  const needsReview = !entry.customized && !!entry.naming;
  const namingStatus = entry.customized ? "manual" : needsReview ? "review" : "original";
  container.innerHTML = `
      <div class="ft-glossary__row" data-glossary-row data-naming-status="${namingStatus}" data-glossary-aliases="${escapeHtml(entry.aliases.join(" "))}">
        <span class="ft-glossary__source" title="${escapeHtml(entry.source)}">${escapeHtml(entry.source)}${needsReview ? `<small class="ft-glossary__review-status">${localize("FOUNDRY_TRANSLATE.Glossary.ReviewNeeded")}</small>` : ""}</span>
        <input type="text" maxlength="240" value="${escapeHtml(entry.replacement)}" data-glossary-replacement data-source="${escapeHtml(entry.source)}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Replacement")}: ${escapeHtml(entry.source)}">
        <details class="ft-glossary__details">
          <summary>${localize(`FOUNDRY_TRANSLATE.Glossary.Category.${entry.category}`)} · ${localize(entry.enabled === false ? "FOUNDRY_TRANSLATE.Glossary.Automatic" : entry.source === entry.replacement ? "FOUNDRY_TRANSLATE.Glossary.Preserve" : "FOUNDRY_TRANSLATE.Glossary.Fixed")}</summary>
          <div class="ft-glossary__metadata">
            ${needsReview ? `<span>${localize("FOUNDRY_TRANSLATE.Glossary.LegacyProposal")}</span>` : ""}
            <label>${localize("FOUNDRY_TRANSLATE.Glossary.Notes")}<textarea data-glossary-notes maxlength="2000" rows="2">${escapeHtml(entry.notes ?? "")}</textarea></label>
            <label><input type="checkbox" data-glossary-enabled ${entry.enabled === false ? "" : "checked"}> ${localize("FOUNDRY_TRANSLATE.Glossary.Enabled")}</label>
            <label>${localize("FOUNDRY_TRANSLATE.Glossary.CategoryLabel")}<select data-glossary-category>${categoryOptions(entry.category)}</select></label>
            <label>${localize("FOUNDRY_TRANSLATE.Glossary.Aliases")}<input type="text" data-glossary-aliases-input value="${escapeHtml(entry.aliases.join("; "))}" maxlength="2000" placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.AliasesHint")}"></label>
          </div>
        </details>
      </div>
    `;
  const row = container.firstElementChild as HTMLElement;
  activateHelpTooltips(row);
  return row;
}

export function readGlossaryRow(row: HTMLElement, entry: GlossaryEntry): GlossaryEntry {
  const replacement = row.querySelector<HTMLInputElement>("[data-glossary-replacement]")?.value.normalize("NFC").trim() || entry.source;
  const category = row.querySelector<HTMLSelectElement>("[data-glossary-category]")?.value;
  const aliases = (row.querySelector<HTMLInputElement>("[data-glossary-aliases-input]")?.value ?? "")
    .split(";").map((alias) => alias.normalize("NFC").trim()).filter(Boolean);
  const enabled = row.querySelector<HTMLInputElement>("[data-glossary-enabled]")?.checked !== false;
  const notes = row.querySelector<HTMLTextAreaElement>("[data-glossary-notes]")?.value.normalize("NFC").trim() ?? entry.notes ?? "";
  return { ...entry, replacement, aliases, enabled, notes, category: isGlossaryCategory(category) ? category : entry.category };
}

export function hasGlossaryEdits(edited: GlossaryEntry, original: GlossaryEntry): boolean {
  return (edited.notes ?? "") !== (original.notes ?? "") || edited.replacement !== original.replacement || edited.category !== original.category
    || (edited.enabled !== false) !== (original.enabled !== false) || JSON.stringify(edited.aliases) !== JSON.stringify(original.aliases);
}

/** Update only settled rows. Keep draft inputs, focus, filters, details and scroll in place. */
export function refreshGlossaryRows(root: HTMLElement, incoming: readonly GlossaryEntry[], previous: readonly GlossaryEntry[]): GlossaryEntry[] {
  const list = root.querySelector<HTMLElement>(".ft-glossary__rows");
  if (!list) return [...previous];
  const old = new Map(previous.map((entry) => [entry.source, entry]));
  const rows = new Map([...list.querySelectorAll<HTMLElement>("[data-glossary-row]")].map((row) => [row.querySelector<HTMLInputElement>("[data-source]")?.dataset.source, row]));
  const stored: GlossaryEntry[] = [];
  for (const entry of [...incoming].sort((a, b) => a.source.localeCompare(b.source))) {
    const row = rows.get(entry.source);
    const baseline = old.get(entry.source);
    if (row && baseline && (row.contains(document.activeElement) || hasGlossaryEdits(readGlossaryRow(row, baseline), baseline))) {
      stored.push(baseline);
      continue;
    }
    if (!row || row.dataset.refreshNeeded || JSON.stringify(entry) !== JSON.stringify(baseline)) {
      const fresh = renderGlossaryRow(entry);
      if (row) {
        const details = fresh.querySelector("details");
        if (details && row.querySelector("details")?.open) details.open = true;
        row.replaceWith(fresh);
      } else {
        list.querySelector(".ft-glossary__empty")?.remove();
        const next = [...list.querySelectorAll<HTMLElement>("[data-glossary-row]")].find((candidate) =>
          (candidate.querySelector<HTMLInputElement>("[data-source]")?.dataset.source ?? "").localeCompare(entry.source) > 0);
        list.insertBefore(fresh, next ?? null);
      }
    }
    stored.push(entry);
  }
  const sources = new Set(incoming.map((entry) => entry.source));
  for (const [source, row] of rows) {
    if (!source || sources.has(source)) continue;
    const baseline = old.get(source);
    if (baseline && (row.contains(document.activeElement) || hasGlossaryEdits(readGlossaryRow(row, baseline), baseline))) stored.push(baseline);
    else row.remove();
  }
  const count = root.querySelector("[data-glossary-stored-count]");
  if (count) count.textContent = String(incoming.length);
  const save = root.querySelector<HTMLButtonElement>("[data-action='save-edits']");
  if (save) save.disabled = !stored.length;
  updateGlossaryFilter(root, root.querySelector<HTMLInputElement>("[name='manualTerm']")?.value ?? "");
  return stored;
}

export function renderGlossaryView(data: GlossaryViewData): HTMLElement {
  const actorCount = data.discovered.filter(({ category }) => category === "character").length;
  const sceneCount = data.discovered.filter(({ category }) => category === "location").length;
  const section = document.createElement("section");
  section.className = "ft-settings ft-glossary";
  const storedRows = [...data.stored].sort((a, b) => a.source.localeCompare(b.source)).map((entry) => renderGlossaryRow(entry).outerHTML).join("");
  const candidates = data.candidates ?? [];
  const candidateRows = candidates.map((candidate) => `
    <article class="ft-glossary__candidate" data-candidate-id="${escapeHtml(candidate.id)}">
      <div class="ft-glossary__candidate-context">
        <strong>${escapeHtml(candidate.documentName)}</strong>
        <span>${escapeHtml(candidate.fieldName)}</span>
        <span>${localize("FOUNDRY_TRANSLATE.Glossary.Candidates.Previous")}: ${escapeHtml(candidate.previousTranslation)}</span>
      </div>
      <div class="ft-glossary__candidate-fields">
        <input type="text" maxlength="240" value="${escapeHtml(candidate.source)}" data-candidate-source placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.Candidates.SourcePlaceholder")}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Source")}">
        <input type="text" maxlength="240" value="${escapeHtml(candidate.replacement)}" data-candidate-replacement aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Replacement")}">
      </div>
      <div class="ft-glossary__candidate-actions">
        <button type="button" class="ft-button ft-button--secondary" data-action="reject-candidate">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          <span>${localize("FOUNDRY_TRANSLATE.Glossary.Candidates.Reject")}</span>
        </button>
        <button type="button" class="ft-button ft-button--primary" data-action="accept-candidate">
          <i class="fa-solid fa-check" aria-hidden="true"></i>
          <span>${localize("FOUNDRY_TRANSLATE.Glossary.Candidates.Accept")}</span>
        </button>
      </div>
    </article>
  `).join("");
  section.innerHTML = `
    <header class="ft-settings__intro">
      <span class="ft-settings__brand-icon" aria-hidden="true">
        <i class="fa-solid fa-book-bookmark"></i>
      </span>
      <div>
        <div class="ft-heading-with-help"><h2>${localize("FOUNDRY_TRANSLATE.Glossary.Heading")}</h2>${help("FOUNDRY_TRANSLATE.Glossary.Intro", "FOUNDRY_TRANSLATE.Glossary.Heading")}</div>
      </div>
    </header>

    <div class="ft-glossary__stats" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.StatsLabel")}">
      <div><strong>${actorCount}</strong><span>${localize("FOUNDRY_TRANSLATE.Glossary.Stats.Characters")}</span></div>
      <div><strong>${sceneCount}</strong><span>${localize("FOUNDRY_TRANSLATE.Glossary.Stats.Locations")}</span></div>
      <div><strong data-glossary-stored-count>${data.stored.length}</strong><span>${localize("FOUNDRY_TRANSLATE.Glossary.Stats.Stored")}</span></div>
    </div>

    ${
      data.error
        ? `<div class="ft-glossary__error" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>${escapeHtml(data.error)}</span></div>`
        : ""
    }

    <section class="ft-glossary__section ft-glossary__candidates">
      <div class="ft-glossary__section-heading">
        <div>
          <div class="ft-heading-with-help"><h3>${localize("FOUNDRY_TRANSLATE.Glossary.Candidates.Heading")}</h3>${help("FOUNDRY_TRANSLATE.Glossary.Candidates.Hint", "FOUNDRY_TRANSLATE.Glossary.Candidates.Heading")}</div>
        </div>
        <span>${candidates.length}</span>
      </div>
      <div class="ft-glossary__candidate-list">
        ${candidateRows || `<p class="ft-glossary__empty">${localize("FOUNDRY_TRANSLATE.Glossary.Candidates.Empty")}</p>`}
      </div>
    </section>

    <section class="ft-glossary__section">
      <div class="ft-glossary__section-heading">
        <div>
          <div class="ft-heading-with-help"><h3>${localize("FOUNDRY_TRANSLATE.Glossary.ManualHeading")}</h3>${help("FOUNDRY_TRANSLATE.Glossary.ManualHint", "FOUNDRY_TRANSLATE.Glossary.ManualHeading")}</div>
        </div>
      </div>
      <div class="ft-glossary__editor">
        <label class="ft-glossary__category-filter">${localize("FOUNDRY_TRANSLATE.Glossary.CategoryLabel")}
          <select name="categoryFilter"><option value="">${localize("FOUNDRY_TRANSLATE.Glossary.AllCategories")}</option>${categoryOptions("")}</select>
        </label>
        <label class="ft-glossary__category-filter">${localize("FOUNDRY_TRANSLATE.Glossary.ReviewFilter")}
          <select name="namingFilter">
            <option value="">${localize("FOUNDRY_TRANSLATE.Glossary.AllNames")}</option>
            <option value="manual">${localize("FOUNDRY_TRANSLATE.Glossary.ManualChoices")}</option>
            <option value="review">${localize("FOUNDRY_TRANSLATE.Glossary.ReviewNeeded")}</option>
          </select>
        </label>
        <div class="ft-glossary__columns" aria-hidden="true">
          <strong>${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Source")}</strong>
          <strong>${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Replacement")}</strong>
        </div>
        <div class="ft-glossary__manual">
          <input type="text" name="manualTerm" maxlength="240" placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.ManualPlaceholder")}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Source")}">
          <input type="text" name="manualReplacement" maxlength="240" placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.ManualReplacementPlaceholder")}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Replacement")}">
          <select name="manualCategory" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.CategoryLabel")}">${categoryOptions()}</select>
          <button type="button" class="ft-button ft-button--secondary" data-action="add-term">
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            <span>${localize("FOUNDRY_TRANSLATE.Glossary.Add")}</span>
          </button>
          <div class="ft-glossary__filter-status" data-glossary-filter-status data-results-template="${escapeHtml(localize("FOUNDRY_TRANSLATE.Glossary.Search.Results"))}" data-empty-template="${escapeHtml(localize("FOUNDRY_TRANSLATE.Glossary.Search.Empty"))}" role="status" aria-live="polite" hidden>
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <span data-glossary-filter-text></span>
          </div>
        </div>
        <div class="ft-glossary__rows">
          ${storedRows || `<p class="ft-glossary__empty">${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Empty")}</p>`}
        </div>
        <div class="ft-glossary__editor-actions">
          <button type="button" class="ft-button ft-button--secondary" data-action="save-edits" ${data.stored.length ? "" : "disabled"}>
            <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
            <span>${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Save")}</span>
          </button>
        </div>
      </div>
    </section>

    <div class="ft-connection-status" data-state="idle" role="status" aria-live="polite">
      <span class="ft-connection-status__dot" aria-hidden="true"></span>
      <span data-status-text>${localize("FOUNDRY_TRANSLATE.Glossary.Status.Ready")}</span>
    </div>

    <footer class="ft-settings__actions">
      <div class="ft-help-row"><button type="button" class="ft-settings__cloud-link ft-glossary__pack-link" data-action="open-pack">
        ${localize("FOUNDRY_TRANSLATE.Glossary.OpenPack")}
        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
      </button>
      ${help("FOUNDRY_TRANSLATE.Glossary.StorageHint", "FOUNDRY_TRANSLATE.Glossary.OpenPack")}</div>
      <div class="ft-glossary-files__actions"><button type="button" class="ft-button ft-button--secondary" data-action="glossary-files"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>${localize("FOUNDRY_TRANSLATE.Glossary.Files.Open")}</button><button type="button" class="ft-button ft-button--secondary" data-action="cancel-sync" hidden>${localize("FOUNDRY_TRANSLATE.ActiveTranslations.Cancel")}</button>
      <button type="button" class="ft-button ft-button--primary" data-action="sync">
        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
        <span>${localize("FOUNDRY_TRANSLATE.Glossary.Sync")}</span>
      </button></div>
    </footer>
  `;
  activateHelpTooltips(section);
  return section;
}
