function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** Native Foundry tooltips escape the scrollable window and stay on screen. */
export function renderHelpTooltip(text: string, topic: string): string {
  const label = game.i18n.localize("FOUNDRY_TRANSLATE.Help").replace("{topic}", topic);
  return `<button type="button" class="ft-help-tip" aria-label="${escapeAttribute(label)}"
    aria-description="${escapeAttribute(text)}" data-tooltip-text="${escapeAttribute(text)}"
    data-tooltip-class="ft-help-tooltip"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button>`;
}

/** Foundry handles hover; make the same help available to keyboard and touch. */
export function activateHelpTooltips(root: HTMLElement): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>(".ft-help-tip")) {
    const show = () => game.tooltip.activate(button);
    button.addEventListener("focus", show);
    button.addEventListener("click", show);
    button.addEventListener("blur", () => {
      if (game.tooltip.element === button) game.tooltip.deactivate();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      game.tooltip.clearPending();
      game.tooltip.deactivate();
      event.stopPropagation();
    });
  }
}
