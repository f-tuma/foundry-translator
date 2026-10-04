# Adventure Reader

The book icon in a journal, actor, item or scene header opens a reading view over
Foundry. The Journal Notes scene controls also offer Adventure Reader; without
a document it resumes the previous reading session or opens the journal library.

## Reading

- Contents follows the native journal order: categories by sort, then pages
  without a category under "Uncategorized". Sub-pages (`title.level` 2–3) are
  indented, the current chapter's headings are listed, and the panel opens
  scrolled to the current chapter.
- Browser Back/Forward follows reader navigation and restores reading positions.
  Back at the first reader page closes the reader; explicit close returns to the
  browser entry from before opening it.
- Previous/Next Chapter (footer, with the target chapter's name) and a card at
  the end of each chapter move through the book; the footer shows the chapter
  position (e.g. 7 / 75). With the text focused, ←/→ turn chapters.
  Back/Forward (Alt+←/→) restores the same tab's reading history and scroll
  position after document links and previews.
- The library groups journals by sidebar folder (e.g. Ember › Quests › Chapter 2);
  searching a folder name lists the whole folder.
- A failed link or the tab limit shows a notification and keeps the current
  chapter open. Open in Foundry is in the top bar and next to unsupported pages.
- The plus button opens another journal in a tab. Ctrl/Cmd-clicking a document
  link also opens a tab. Closing a tab selects the adjacent remaining tab.
- Bookmarks save a place in a document. Reopening the reader restores open tabs.
- Search highlights literal matches in the current chapter, with next/previous
  matches. Ctrl/Cmd-F focuses this search; Enter advances, Shift-Enter goes back.
- Settings change font size (16–30 px), width, dark/paper/sepia appearance, and
  optionally request the browser's fullscreen mode. The reader fills the browser
  window even when browser fullscreen is unavailable. Escape first closes a
  drawer or search, then the reader.

Positions, tab histories, bookmarks and settings are stored locally, scoped to
world, account and UI language. Document prose is not cached. Reading requires a
live Foundry connection and login. Positions do not sync across devices.

## Lightweight reading URL

**Server prerequisite:** Foundry serves module HTML as plain text. Configure an
exact-path reverse-proxy exception for the reader shell before using this URL;
see [reader-hosting.md](reader-hosting.md). Keep all other uploaded HTML protected.

Reader Settings → **Update library and move to reader** prepares the current
book, all its readable chapters, previously added books, and recursively linked
document previews. It then navigates the same tab to
`<routePrefix>/modules/foundry-translate/reader/index.html`. Bookmark that URL on
the tablet. The separate page loads a small static HTML/CSS/JavaScript reader;
it does not load Foundry, the canvas, a game socket or animation loops.

The library lives in IndexedDB in this browser profile, scoped to world, user
and translation language. Preparing another book adds it to this library; every
update rebuilds all selected books and linked previews from current, permitted
documents. Original and translated permissions are checked by the existing
reader and checked again before committing. An interrupted, failed or oversized
preparation leaves the previous library intact. Limit: 5,000 requested document
identities / 64 MiB of snapshot data. Failed linked targets are listed in library
notes; they never route to guessed documents.

Reading supports chapter navigation, exact document links, anchors, previews,
browser Back/Forward, bookmarks, search, text size and dark/paper/sepia themes.
The saved timestamp identifies the copy being read. Open Foundry again and repeat
preparation to pick up corrections; the snapshot is not a live feed. Artwork
uses same-origin server URLs and may still need a connection. This version has
no service worker and does not guarantee an offline cold start.

**Local copies are not an authentication boundary.** A GM library includes the
GM text available at preparation. Anyone using the same browser profile (and
same-origin scripts) can access its stored copy; logout or later permission
revocation does not remotely erase it. Use a personal browser profile. Settings
→ Delete this library removes the selected copy and its local reading state.
Nothing containing story text is uploaded to a public server file. The public
URL is an empty shell until a local library has been explicitly prepared/chosen.

## Documents and safety

Ember pages use a separate native sheet prepared in view mode. The reader does
not render/submit that sheet or modify options of an already open sheet. Native
sections supply lore, ancestry, location, event exposition and other Ember text,
plus the page subtitle and pronunciation. Ember 0.6.2 passes English section
headers ("At a Glance", "Setting the Scene", …); the reader localizes the known
ones. Creature lists, related-page summaries, banners and event outcomes keep
reader styling in every theme. Explicit `.readaloud` blocks carry a “Read aloud”
label and a distinct green tint/border; ordinary quotes and GM notes are not
labeled. Nested blocks get one label and empty embedded descriptions get none. Callout icons and embedded character portraits
use normal document flow, leaving room for enlarged text. The contents panel
keeps its close control visible while scrolling long chapter lists. Event outcomes are shown as static text with
their reached/not reached state; translated event copies show outcome labels
from the translation, matched by outcome ID as in the native sheet. Since
0.33.11, valid saved outcome summaries also use the translation, with exact
source/copy provenance and unchanged event mechanics. Stale or invalid
translations retain the original summary; reached/not reached state is unchanged. Since
0.33.12 this also covers inline outcome labels/summaries and event-state link
labels. They use exact IDs and saved translations; source link destinations,
icons and state remain unchanged. Native gameplay controls are retained in the
native sheet and stripped from the Reader as usual.
Event automation controls, warnings and quest flowcharts are not rendered. Script/form controls and
inline executable handlers are removed from the reading surface. Roll and macro
links never execute in the reader; use Open in Foundry when gameplay is wanted.

Quest overview cards resolve event and location titles and overview text from
their exact processed translation in the overview's target language. The native
sheet and reader share this display adapter. Source UUIDs, icons, tags, order and
canonical narrative registries stay unchanged. Missing, inaccessible, unprocessed
or structurally invalid copies retain original card text.

Character previews include artwork, appearance and public biography; private
biography is GM-only. LIMITED actor access displays only name/artwork. Items,
active effects and scenes provide supported descriptive text/artwork. Unsupported
media page types provide a notice and Open in Foundry access.

Access is checked against both the requested copy and original source. Hidden
source chapters remain absent from a readable translated copy. Source UUID links
follow the module's existing auto-open translation setting. Partial journals use
completed translated pages and original content for unfinished pages. Explicit
translated links retain their language.

No document update, macro execution, scene activation, translation run or other
world mutation is performed by reader navigation. Translation identity and
embedded-reference resolution reuse the module's existing bidirectional mapper.

## API

```js
await game.modules.get("foundry-translate").api.openReader("JournalEntry.ID");
// With no UUID, resume the current reading session or open the library.
await game.modules.get("foundry-translate").api.openReader();
```
