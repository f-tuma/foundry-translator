export const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Review.${key}`);
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
};
export function button(label: string, action: () => void, className = ""): HTMLButtonElement {
  const node = el("button", className, label); node.type = "button"; node.addEventListener("click", action); return node;
}
export function checkbox(label: string, checked: boolean, change: (checked: boolean) => void): HTMLLabelElement {
  const wrapper = el("label", "ft-workbench__check"), input = el("input"); input.type = "checkbox"; input.checked = checked;
  input.addEventListener("change", () => change(input.checked)); wrapper.append(input, document.createTextNode(label)); return wrapper;
}
export function selectControl(label: string, value: string, options: readonly [string, string][], change: (value: string) => void): HTMLSelectElement {
  const select = el("select"); select.setAttribute("aria-label", label);
  for (const [key, text] of options) { const option = el("option", "", text); option.value = key; option.selected = key === value; select.append(option); }
  select.addEventListener("change", () => change(select.value)); return select;
}
export function downloadJson(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" })), a = el("a");
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export interface PanelHost {
  run(action: () => Promise<void>): void;
  render(): void;
  status(text: string, error?: boolean): void;
  open(uuid: string, group?: string, rowId?: string): Promise<void>;
  language(): string;
}
export function pager(total: number, page: number, size: number, change: (page: number) => void): HTMLElement {
  const footer = el("div", "ft-workbench__pager");
  const previous = button(t("Previous"), () => change(page - 1)); previous.disabled = page === 0;
  const next = button(t("Next"), () => change(page + 1)); next.disabled = (page + 1) * size >= total;
  footer.append(previous, el("span", "", `${total ? page * size + 1 : 0}–${Math.min(total, (page + 1) * size)} / ${total}`), next); return footer;
}
/** Prefix/suffix diff for a compact, unambiguous before/after view; uses textContent only. */
export function diffText(before: string, after: string, updated: boolean): HTMLElement {
  const p = el("p", "ft-workbench__excerpt"), value = updated ? after : before;
  let start = 0, suffix = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (suffix < Math.min(before.length, after.length) - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  p.append(document.createTextNode(value.slice(0, start)));
  if (start < value.length - suffix) p.append(el(updated ? "ins" : "del", "", value.slice(start, value.length - suffix)));
  p.append(document.createTextNode(value.slice(value.length - suffix))); return p;
}
