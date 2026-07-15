import type { GlossaryEntry } from "./types";
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

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export interface GlossaryFilterResult {
  matches: number;
  total: number;
}

export function updateGlossaryFilter(root: ParentNode, query: string): GlossaryFilterResult {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-glossary-row]"));
  let matches = 0;

  for (const row of rows) {
    const source = row.querySelector<HTMLElement>(".ft-glossary__source")?.textContent ?? "";
    const replacement = row.querySelector<HTMLInputElement>("[data-glossary-replacement]")?.value ?? "";
    const aliases = row.dataset.glossaryAliases ?? "";
    const searchable = normalizeSearchText(`${source} ${replacement} ${aliases}`);
    const isMatch = terms.every((term) => searchable.includes(term));
    row.hidden = !isMatch;
    if (isMatch) matches += 1;
  }

  const status = root.querySelector<HTMLElement>("[data-glossary-filter-status]");
  const statusText = status?.querySelector<HTMLElement>("[data-glossary-filter-text]");
  if (status) {
    status.hidden = terms.length === 0;
    status.dataset.empty = String(terms.length > 0 && matches === 0);
  }
  if (statusText) {
    const template = matches === 0
      ? status?.dataset.emptyTemplate ?? ""
      : status?.dataset.resultsTemplate ?? "";
    statusText.textContent = terms.length === 0
      ? ""
      : template.replace("{count}", String(matches)).replace("{total}", String(rows.length));
  }

  return { matches, total: rows.length };
}

export function renderGlossaryView(data: GlossaryViewData): HTMLElement {
  const actorCount = data.discovered.filter(({ category }) => category === "character").length;
  const sceneCount = data.discovered.filter(({ category }) => category === "location").length;
  const section = document.createElement("section");
  section.className = "ft-settings ft-glossary";
  const storedRows = [...data.stored]
    .sort((left, right) => left.source.localeCompare(right.source))
    .map((entry) => `
      <label class="ft-glossary__row" data-glossary-row data-glossary-aliases="${escapeHtml(entry.aliases.join(" "))}">
        <span class="ft-glossary__source" title="${escapeHtml(entry.source)}">${escapeHtml(entry.source)}</span>
        <input type="text" maxlength="240" value="${escapeHtml(entry.replacement)}" data-glossary-replacement data-source="${escapeHtml(entry.source)}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Replacement")}: ${escapeHtml(entry.source)}">
      </label>
    `)
    .join("");
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
        <h2>${localize("FOUNDRY_TRANSLATE.Glossary.Heading")}</h2>
        <p>${localize("FOUNDRY_TRANSLATE.Glossary.Intro")}</p>
      </div>
    </header>

    <div class="ft-glossary__stats" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.StatsLabel")}">
      <div><strong>${actorCount}</strong><span>${localize("FOUNDRY_TRANSLATE.Glossary.Stats.Characters")}</span></div>
      <div><strong>${sceneCount}</strong><span>${localize("FOUNDRY_TRANSLATE.Glossary.Stats.Locations")}</span></div>
      <div><strong>${data.stored.length}</strong><span>${localize("FOUNDRY_TRANSLATE.Glossary.Stats.Stored")}</span></div>
    </div>

    <aside class="ft-settings__privacy">
      <i class="fa-solid fa-database" aria-hidden="true"></i>
      <p>${localize("FOUNDRY_TRANSLATE.Glossary.StorageHint")}</p>
    </aside>

    ${
      data.error
        ? `<div class="ft-glossary__error" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>${escapeHtml(data.error)}</span></div>`
        : ""
    }

    <section class="ft-glossary__section ft-glossary__candidates">
      <div class="ft-glossary__section-heading">
        <div>
          <h3>${localize("FOUNDRY_TRANSLATE.Glossary.Candidates.Heading")}</h3>
          <p>${localize("FOUNDRY_TRANSLATE.Glossary.Candidates.Hint")}</p>
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
          <h3>${localize("FOUNDRY_TRANSLATE.Glossary.ManualHeading")}</h3>
          <p>${localize("FOUNDRY_TRANSLATE.Glossary.ManualHint")}</p>
        </div>
      </div>
      <div class="ft-glossary__editor">
        <div class="ft-glossary__columns" aria-hidden="true">
          <strong>${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Source")}</strong>
          <strong>${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Replacement")}</strong>
        </div>
        <div class="ft-glossary__manual">
          <input type="text" name="manualTerm" maxlength="240" placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.ManualPlaceholder")}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Source")}">
          <input type="text" name="manualReplacement" maxlength="240" placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.ManualReplacementPlaceholder")}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.Editor.Replacement")}">
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
      <button type="button" class="ft-settings__cloud-link ft-glossary__pack-link" data-action="open-pack">
        ${localize("FOUNDRY_TRANSLATE.Glossary.OpenPack")}
        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
      </button>
      <button type="button" class="ft-button ft-button--primary" data-action="sync">
        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
        <span>${localize("FOUNDRY_TRANSLATE.Glossary.Sync")}</span>
      </button>
    </footer>
  `;
  return section;
}
