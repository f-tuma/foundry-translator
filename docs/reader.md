# Adventure Reader

The book icon in a journal, actor, item or scene header opens a reading view over
Foundry. The Journal Notes scene controls also offer Adventure Reader; without
a document it resumes the previous reading session or opens the journal library.

## Reading

- Contents lists native page categories, chapters, and the current chapter's headings.
- Previous/Next Chapter moves through the book. Back/Forward restores the same
  tab's reading history and scroll position after document links and previews.
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
sections supply lore, ancestry, location, event exposition and other Ember text.
Event automation controls and warnings are omitted. Script/form controls and
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
