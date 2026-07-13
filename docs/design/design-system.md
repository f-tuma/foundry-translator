# Foundry Translate design system

The accepted desktop concept is [`foundry-translate-concept.png`](./foundry-translate-concept.png).

## Surface and layout

- Target viewport: 1440×900, with graceful resizing down to a compact Foundry window.
- App shell: 216px navigation rail, flexible document workspace, 344px inspector.
- On narrow windows the inspector moves below the document list; the table remains the primary surface.
- The container model is rails, toolbars, a real table, and one inspector—not a card grid.

## Color tokens

| Role | Value |
| --- | --- |
| Background | `#101414` |
| Surface | `#171b1b` |
| Raised surface | `#1d2120` |
| Border | `#3b403d` |
| Primary text | `#e7dfcc` |
| Muted text | `#a8aaa4` |
| Brass accent | `#d7a925` |
| Success | `#54c9a3` |
| Warning | `#e4ad2f` |
| Danger | `#ec5f52` |

No gradients or glow. Shadows are exceptional; separation comes from fine borders and surface value.

## Typography

- Main page heading: restrained Foundry-compatible serif, 40–44px at full width.
- Application chrome, controls, table and body: Foundry's sans-serif stack.
- Control text: 14px/20px; table rows: 14–15px/22px; labels: 12–13px/18px.
- Buttons and fields must never rely on browser-default typography.

## Geometry and spacing

- Radii: 4px for controls, 6px for grouped surfaces.
- Spacing scale: 4, 8, 12, 16, 24, 32px.
- Border: 1px with selected rows using a brass border and a 3px leading rail.
- Icons: sparse 1.5px outline icons, optically aligned to text.

## Primary component families

- Application shell and navigation rail.
- Top toolbar and primary/secondary/danger buttons.
- Search field and select filter.
- Status summary with four semantic states.
- Sortable document table with selected, hover, loading and conflict states.
- Translation job progress region.
- Inspector form with readonly source data and editable translation policy.
- Compact bottom status bar.

## Provider settings window

- Compact 620px Foundry ApplicationV2 surface, not a separate full-screen shell.
- The established dark background, fine borders, brass primary action and sparse outline icons remain unchanged.
- Form order: provider, protected API key, source/target language, privacy note, connection status, actions.
- Connection status has idle, testing, success and error states using muted, warning, success and danger tokens.
- The API key visibility control and all buttons require visible keyboard focus.

## Visible-copy lock for the first screen

- `Foundry Translate`
- `Překlad`, `Slovník`, `Paměť překladů`, `Import a export`, `Nastavení`
- `Překlad dobrodružství`
- `Nový překlad`, `Importovat překlad`
- `Ke kontrole`, `Přeloženo`, `Změněno`, `Chyby`
- `Dokument`, `Typ`, `Stav`, `Změny`, `Akce`
- `Zkontrolovat`, `Přeložit znovu`, `Otevřít`
- `Cache: world.foundry-translate-memory`, `API připojeno`

No additional above-the-fold product copy should be added without a functional requirement.
