import { logger } from "../logger";
import { escapeReader as esc, loadReaderContent, prepareReaderProse, type ReaderContent } from "./content";
import { activeTab, closeReaderTab, currentPlace, freshReaderState, navigateTab, parseReaderState, MAX_TABS, type ReaderState, type ReadingPlace } from "./state";
import { ReaderBrowserHistory, type ReaderHistoryLocation } from "./browser-history";

const t = (key: string) => game.i18n.localize(`FOUNDRY_TRANSLATE.Reader.${key}`);
const icon = (name: string) => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
const button = (action: string, label: string, glyph: string, disabled = false) => `<button type="button" data-reader-action="${action}" title="${esc(t(label))}" aria-label="${esc(t(label))}"${disabled ? " disabled" : ""}>${icon(glyph)}</button>`;
type Panel = "contents" | "bookmarks" | "settings" | "library" | null;
const storageKey = () => `foundry-translate-reader:1:${game.world?.id ?? "world"}:${game.user?.id ?? "user"}:${game.i18n.lang ?? "en"}`;

export class AdventureReader extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "foundry-translate-reader", classes: ["foundry-translate", "ft-reader-window"],
    tag: "div", window: { title: "FOUNDRY_TRANSLATE.Reader.Title", icon: "fa-solid fa-book-open", frame: true, resizable: false, minimizable: false },
    position: { top: 0, left: 0, width: "auto", height: "auto" } };
  private state: ReaderState;
  private content: ReaderContent | undefined;
  private panel: Panel = null;
  private sequence = 0;
  private busy = false;
  private error = "";
  private search = "";
  private matches: HTMLElement[] = [];
  private matchIndex = -1;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private fullscreenOwned = false;
  private previousFocus: HTMLElement | null = null;
  private libraryFilter = "";
  private attemptedUuid?: string;
  private browserHistory = new ReaderBrowserHistory(location => {
    void this.restoreBrowserLocation(location).catch(error => { logger.warn("Reader history failed.", error); ui.notifications.warn(t("Unavailable")); });
  }, () => { void this.close(); });
  constructor() {
    super();
    try { this.state = parseReaderState(localStorage.getItem(storageKey())); } catch { this.state = freshReaderState(); }
  }
  private save(): void {
    try { localStorage.setItem(storageKey(), JSON.stringify(this.state)); }
    catch { /* Reading remains possible with disabled browser storage. */ }
  }
  private remember(syncBrowser = true): void {
    const place = currentPlace(this.state), scroller = this.element?.querySelector<HTMLElement>(".ft-reader-scroll");
    if (!place || !scroller || !this.content || place.uuid !== this.content.uuid) return;
    place.scroll = scroller.scrollTop; place.width = scroller.clientWidth;
    place.ratio = scroller.scrollHeight > scroller.clientHeight ? scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight) : 0;
    const location = this.historyLocation(); if (syncBrowser && location) this.browserHistory.update(location);
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.save(), 350);
  }
  async open(uuid?: string): Promise<void> {
    this.previousFocus ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.browserHistory.start();
    const current = currentPlace(this.state);
    if (uuid) await this.navigate(uuid);
    else if (current) await this.display(current);
    else { this.panel = "library"; this.browserHistory.record(); await this.render({ force: true }); }
  }
  private historyLocation(): ReaderHistoryLocation | undefined {
    const tab = activeTab(this.state), place = currentPlace(this.state);
    return tab && place ? { tabId: tab.id, cursor: tab.cursor, place: { ...place } } : undefined;
  }
  private async restoreBrowserLocation(location?: ReaderHistoryLocation): Promise<void> {
    this.remember(false);
    if (!location) { ++this.sequence; this.busy = false; this.error = ""; this.panel = "library"; await this.render({ force: true }); return; }
    let tab = this.state.tabs.find(tab => tab.id === location.tabId);
    if (!tab && this.state.tabs.length < MAX_TABS) {
      tab = { id: location.tabId, history: [{ ...location.place }], cursor: 0 }; this.state.tabs.push(tab);
    }
    if (tab) this.state.active = tab.id;
    if (tab?.history[location.cursor]?.uuid === location.place.uuid) {
      tab.cursor = location.cursor; Object.assign(tab.history[tab.cursor]!, location.place);
    } else navigateTab(this.state, { ...location.place });
    const place = currentPlace(this.state); if (place) await this.display(place, false);
  }
  private async navigate(uuid: string, newTab = false, place?: ReadingPlace): Promise<void> {
    this.remember();
    this.attemptedUuid = uuid;
    const token = ++this.sequence;
    this.busy = true; this.error = "";
    await this.render({ force: true });
    try {
      const content = await loadReaderContent(uuid);
      if (token !== this.sequence) return;
      navigateTab(this.state, place ? { ...place, uuid: content.uuid, title: content.title, book: content.book, anchor: content.anchor ?? place.anchor }
        : { uuid: content.uuid, title: content.title, book: content.book, anchor: content.anchor, scroll: 0, ratio: 0, width: 0 }, newTab);
      if (place) Object.assign(currentPlace(this.state)!, { scroll: place.scroll, ratio: place.ratio, width: place.width });
      this.content = content; this.panel = null; this.search = ""; this.busy = false; this.save();
      this.browserHistory.record(this.historyLocation());
    } catch (error) {
      if (token !== this.sequence) return;
      const message = t(error instanceof Error && error.message.startsWith("Reader.") ? error.message.slice(7) : "Unavailable");
      // A broken link or the tab limit must not replace the chapter being read.
      if (this.content) ui.notifications.warn(message); else this.error = message;
      this.busy = false;
      logger.warn("Reader could not open a document.", error);
    }
    if (token === this.sequence) await this.render({ force: true });
  }
  private async display(place: ReadingPlace, recordBrowser = true): Promise<void> {
    this.attemptedUuid = place.uuid + (place.anchor ? `#${place.anchor}` : "");
    const token = ++this.sequence; this.busy = true; this.error = "";
    await this.render({ force: true });
    try {
      const content = await loadReaderContent(place.uuid + (place.anchor ? `#${place.anchor}` : ""));
      if (token !== this.sequence) return;
      this.content = content; place.uuid = content.uuid; place.title = content.title; place.book = content.book; this.panel = null; this.search = "";
      if (recordBrowser) this.browserHistory.record(this.historyLocation());
    } catch (error) {
      if (token !== this.sequence) return;
      // Do not display another tab's prose under an inaccessible document name.
      this.content = undefined; this.error = t(error instanceof Error && error.message.startsWith("Reader.") ? error.message.slice(7) : "Unavailable");
    }
    if (token === this.sequence) { this.busy = false; this.save(); await this.render({ force: true }); }
  }
  protected async _renderHTML(): Promise<HTMLElement> {
    const root = document.createElement("section"); root.className = "ft-reader";
    root.dataset.theme = this.state.theme; root.dataset.wide = String(this.state.wide);
    root.style.setProperty("--reader-font-size", `${this.state.fontSize}px`);
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", t("Title"));
    root.setAttribute("aria-modal", "true");
    const tab = activeTab(this.state), place = currentPlace(this.state);
    root.innerHTML = `<header class="ft-reader-topbar">
      <div class="ft-reader-toolbar">${button("back", "Back", "arrow-left", !tab || tab.cursor <= 0)}${button("forward", "Forward", "arrow-right", !tab || tab.cursor >= tab.history.length - 1)}${button("contents", "Contents", "list", !this.content?.chapters.length)}</div>
      <div class="ft-reader-title"><small>${esc(this.content?.book ?? t("Title"))}</small><strong>${esc(place?.title ?? t("Library"))}</strong></div>
      <div class="ft-reader-toolbar">${button("search", "Search", "magnifying-glass", !this.content)}${button("bookmarks", "Bookmarks", "bookmark")}${button("settings", "Settings", "text-height")}${button("native", "OpenNative", "arrow-up-right-from-square", !this.content)}${button("close", "Close", "xmark")}</div></header>
      <div class="ft-reader-tabs" role="tablist" aria-label="${esc(t("Tabs"))}">${this.state.tabs.map(tab => `<div class="ft-reader-tab${tab.id === this.state.active ? " is-active" : ""}"><button type="button" role="tab" aria-selected="${tab.id === this.state.active}" data-reader-tab="${esc(tab.id)}">${esc(tab.history[tab.cursor]?.title ?? "")}</button><button type="button" data-reader-close-tab="${esc(tab.id)}" aria-label="${esc(t("CloseTab"))}">${icon("xmark")}</button></div>`).join("")}${button("library", "OpenDocument", "plus")}</div>
      <div class="ft-reader-search" hidden><label>${icon("magnifying-glass")}<input type="search" data-reader-find placeholder="${esc(t("FindPlaceholder"))}" aria-label="${esc(t("FindPlaceholder"))}"></label><output aria-live="polite" data-reader-find-count></output>${button("find-prev", "PreviousMatch", "chevron-up")}${button("find-next", "NextMatch", "chevron-down")}${button("search-close", "CloseSearch", "xmark")}</div>
      <main class="ft-reader-scroll" tabindex="0" aria-label="${esc(t("ReadingArea"))}"${this.busy ? ' aria-busy="true"' : ""}>
        ${this.busy ? `<div class="ft-reader-status" role="status">${icon("circle-notch")} ${esc(t("Loading"))}</div>` : ""}
        ${this.error ? `<div class="ft-reader-status" role="alert">${esc(this.error)} ${button("retry", "Retry", "rotate-right")}${button("library", "Library", "book-open")}</div>` : ""}
        <article class="ft-reader-article"><header><small>${esc(this.content?.book ?? "")}</small><h1>${esc(this.content?.title ?? t("Welcome"))}</h1>${this.content?.subtitle ? `<p class="ft-reader-subtitle">${esc(this.content.subtitle)}</p>` : ""}${this.content?.pronunciation ? `<p class="ft-reader-pronunciation">${esc(this.content.pronunciation)}</p>` : ""}</header><div data-reader-prose></div>${this.chapterEndHTML()}</article>
      </main>
      <footer class="ft-reader-footer">${this.chapterButton(-1)}<div class="ft-reader-progress"${this.content && !this.error ? "" : " hidden"}>${this.chapterPosition()}<span data-reader-progress>0 %</span><progress max="100" value="0" aria-label="${esc(t("Progress"))}"></progress></div>${this.chapterButton(1)}</footer>
      <div class="ft-reader-scrim"${this.panel ? "" : " hidden"}></div><aside class="ft-reader-panel" role="dialog" aria-modal="true" aria-label="${esc(t(this.panel === "contents" ? "Contents" : this.panel === "bookmarks" ? "Bookmarks" : this.panel === "settings" ? "Settings" : "Library"))}"${this.panel ? "" : " hidden"}></aside>`;
    const prose = root.querySelector<HTMLElement>("[data-reader-prose]")!;
    if (this.content && !this.error) {
      prose.append(prepareReaderProse(this.content.html));
      prose.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6").forEach((heading, i) => { heading.dataset.readerSection = String(i); });
      // Outside the sanitized prose, so it is a reader control, not page content.
      if (this.content.unsupported) prose.insertAdjacentHTML("afterend", `<p class="ft-reader-native-hint"><button type="button" data-reader-action="native">${icon("arrow-up-right-from-square")} ${esc(t("OpenNative"))}</button></p>`);
    }
    else if (!this.content && !this.error) prose.textContent = t("WelcomeHint");
    const panel = root.querySelector<HTMLElement>(".ft-reader-panel")!;
    panel.innerHTML = this.panelHTML();
    if (this.panel) root.querySelectorAll<HTMLElement>(".ft-reader-topbar,.ft-reader-tabs,.ft-reader-scroll,.ft-reader-footer,.ft-reader-search").forEach(e => { e.inert = true; });
    root.dataset.panel = this.panel ?? "";
    return root;
  }
  protected _replaceHTML(result: HTMLElement, content: HTMLElement): void { content.replaceChildren(result); }
  protected async _onRender(): Promise<void> {
    // Bind to the replaced child, never the persistent application frame:
    // otherwise each chapter/tab render accumulates another action handler.
    const root = this.element?.querySelector<HTMLElement>(".ft-reader"); if (!root) return;
    root.addEventListener("click", event => { void this.onClick(event).catch(error => { logger.warn("Reader action failed.", error); ui.notifications.warn(t("Unavailable")); }); }, { capture: true });
    root.addEventListener("keydown", event => this.onKey(event));
    const scroller = root.querySelector<HTMLElement>(".ft-reader-scroll")!;
    scroller.addEventListener("scroll", () => { if (!root.isConnected) return; if (!this.busy) this.remember(); this.updateProgress(); }, { passive: true });
    const place = currentPlace(this.state);
    if (place && this.content?.uuid === place.uuid) {
      if (place.scroll > 0 || place.ratio > 0) scroller.scrollTop = place.width && Math.abs(place.width - scroller.clientWidth) > 10 ? place.ratio * (scroller.scrollHeight - scroller.clientHeight) : place.scroll;
      else if (place.anchor) this.goAnchor(place.anchor);
      // Artwork/fonts can change layout after the first paint. Use saved ratio
      // once, only if the user hasn't started scrolling in the meantime.
      const before = scroller.scrollTop;
      for (const image of root.querySelectorAll<HTMLImageElement>(".ft-reader-article img")) {
        image.addEventListener("load", () => { if (!root.isConnected) return; if (scroller.scrollTop === before && place.ratio > 0) scroller.scrollTop = place.ratio * (scroller.scrollHeight - scroller.clientHeight); this.updateProgress(); }, { once: true });
      }
    }
    this.updateProgress();
    root.querySelector<HTMLInputElement>("[data-reader-find]")?.addEventListener("input", event => { this.search = (event.target as HTMLInputElement).value; this.highlight(); });
    const libraryInput = root.querySelector<HTMLInputElement>("[data-reader-library-filter]");
    if (libraryInput) libraryInput.value = this.libraryFilter;
    libraryInput?.addEventListener("input", event => { this.libraryFilter = (event.target as HTMLInputElement).value; this.filterLibrary(root); });
    if (libraryInput) this.filterLibrary(root);
    if (this.panel) {
      // Long Ember journals (Deities, Gazetteers) list 50+ chapters: start at the current one.
      const target = root.querySelector<HTMLElement>('.ft-reader-panel [aria-current="page"],.ft-reader-panel input')
        ?? root.querySelector<HTMLElement>(".ft-reader-panel button");
      target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "center" });
    }
    else scroller.focus({ preventScroll: true });
  }
  private panelHTML(): string {
    if (!this.panel) return "";
    const key = { contents: "Contents", bookmarks: "Bookmarks", settings: "Settings", library: "Library" }[this.panel];
    const header = `<header><h2>${esc(t(key))}</h2>${button("panel-close", "ClosePanel", "xmark")}</header>`;
    if (this.panel === "contents") {
      let category = "";
      const outline = this.content ? prepareReaderProse(this.content.html) : null;
      const headings = [...(outline?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? [])].slice(0, 100);
      return header + `<nav aria-label="${esc(t("Contents"))}">${this.content?.chapters.map(c => {
        const heading = c.category && c.category !== category ? `<h3>${esc(c.category)}</h3>` : ""; category = c.category;
        const current = c.uuid === this.content?.uuid;
        return `${heading}<button type="button" class="ft-reader-level${c.level}" data-reader-uuid="${esc(c.uuid)}"${current ? ' aria-current="page"' : ""}>${esc(c.name)}</button>${current && headings.length ? `<div class="ft-reader-outline">${headings.map((h, i) => `<button type="button" class="ft-reader-${h.localName}" data-reader-jump="${i}">${esc(h.textContent?.trim() ?? "")}</button>`).join("")}</div>` : ""}`;
      }).join("") ?? ""}</nav>`;
    }
    if (this.panel === "bookmarks") return header + `<button type="button" class="ft-reader-save-bookmark" data-reader-action="bookmark">${icon("bookmark")} ${esc(t("BookmarkHere"))}</button><nav>${this.state.bookmarks.map((p, i) => `<div class="ft-reader-bookmark"><button type="button" data-reader-bookmark="${i}"${p.uuid === this.content?.uuid ? ' aria-current="page"' : ""}><span>${esc(p.title)}</span><small>${p.book ? `${esc(p.book)} · ` : ""}${Math.round(p.ratio * 100)} %</small></button><button type="button" data-reader-remove-bookmark="${i}" aria-label="${esc(t("RemoveBookmark"))}">${icon("trash")}</button></div>`).join("") || `<p>${esc(t("NoBookmarks"))}</p>`}</nav>`;
    if (this.panel === "settings") return header + `<div class="ft-reader-preferences"><h3>${esc(t("FontSize"))}</h3><div class="ft-reader-size">${button("font-minus", "Smaller", "minus")}<output>${this.state.fontSize} px</output>${button("font-plus", "Larger", "plus")}</div><h3>${esc(t("Theme"))}</h3><div class="ft-reader-themes">${(["dark", "paper", "sepia"] as const).map(theme => `<button type="button" data-reader-theme="${theme}" aria-pressed="${theme === this.state.theme}">${esc(t({ dark: "Dark", paper: "Paper", sepia: "Sepia" }[theme]))}</button>`).join("")}</div><button type="button" data-reader-action="wide" aria-pressed="${this.state.wide}">${icon("arrows-left-right-to-line")} ${esc(t("Wide"))}</button><button type="button" data-reader-action="fullscreen">${icon("expand")} ${esc(t("Fullscreen"))}</button><p>${esc(t("PreferenceHint"))}</p></div>`;
    // Group by the sidebar folder path (Ember: Quests › Chapter 2, Gazetteer, …).
    const groups = new Map<string, { name: string; uuid: string }[]>();
    for (const j of game.journal.contents as any[]) {
      if (!(game.user?.isGM || j.testUserPermission?.(game.user, "OBSERVER") === true)) continue;
      const folders = j.folder ? [...(j.folder.ancestors ?? []).slice().reverse(), j.folder] : [];
      const path = folders.map((f: { name: string }) => f.name).join(" › ");
      if (!groups.has(path)) groups.set(path, []);
      groups.get(path)!.push({ name: j.name, uuid: j.uuid });
    }
    const sorted = [...groups].sort(([a], [b]) => (a ? 1 : 0) - (b ? 1 : 0) || a.localeCompare(b));
    const list = sorted.map(([path, journals]) => `<div class="ft-reader-library-group">${path ? `<h3>${esc(path)}</h3>` : ""}${journals.sort((a, b) => a.name.localeCompare(b.name))
      .map(j => `<button type="button" data-reader-library data-reader-uuid="${esc(j.uuid)}" data-reader-new-tab="true">${icon("book-open")} <span>${esc(j.name)}</span></button>`).join("")}</div>`).join("");
    return header + `<label class="ft-reader-library-search">${icon("magnifying-glass")}<input type="search" data-reader-library-filter placeholder="${esc(t("LibrarySearch"))}" aria-label="${esc(t("LibrarySearch"))}"></label><nav>${list || `<p>${esc(t("NoDocuments"))}</p>`}<p data-reader-library-empty hidden>${esc(t("NoMatches"))}</p></nav><p>${esc(t("LibraryHint"))}</p>`;
  }
  private filterLibrary(root: HTMLElement): void {
    const query = this.libraryFilter.trim().toLocaleLowerCase();
    let any = false;
    for (const group of root.querySelectorAll<HTMLElement>(".ft-reader-library-group")) {
      // A folder name match lists the whole folder ("kapitola 2", "gazetteer").
      const folder = (group.querySelector("h3")?.textContent ?? "").toLocaleLowerCase().includes(query);
      let visible = false;
      group.querySelectorAll<HTMLElement>("[data-reader-library]").forEach(e => { e.hidden = !folder && !(e.textContent ?? "").toLocaleLowerCase().includes(query); visible ||= !e.hidden; });
      group.hidden = !visible; any ||= visible;
    }
    const empty = root.querySelector<HTMLElement>("[data-reader-library-empty]"); if (empty) empty.hidden = any || !root.querySelector(".ft-reader-library-group");
  }
  private chapter(offset: number) {
    const chapters = this.content?.chapters ?? [], index = chapters.findIndex(p => p.uuid === this.content?.uuid);
    return index >= 0 ? chapters[index + offset] : undefined;
  }
  private chapterButton(offset: -1 | 1): string {
    const target = this.chapter(offset), label = t(offset < 0 ? "PreviousChapter" : "NextChapter");
    const text = `<span><small>${esc(label)}</small>${target ? `<strong>${esc(target.name)}</strong>` : ""}</span>`;
    return `<button type="button" class="ft-reader-chapter-${offset < 0 ? "prev" : "next"}" data-reader-action="chapter-${offset < 0 ? "prev" : "next"}" aria-label="${esc(target ? `${label}: ${target.name}` : label)}"${target ? "" : " disabled"}>${offset < 0 ? icon("chevron-left") + text : text + icon("chevron-right")}</button>`;
  }
  private chapterPosition(): string {
    const chapters = this.content?.chapters ?? [], index = chapters.findIndex(p => p.uuid === this.content?.uuid);
    return index >= 0 && chapters.length > 1 ? `<span class="ft-reader-position" title="${esc(t("ChapterPosition"))}">${index + 1} / ${chapters.length}</span>` : "";
  }
  /** Book-like continuation at the end of the text, where a reader actually is. */
  private chapterEndHTML(): string {
    const next = this.chapter(1);
    if (!this.content || this.error || !next) return "";
    return `<nav class="ft-reader-chapter-end" aria-label="${esc(t("NextChapter"))}"><button type="button" data-reader-action="chapter-next"><span><small>${esc(t("NextChapter"))}${next.category ? ` · ${esc(next.category)}` : ""}</small><strong>${esc(next.name)}</strong></span>${icon("arrow-right")}</button></nav>`;
  }
  private async onClick(event: MouseEvent): Promise<void> {
    if (!(event.target instanceof Element)) return;
    const el = event.target.closest<HTMLElement>("button,a,.ft-reader-scrim"); if (!el || !this.element?.contains(el)) return;
    if (el.closest("[data-reader-prose]")) {
      // Native document-link/roll handlers must not execute behind the reader.
      if (el.matches("a.content-link[data-uuid]")) {
        event.preventDefault(); event.stopImmediatePropagation();
        const uuid = el.dataset.uuid!, anchor = el.dataset.hash;
        await this.navigate(uuid + (anchor ? `#${anchor}` : ""), event.ctrlKey || event.metaKey);
      } else if (el.matches('a[href^="#"]')) {
        event.preventDefault(); event.stopPropagation(); this.goAnchor(el.getAttribute("href")!.slice(1));
      } else if (!el.matches('a[href^="https://"],a[href^="http://"]')) {
        event.preventDefault(); event.stopImmediatePropagation();
        ui.notifications.info(t("ReadOnly"));
      }
      return;
    }
    event.stopPropagation();
    if (this.busy && !["close", "panel-close"].includes(el.dataset.readerAction ?? "")) return;
    this.remember();
    if (el.dataset.readerJump !== undefined) {
      const index = Number(el.dataset.readerJump); this.panel = null; await this.render({ force: true });
      this.element.querySelector<HTMLElement>(`[data-reader-prose] [data-reader-section="${index}"]`)?.scrollIntoView({ block: "start" });
      return;
    }
    if (el.dataset.readerUuid) return this.navigate(el.dataset.readerUuid, el.dataset.readerNewTab === "true");
    if (el.dataset.readerTab) {
      this.state.active = el.dataset.readerTab;
      const p = currentPlace(this.state); if (p) return this.display(p);
    }
    if (el.dataset.readerCloseTab) {
      closeReaderTab(this.state, el.dataset.readerCloseTab); this.save();
      const p = currentPlace(this.state);
      if (p) return this.display(p);
      this.content = undefined; this.panel = "library"; this.browserHistory.record(); return void await this.render({ force: true });
    }
    if (el.dataset.readerBookmark !== undefined) {
      const p = this.state.bookmarks[Number(el.dataset.readerBookmark)]; if (p) return this.navigate(p.uuid + (p.anchor ? `#${p.anchor}` : ""), false, p);
    }
    if (el.dataset.readerRemoveBookmark !== undefined) this.state.bookmarks.splice(Number(el.dataset.readerRemoveBookmark), 1);
    if (el.dataset.readerTheme) this.state.theme = el.dataset.readerTheme as ReaderState["theme"];
    const action = el.dataset.readerAction;
    if (action === "close") { await this.close(); return; }
    if (action === "retry" && this.attemptedUuid) return this.navigate(this.attemptedUuid);
    if (action === "back" || action === "forward") {
      const tab = activeTab(this.state); if (tab) { const next = tab.cursor + (action === "back" ? -1 : 1); if (tab.history[next]) { tab.cursor = next; return this.display(tab.history[next]!); } }
    }
    if (action === "chapter-prev" || action === "chapter-next") { const uuid = this.chapter(action === "chapter-prev" ? -1 : 1)?.uuid; if (uuid) return this.navigate(uuid); }
    if (action === "search" || action === "search-close") {
      const bar = this.element.querySelector<HTMLElement>(".ft-reader-search")!;
      bar.hidden = action === "search-close" || !bar.hidden;
      if (!bar.hidden) bar.querySelector<HTMLInputElement>("input")!.focus();
      return;
    }
    if (action === "find-next" || action === "find-prev") { this.selectMatch(action === "find-prev" ? -1 : 1); return; }
    if (action === "bookmark") {
      const p = currentPlace(this.state); if (!p) return;
      const old = this.state.bookmarks.findIndex(b => b.uuid === p.uuid); if (old >= 0) this.state.bookmarks.splice(old, 1);
      this.state.bookmarks.unshift({ ...p }); this.state.bookmarks = this.state.bookmarks.slice(0, 100);
    }
    if (["contents", "bookmarks", "settings", "library"].includes(action ?? "")) this.panel = action as Panel;
    if (action === "panel-close" || el.classList.contains("ft-reader-scrim")) this.panel = null;
    if (action === "font-minus" || action === "font-plus") { this.state.fontSize = Math.max(16, Math.min(30, this.state.fontSize + (action === "font-minus" ? -1 : 1))); const p = currentPlace(this.state); if (p) p.width = -1; }
    if (action === "wide") { this.state.wide = !this.state.wide; const p = currentPlace(this.state); if (p) p.width = -1; }
    if (action === "fullscreen") {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) { await document.documentElement.requestFullscreen(); this.fullscreenOwned = true; }
        else ui.notifications.info(t("FullscreenHint"));
      } catch { ui.notifications.info(t("FullscreenHint")); }
      return;
    }
    if (action === "native" && this.content) {
      const native = this.content.native, page = native.documentName === "JournalEntryPage";
      const sheet = (page ? native.parent as any : native)?.sheet;
      await this.close(); await sheet?.render({ force: true, ...(page ? { pageId: native.id } : {}) }); return;
    }
    this.save(); await this.render({ force: true });
  }
  private onKey(event: KeyboardEvent): void {
    // Prevent Foundry canvas shortcuts while reading or typing in the reader.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.panel) { this.panel = null; void this.render({ force: true }); }
      else if (!this.element.querySelector<HTMLElement>(".ft-reader-search")!.hidden) this.element.querySelector<HTMLElement>(".ft-reader-search")!.hidden = true;
      else void this.close();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault(); const bar = this.element.querySelector<HTMLElement>(".ft-reader-search")!; bar.hidden = false; bar.querySelector<HTMLInputElement>("input")!.focus();
    }
    if (event.key === "Tab") {
      const area = this.panel ? this.element.querySelector<HTMLElement>(".ft-reader-panel")! : this.element;
      const focusable = [...area.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href],[tabindex="0"]')].filter(e => !e.closest("[hidden],[inert]") && e.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key === "Enter" && (event.target as Element)?.matches("[data-reader-find]")) { event.preventDefault(); this.selectMatch(event.shiftKey ? -1 : 1); }
    // Browser-style history (Alt+←/→) and book-style page turns while the text has focus.
    if (!this.panel && !this.busy && ["ArrowLeft", "ArrowRight"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.altKey) { event.preventDefault(); window.history.go(event.key === "ArrowLeft" ? -1 : 1); return; }
      const onText = (event.target as Element)?.matches?.(".ft-reader-scroll");
      const action = onText ? (event.key === "ArrowLeft" ? "chapter-prev" : "chapter-next") : "";
      const control = action && this.element.querySelector<HTMLButtonElement>(`[data-reader-action="${action}"]:not(:disabled)`);
      if (control) { event.preventDefault(); control.click(); }
    }
  }
  private goAnchor(anchor: string): void {
    const article = this.element?.querySelector<HTMLElement>(".ft-reader-article"); if (!article) return;
    const target = [...article.querySelectorAll<HTMLElement>("[id]")].find(e => e.id === anchor)
      ?? [...article.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].find(e => {
        const slugify = (CONFIG.JournalEntryPage as any)?.documentClass?.slugifyHeading;
        return typeof slugify === "function" && slugify(e) === anchor;
      });
    target?.scrollIntoView({ block: "start" });
  }
  private updateProgress(): void {
    const scroller = this.element?.querySelector<HTMLElement>(".ft-reader-scroll"); if (!scroller) return;
    const percent = Math.round(scroller.scrollHeight > scroller.clientHeight ? 100 * scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight) : 100);
    const output = this.element.querySelector("[data-reader-progress]"), progress = this.element.querySelector<HTMLProgressElement>("progress");
    if (output) output.textContent = `${Math.max(0, Math.min(100, percent))} %`; if (progress) progress.value = percent;
  }
  private highlight(): void {
    const prose = this.element?.querySelector<HTMLElement>("[data-reader-prose]"); if (!prose) return;
    prose.querySelectorAll("mark[data-reader-match]").forEach(mark => mark.replaceWith(...mark.childNodes)); prose.normalize();
    this.matches = []; this.matchIndex = -1;
    const query = this.search.trim().toLocaleLowerCase();
    if (query) {
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
      while (walker.nextNode()) { const n = walker.currentNode as Text; if (!n.parentElement?.closest("code,pre,script,style,[hidden],.ft-reader-readaloud-label")) nodes.push(n); }
      for (const node of nodes) {
        const text = node.textContent ?? "", folded = text.toLocaleLowerCase(); let index = folded.indexOf(query), offset = 0;
        if (index < 0) continue;
        const fragment = document.createDocumentFragment();
        while (index >= 0 && this.matches.length < 500) {
          fragment.append(document.createTextNode(text.slice(offset, index)));
          const mark = document.createElement("mark"); mark.dataset.readerMatch = ""; mark.textContent = text.slice(index, index + query.length);
          fragment.append(mark); this.matches.push(mark); offset = index + query.length; index = folded.indexOf(query, offset);
        }
        fragment.append(document.createTextNode(text.slice(offset))); node.replaceWith(fragment);
      }
    }
    this.selectMatch(1);
  }
  private selectMatch(direction: number): void {
    this.matches[this.matchIndex]?.classList.remove("is-current");
    if (this.matches.length) {
      this.matchIndex = (this.matchIndex + direction + this.matches.length) % this.matches.length;
      this.matches[this.matchIndex]!.classList.add("is-current"); this.matches[this.matchIndex]!.scrollIntoView({ block: "center" });
    }
    const count = this.element.querySelector("[data-reader-find-count]"); if (count) count.textContent = this.matches.length ? `${this.matchIndex + 1} / ${this.matches.length}${this.matches.length === 500 ? "+" : ""}` : t("NoMatches");
  }
  async close(options?: Record<string, unknown>): Promise<this> {
    this.remember(); clearTimeout(this.saveTimer); this.save(); ++this.sequence; this.busy = false;
    await this.browserHistory.stop();
    if (this.fullscreenOwned && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    this.fullscreenOwned = false;
    // The fixed fullscreen frame cannot use Foundry's max-height minimize
    // animation; its transition timeout would make closing feel unresponsive.
    await super.close({ ...options, animate: false }); this.previousFocus?.focus(); this.previousFocus = null; return this;
  }
}

let reader: AdventureReader | undefined;
export async function openAdventureReader(uuid?: string): Promise<void> { reader ??= new AdventureReader(); await reader.open(uuid); }
