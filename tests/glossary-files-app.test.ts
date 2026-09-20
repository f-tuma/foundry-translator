import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeGlossaryFile } from "../src/glossary/files";
import type { GlossaryEntry } from "../src/glossary/types";

async function fixture() {
  vi.resetModules();
  const { document, Event } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("game", { i18n: { localize: (key: string) => key }, settings: { get: (_id: string, key: string) => key === "targetLanguage" ? "cs" : "" } });
  vi.stubGlobal("foundry", { applications: { api: { ApplicationV2: class { readonly element = document.createElement("section"); } } } });
  let saved: GlossaryEntry[] = [{ source: "Tower", replacement: "Věž", category: "location", aliases: [], id: "1", customized: true }];
  const incoming = [{ ...saved[0]!, replacement: "Věž úsvitu" }, { source: "Sunvale", replacement: "Slunečné údolí", category: "location" as const, aliases: [] }];
  const { GlossaryCompendiumRepository } = await import("../src/glossary/compendium-repository");
  vi.spyOn(GlossaryCompendiumRepository.prototype, "loadExisting").mockImplementation(async () => structuredClone(saved));
  const apply = vi.spyOn(GlossaryCompendiumRepository.prototype, "importEntries").mockImplementation(async (rows) => {
    const keys = new Set(rows.map((row) => row.after.source));
    saved = [...saved.filter((entry) => !keys.has(entry.source)), ...rows.map((row) => ({ ...row.after, id: row.after.id ?? "2", customized: true }))];
  });
  const { GlossaryFilesApplication } = await import("../src/glossary/files-app");
  class Editor extends GlossaryFilesApplication {
    override async render(): Promise<FoundryApplicationV2> {
      document.body.append(this.element);
      this._replaceHTML(await this._renderHTML(), this.element);
      await this._onRender();
      return this;
    }
  }
  const editor = new Editor();
  await editor.render();
  const choose = async (text: string, name = "review.json") => {
    const input = editor.element.querySelector<HTMLInputElement>("[data-glossary-file]")!;
    Object.defineProperty(input, "files", { value: [{ name, size: text.length, text: async () => text }] });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(editor.element.querySelector<HTMLInputElement>("[data-glossary-file]")?.disabled).toBe(false));
  };
  return { editor, incoming, choose, apply, Event };
}

describe("glossary file import UI", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("leaves existing changes unchecked, writes only selected new entries and prevents repeat import", async () => {
    const { editor, incoming, choose, apply, Event } = await fixture();
    await choose(serializeGlossaryFile(incoming, "cs", "json"));
    expect(editor.element.querySelector<HTMLInputElement>('[data-state="changed"] input')?.checked).toBe(false);
    expect(editor.element.querySelector<HTMLInputElement>('[data-state="new"] input')?.checked).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    editor.element.querySelector("[data-file-apply]")!.dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(apply.mock.calls[0]?.[0].map((row) => row.after.source)).toEqual(["Sunvale"]);
    await vi.waitFor(() => expect(editor.element.querySelector("[data-file-status]")?.textContent).toContain("Imported"));
    expect(editor.element.querySelector<HTMLButtonElement>("[data-file-apply]")?.disabled).toBe(true);
    expect(editor.element.querySelector<HTMLInputElement>('[data-state="changed"] input')?.checked).toBe(false);
  });
  it("requires explicit overwrite selection and prevents importing over drafts", async () => {
    const { editor, incoming, choose, apply, Event } = await fixture();
    await choose(serializeGlossaryFile([incoming[0]!], "cs", "csv"), "review.csv");
    expect(editor.element.querySelector<HTMLButtonElement>("[data-file-apply]")?.disabled).toBe(true);
    const select = editor.element.querySelector<HTMLInputElement>("[data-select-changed]")!;
    select.checked = true; select.dispatchEvent(new Event("change"));
    expect(editor.element.querySelector<HTMLButtonElement>("[data-file-apply]")?.disabled).toBe(false);
    editor.hasUnsavedEdits = () => true;
    editor.element.querySelector("[data-file-apply]")!.dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(editor.element.querySelector("[data-file-status]")?.textContent).toContain("Unsaved"));
    expect(apply).not.toHaveBeenCalled();
    editor.hasUnsavedEdits = () => false;
    editor.element.querySelector("[data-file-apply]")!.dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(apply.mock.calls[0]?.[0][0]?.after.replacement).toBe("Věž úsvitu");
  });
  it("clears an old valid preview when another selected file is invalid", async () => {
    const { editor, incoming, choose, apply } = await fixture();
    await choose(serializeGlossaryFile(incoming, "cs", "json"));
    expect(editor.element.querySelector("[data-file-apply]")).not.toBeNull();
    await choose("{invalid}");
    expect(editor.element.querySelector("[data-file-apply]")).toBeNull();
    expect(editor.element.querySelector("[data-file-status]")?.textContent).toContain("InvalidJson");
    expect(apply).not.toHaveBeenCalled();
  });
});
