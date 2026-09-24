"""Versioned glossary corrections using the same proposal transaction as texts."""

from django.utils import timezone

from .engine import content_engine
from .service import Problem, digest


def glossary_rows(ws):
    rows = []
    for i, term in enumerate(ws.metadata.get("glossary", [])):
        key = "glossary:" + digest(term["source"])
        state = ws.glossary_state.get(key, {})
        rows.append(
            {
                "id": key,
                "kind": "glossary",
                "document_id": None,
                "document_title": "Glosář",
                "field_index": i,
                "unit_key": key,
                "position": i,
                "label": term["source"],
                "source": [term["source"]],
                "value": [
                    term["replacement"],
                    term["category"],
                    term.get("mode", "fixed"),
                    term.get("notes", ""),
                    "\n".join(term["aliases"]),
                    "off" if term.get("enabled") is False else "on",
                ],
                "revision": digest([term, state.get("revision", 0)]),
                "approval": state.get("approval")
                if state.get("hash") == digest(term)
                else None,
            }
        )
    return rows


def corrected_glossary(ws, changes):
    entries = [dict(t) for t in ws.metadata.get("glossary", [])]
    rows = {r["id"]: r for r in glossary_rows(ws)}
    for change in changes:
        row = rows.get(change["unitId"])
        if not row:
            continue
        values = change["after"]
        replacement, category, mode, notes, aliases, enabled = values
        if (
            not replacement.strip()
            or len(replacement) > 240
            or len(notes) > 2000
            or enabled not in ("on", "off")
            or mode not in ("fixed", "inflect")
            or category
            not in ("character", "location", "faction", "deity", "item", "lore", "term")
        ):
            raise Problem(
                400, "Neplatné heslo glosáře. Zkontrolujte název a pravidla použití."
            )
        entries[row["field_index"]].update(
            replacement=replacement,
            category=category,
            mode=mode,
            notes=notes,
            aliases=[a.strip() for a in aliases.splitlines() if a.strip()],
            enabled=enabled == "on",
            customized=True,
        )
    # Reuse the Foundry import validator, including alias collisions across all terms.
    return content_engine("glossary", meta=ws.metadata, entries=entries)


def merge_glossary(ws, changes, user):
    selected = [c for c in changes if c["unitId"].startswith("glossary:")]
    if not selected:
        return
    entries = corrected_glossary(ws, selected)
    by_id = {r["id"]: r for r in glossary_rows(ws)}
    for c in selected:
        key = c["unitId"]
        term = entries[by_id[key]["field_index"]]
        ws.glossary_state[key] = {
            "revision": ws.glossary_state.get(key, {}).get("revision", 0) + 1,
            "hash": digest(term),
            "approval": {
                "at": timezone.now().isoformat(),
                "userName": user.get_full_name() or user.username,
            },
        }
    ws.metadata = {**ws.metadata, "glossary": entries}
    ws.save(update_fields=["metadata", "glossary_state"])
