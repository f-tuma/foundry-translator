import type { GlossaryEntry } from "./types";

export interface GlossaryViewData {
  discovered: GlossaryEntry[];
  stored: GlossaryEntry[];
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

export function renderGlossaryView(data: GlossaryViewData): HTMLElement {
  const actorCount = data.discovered.filter(({ category }) => category === "character").length;
  const sceneCount = data.discovered.filter(({ category }) => category === "location").length;
  const section = document.createElement("section");
  section.className = "ft-settings ft-glossary";
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

    <section class="ft-glossary__section">
      <div class="ft-glossary__section-heading">
        <div>
          <h3>${localize("FOUNDRY_TRANSLATE.Glossary.ManualHeading")}</h3>
          <p>${localize("FOUNDRY_TRANSLATE.Glossary.ManualHint")}</p>
        </div>
      </div>
      <div class="ft-glossary__manual">
        <input type="text" name="manualTerm" maxlength="240" placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.ManualPlaceholder")}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.ManualHeading")}">
        <input type="text" name="manualReplacement" maxlength="240" placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.ManualReplacementPlaceholder")}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.ManualReplacementPlaceholder")}">
        <button type="button" class="ft-button ft-button--secondary" data-action="add-term">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
          <span>${localize("FOUNDRY_TRANSLATE.Glossary.Add")}</span>
        </button>
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
