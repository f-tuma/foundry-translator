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

function categoryLabel(category: GlossaryEntry["category"]): string {
  return localize(`FOUNDRY_TRANSLATE.Glossary.Category.${category}`);
}

export function renderGlossaryView(data: GlossaryViewData): HTMLElement {
  const actorCount = data.discovered.filter(({ category }) => category === "character").length;
  const sceneCount = data.discovered.filter(({ category }) => category === "location").length;
  const storedKeys = new Set(data.stored.map(({ source }) => source.normalize("NFC").toLowerCase()));
  const preview = data.discovered.slice(0, 12);
  const hiddenCount = Math.max(0, data.discovered.length - preview.length);
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
          <h3>${localize("FOUNDRY_TRANSLATE.Glossary.DiscoveredHeading")}</h3>
          <p>${localize("FOUNDRY_TRANSLATE.Glossary.DiscoveredHint")}</p>
        </div>
        <span>${data.discovered.length}</span>
      </div>
      <ul class="ft-glossary__preview">
        ${preview
          .map(({ source, category }) => {
            const stored = storedKeys.has(source.normalize("NFC").toLowerCase());
            return `<li>
              <span class="ft-glossary__term" title="${escapeHtml(source)}">${escapeHtml(source)}</span>
              <span class="ft-glossary__category">${categoryLabel(category)}</span>
              <i class="fa-solid ${stored ? "fa-circle-check" : "fa-circle-plus"}" aria-label="${localize(
                stored
                  ? "FOUNDRY_TRANSLATE.Glossary.AlreadyStored"
                  : "FOUNDRY_TRANSLATE.Glossary.WillAdd",
              )}"></i>
            </li>`;
          })
          .join("")}
        ${
          hiddenCount
            ? `<li class="ft-glossary__more">${localize("FOUNDRY_TRANSLATE.Glossary.More").replace("{count}", String(hiddenCount))}</li>`
            : ""
        }
      </ul>
    </section>

    <section class="ft-glossary__section">
      <div class="ft-glossary__section-heading">
        <div>
          <h3>${localize("FOUNDRY_TRANSLATE.Glossary.ManualHeading")}</h3>
          <p>${localize("FOUNDRY_TRANSLATE.Glossary.ManualHint")}</p>
        </div>
      </div>
      <div class="ft-glossary__manual">
        <input type="text" name="manualTerm" maxlength="240" placeholder="${localize("FOUNDRY_TRANSLATE.Glossary.ManualPlaceholder")}" aria-label="${localize("FOUNDRY_TRANSLATE.Glossary.ManualHeading")}">
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
