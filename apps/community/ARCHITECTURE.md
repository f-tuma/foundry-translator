# Community editorial application — 2026-09-24

Scope: one Czech Ember project, a private editor for accepted members, and public
immutable releases. TanStack Start + React provide the editor. Weblate owns
accounts, sessions, invitations, project roles, current translations and native
translation history. PostgreSQL, Redis, Weblate, the editor and a same-origin Caddy
gateway run in one Docker Compose deployment on Dokploy. Better Auth is not used.

## One authentication system and one translation authority

The gateway exposes Weblate under `/weblate/`. The editor calls a small Django
extension under `/weblate/foundry/` using the native session and CSRF protection.
Every private operation checks current Weblate project/component permissions.
Public registration does not grant access to the private project. Administrators
admit members using Weblate's native project access and invitation screens.

Each Foundry document maps to a Weblate JSON component in a local Git repository.
The extension stores immutable source/mapping snapshots, grouped proposals,
comments and frozen releases in the same database. It does not duplicate current
translations. Merge locks native Units and uses `Unit.translate` inside a database
transaction, retaining native history and author attribution. A shared Node text
validator reuses the plugin's Foundry command and HTML checks. The extension is
pinned to Weblate 2026.9.1 (container 2026.9.1.2); internal API compatibility must
be checked before upgrading Weblate.

Sources: https://docs.weblate.org/en/latest/admin/access.html,
https://docs.weblate.org/en/latest/admin/install/docker.html,
https://docs.weblate.org/en/latest/admin/customize.html,
https://tanstack.com/start/latest/docs/framework/react/guide/hosting.

## Invariants

- Login is not membership. Every private request checks native Weblate permissions.
- Only accepted project members can read private content. Roles are managed in Weblate.
- Source snapshots are immutable. Uploading another export never overwrites edits.
- A proposal records each base revision. Review binds its exact revision. Merge
  locks and validates all touched rows in one transaction; any conflict rolls back
  the entire change set. Authors cannot approve their own work.
- A publication is an immutable snapshot, not a live download of the editor.
- Public distribution excludes source prose, private notes, accounts and drafts.
  Hashes bind translations to installed originals; public downloads do not grant
  trust to arbitrary executable content. The Foundry importer validates again.
- UUID identity is exact in v1. Cross-world remapping is deliberately not guessed;
  compendium UUIDs are preferred and mismatches are explicit import conflicts.
- Imported attestations are claims, distinct from reviews performed in this app.
- Backups cover PostgreSQL and the Weblate data volume, including local Git repositories.

## Visual system

Primary concept: generated editor, 1536x1024, 2026-09-24 (kept outside source).
Light warm neutral #f7f6f2, paper #fff, ink #232a27, green #244f42, fine gray
rules, restrained 6px corners. Sans UI chrome, literary serif prose. A quiet header
with Editor / Návrhy / Glosář / Vydání; document rail, parallel source/target rows,
context rail, persistent save/submit action bar. No dashboard card grid or fake
metrics. Mobile stacks source/translation and collapses side panels into labelled
disclosures. Non-editor views reuse these tokens and plain list/form primitives.
Concept copy is illustrative; real document titles, counts and user names always
come from data. Correct the concept's misleading lock help to protect Foundry
commands rather than claim external material is access-controlled by this app.

## Acceptance path

Invite -> register -> administrator imports working export -> translator prepares
a multi-row proposal -> another reviewer approves -> merge -> admin publishes ->
anonymous download -> plugin validates local originals and previews import.
Concurrent edits must produce a conflict with no partial write. Revoked/anonymous
users must not read private data. Repeated merge/publication requests must be safe.
