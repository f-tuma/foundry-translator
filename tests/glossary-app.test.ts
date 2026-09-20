import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry } from "../src/glossary/types";

async function fixture() {
  vi.resetModules();
  const { document, Event } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("game", { i18n: { localize: (key: string) => key }, settings: { get: () => [] }, actors: { contents: [] }, scenes: { contents: [] }, journal: { contents: [] }, items: { contents: [] } });
  vi.stubGlobal("ui", { notifications: { success: vi.fn(), warn: vi.fn() } });
  vi.stubGlobal("foundry", { applications: { api: { ApplicationV2: class {
    readonly element = document.createElement("section");
    async close() { this.element.remove(); return this; }
  } } } });
  const { GlossaryCompendiumRepository } = await import("../src/glossary/compendium-repository");
  const { glossaryLive } = await import("../src/glossary/live");
  const initial: GlossaryEntry[] = [{ id: "1", source: "Old Carinth", replacement: "Old Carinth", category: "location", aliases: [] }];
  vi.spyOn(GlossaryCompendiumRepository.prototype, "load").mockResolvedValue(initial);
  const { GlossaryApplication } = await import("../src/glossary/glossary-app");
  class Editor extends GlossaryApplication {
    async mount() {
      document.body.append(this.element);
      this._replaceHTML(await this._renderHTML(), this.element);
      await this._onRender();
    }
  }
  const editor = new Editor();
  await editor.mount();
  return { editor, glossaryLive, initial, Event, GlossaryCompendiumRepository };
}

describe("live glossary editor", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("shows persisted results and progress from another translation and unsubscribes on close", async () => {
    const { editor, glossaryLive, initial } = await fixture();
    const incoming = [{ ...initial[0]!, replacement: "Starý Carinth" }];
    glossaryLive.publish({ entries: incoming, running: true, status: { state: "testing", message: "Collecting names" } });
    expect(editor.element.querySelector<HTMLInputElement>("[data-glossary-replacement]")?.value).toBe("Starý Carinth");
    expect(editor.element.querySelector("[data-status-text]")?.textContent).toBe("Collecting names");
    expect(editor.element.querySelector<HTMLButtonElement>("[data-action='sync']")?.disabled).toBe(true);
    glossaryLive.publish({ running: false, status: { state: "error", message: "A batch could not be read" } });
    await editor.mount();
    expect(editor.element.querySelector("[data-status-text]")?.textContent).toBe("A batch could not be read");
    expect(editor.element.querySelector<HTMLButtonElement>("[data-action='sync']")?.disabled).toBe(false);
    await editor.close();
    glossaryLive.publish({ status: { state: "testing", message: "Must not update the closed editor" } });
    expect(editor.element.querySelector("[data-status-text]")?.textContent).toBe("A batch could not be read");
  });
  it("lets a GM save a draft during glossary updates without losing typing made during the save", async () => {
    const { editor, glossaryLive, initial, Event, GlossaryCompendiumRepository } = await fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const save = vi.spyOn(GlossaryCompendiumRepository.prototype, "saveEntries").mockImplementation(async (entries) => {
      await pending;
      glossaryLive.publish({ entries, running: true });
    });
    glossaryLive.publish({ running: true });
    const input = editor.element.querySelector<HTMLInputElement>("[data-glossary-replacement]")!;
    input.value = "Můj Carinth";
    glossaryLive.publish({ entries: [{ ...initial[0]!, replacement: "Starý Carinth" }] });
    expect(input.value).toBe("Můj Carinth");
    const button = editor.element.querySelector<HTMLButtonElement>("[data-action='save-edits']")!;
    button.dispatchEvent(new Event("click"));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0][0]).toMatchObject({ replacement: "Můj Carinth", customized: true });
    input.value = "Ještě upravený Carinth";
    release();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(editor.element.querySelector<HTMLInputElement>("[data-glossary-replacement]")?.value).toBe("Ještě upravený Carinth");
    expect(editor.element.querySelector<HTMLButtonElement>("[data-action='sync']")?.disabled).toBe(true);
    await editor.close();
  });
});
