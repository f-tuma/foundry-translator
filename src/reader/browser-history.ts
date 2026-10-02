import { freshReaderState, parseReaderState, type ReadingPlace } from "./state";

export interface ReaderHistoryLocation { tabId: string; cursor: number; place: ReadingPlace }
interface HistoryEntry { session: string; index: number; location?: ReaderHistoryLocation }
const KEY = "foundryTranslateReader";
interface HistoryRouter { current?: ReaderBrowserHistory | undefined }
const routers = new WeakMap<EventTarget, HistoryRouter>();
/** Register during Foundry's init hook, before its window listeners. On Window
 * popstate, capture alone does not reliably supersede an earlier host handler. */
export function registerReaderBrowserHistory(events: EventTarget = window): HistoryRouter {
  let router = routers.get(events);
  if (!router) {
    router = {}; routers.set(events, router);
    const registered = router;
    events.addEventListener("popstate", event => registered.current?.handlePop(event), { capture: true });
  }
  return router;
}

/** Same-URL history owned only while this reader is open. Never replace the
 * pre-reader entry; closing returns to it and releases the history dispatcher. */
export class ReaderBrowserHistory {
  private session = crypto.randomUUID();
  private active = false;
  private initial = true;
  private index = 0;
  private closing?: (() => void) | undefined;
  constructor(private navigate: (location?: ReaderHistoryLocation) => void, private exit: () => void,
    private history: History = window.history, private events: EventTarget = window) {}

  private entry(): HistoryEntry | undefined {
    const value = this.history.state?.[KEY];
    if (value?.session !== this.session || !Number.isSafeInteger(value.index) || value.index < 1) return;
    if (!value.location) return { session: this.session, index: value.index };
    const location = value.location;
    if (typeof location.tabId !== "string" || !/^[A-Za-z0-9-]{1,80}$/u.test(location.tabId) || !Number.isSafeInteger(location.cursor) || location.cursor < 0 || location.cursor > 79) return;
    // Apply the same bounds and identity checks as persisted reader positions.
    let place: ReadingPlace | undefined;
    try { place = parseReaderState(JSON.stringify({ ...freshReaderState(), bookmarks: [location.place] })).bookmarks[0]; }
    catch { return; }
    if (place) return { session: this.session, index: value.index, location: { tabId: location.tabId, cursor: location.cursor, place } };
  }
  handlePop(event: Event): void {
    if (!this.active && !this.closing) return;
    // Foundry's own popstate listener immediately pushes a null entry to
    // prevent leaving the world. Handle reader traversal before that listener.
    event.stopImmediatePropagation();
    if (this.closing) { this.closing(); return; }
    const entry = this.entry();
    if (!entry) { this.detach(); this.exit(); return; }
    this.index = entry.index; this.initial = false;
    this.navigate(entry.location);
  }
  start(): void {
    if (this.active) return;
    this.session = crypto.randomUUID(); this.active = true; this.initial = true; this.index = 1;
    registerReaderBrowserHistory(this.events).current = this;
    this.history.pushState({ [KEY]: { session: this.session, index: this.index } }, "");
  }
  record(location?: ReaderHistoryLocation): void {
    if (!this.active || !this.entry()) return;
    const value = { [KEY]: { session: this.session, index: this.initial ? this.index : ++this.index, location } };
    if (this.initial) this.history.replaceState(value, ""); else this.history.pushState(value, "");
    this.initial = false;
  }
  update(location: ReaderHistoryLocation): void {
    const entry = this.active && this.entry();
    if (!entry || entry.location?.tabId !== location.tabId || entry.location.cursor !== location.cursor) return;
    this.history.replaceState({ [KEY]: { ...entry, location } }, "");
  }
  private detach(): void {
    const router = routers.get(this.events); if (router?.current === this) router.current = undefined;
    this.active = false;
  }
  async stop(): Promise<void> {
    const entry = this.active && this.entry(); this.detach();
    if (!entry) return;
    // Traversal is asynchronous. Finish it before a close/reopen can install
    // another reader session that would mistake this popstate for user Back.
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.closing = undefined; this.detach(); resolve(); };
      const timer = setTimeout(finish, 700);
      this.closing = finish; registerReaderBrowserHistory(this.events).current = this;
      this.history.go(-entry.index);
    });
  }
}
