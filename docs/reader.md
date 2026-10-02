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
from the translation, matched by outcome ID as in the native sheet.
Event automation controls, warnings and quest flowcharts are not rendered. Script/form controls and
inline executable handlers are removed from the reading surface. Roll and macro
links never execute in the reader; use Open in Foundry when gameplay is wanted.

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
