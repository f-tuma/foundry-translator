import { describe, expect, it, vi } from "vitest";
import { ReaderBrowserHistory, registerReaderBrowserHistory } from "../src/reader/browser-history";

function setup() {
  const events = new EventTarget(), entries: unknown[] = [{ original: "Foundry" }]; let index = 0;
  const history = {
    get state() { return entries[index]; },
    pushState(value: unknown) { entries.splice(++index); entries.push(structuredClone(value)); },
    replaceState(value: unknown) { entries[index] = structuredClone(value); },
    go(delta: number) { index += delta; events.dispatchEvent(new Event("popstate")); }
  };
  const navigate = vi.fn(), exit = vi.fn();
  const reader = new ReaderBrowserHistory(navigate, exit, history as unknown as History, events);
  const location = (uuid: string, cursor: number, scroll = 0) => ({ tabId: "tab", cursor, place: { uuid, title: uuid, scroll, ratio: 0, width: 800 } });
  return { reader, history, entries, events, navigate, exit, location };
}
describe("reader browser history", () => {
  it("captures browser Back/Forward and preserves scroll without altering the Foundry base entry", () => {
    const s = setup(); s.reader.start(); s.reader.record(s.location("JournalEntry.a",0));
    s.reader.update(s.location("JournalEntry.a",0,230)); s.reader.record(s.location("JournalEntry.b",1));
    s.history.go(-1); expect(s.navigate.mock.lastCall?.[0].place.scroll).toBe(230);
    s.history.go(1); expect(s.navigate.mock.lastCall?.[0].place.uuid).toBe("JournalEntry.b");
    expect(s.entries[0]).toEqual({ original:"Foundry" });
  });
  it("exits at the beginning and releases the browser listener", async () => {
    const s=setup(); s.reader.start(); s.reader.record(s.location("Actor.a",0));
    s.history.go(-1); expect(s.exit).toHaveBeenCalledOnce();
    await s.reader.stop(); s.history.go(1); expect(s.navigate).not.toHaveBeenCalled();
  });
  it("returns to the base on close and safely starts another session", async () => {
    const s=setup(); s.reader.start(); s.reader.record(s.location("Actor.a",0)); s.reader.record(s.location("Actor.b",1));
    await s.reader.stop(); expect(s.history.state).toEqual({ original:"Foundry" }); expect(s.exit).not.toHaveBeenCalled();
    s.reader.start(); s.reader.record(s.location("Actor.c",0)); s.history.go(-1); expect(s.exit).toHaveBeenCalledOnce();
  });
  it("branches browser history after Back and never stores prose", () => {
    const s=setup(); s.reader.start(); s.reader.record(s.location("Actor.a",0)); s.reader.record(s.location("Actor.b",1));
    s.history.go(-1); s.reader.record(s.location("Actor.c",1));
    expect(s.entries).toHaveLength(3); expect(JSON.stringify(s.entries)).not.toContain("Actor.b");
  });
  it("does not overwrite the destination's position while a previous page finishes scrolling", () => {
    const s=setup(); s.reader.start(); s.reader.record(s.location("Actor.a",0,100)); s.reader.record(s.location("Actor.b",1,200));
    s.history.go(-1); s.reader.update(s.location("Actor.b",1,999)); s.history.go(1); s.history.go(-1);
    expect(s.navigate.mock.lastCall?.[0].place.scroll).toBe(100);
  });
  it("leaves unrelated browser history alone", async () => {
    const s=setup(); s.reader.start(); s.reader.record(s.location("Actor.a",0)); s.history.pushState({other:"application"});
    await s.reader.stop(); expect(s.history.state).toEqual({other:"application"});
  });
  it("rejects corrupt owned locations instead of attempting to open them", () => {
    const s=setup(); s.reader.start(); s.reader.record(s.location("Actor.a",0)); s.reader.record(s.location("Actor.b",1));
    const entry = (s.entries[1] as any).foundryTranslateReader;
    entry.location.place.uuid="javascript:evil";
    s.history.go(-1); expect(s.navigate).not.toHaveBeenCalled(); expect(s.exit).toHaveBeenCalledOnce();
  });
  it("consumes reader traversal and releases the host handler after closing", async () => {
    const s=setup(); registerReaderBrowserHistory(s.events);
    // Match Foundry: the host listener exists before the reader is opened.
    const host=vi.fn(); s.events.addEventListener("popstate",host);
    s.reader.start(); s.reader.record(s.location("Actor.a",0)); s.reader.record(s.location("Actor.b",1));
    s.history.go(-1); expect(host).not.toHaveBeenCalled();
    await s.reader.stop();
    expect(host).not.toHaveBeenCalled();
    host.mockClear(); s.history.go(1); expect(host).toHaveBeenCalledOnce();
  });
});
