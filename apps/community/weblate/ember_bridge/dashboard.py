"""Private overview: logical editor rows, never a sum of raw Weblate strings."""

from collections import Counter

from django.utils import timezone
from weblate.trans.models import Unit
from weblate.utils.state import STATE_APPROVED

from .glossary import glossary_rows
from .models import Event, Proposal, Release


def overview(ws, books, user):
    # One native query for every visible book. No full text or revisions leave this endpoint.
    native = {
        (u["translation__component_id"], u["context"]): u
        for u in Unit.objects.filter(
            translation__component_id__in=[b.component_id for b in books],
            translation__language__code="cs",
        ).values(
            "translation__component_id",
            "context",
            "source",
            "target",
            "state",
            "last_updated",
        )
    }
    docs, owner = [], {}
    for book in books:
        reviewed = unknown = 0
        title, updated = book.title, None
        for row in book.rows:
            owner[row["id"]] = book.pk
            parts = [
                native.get((book.component_id, f"{row['id']}_{i}"))
                for i in range(len(row["source"]))
            ]
            if (
                not parts
                or any(p is None for p in parts)
                or [p["source"] for p in parts] != row["source"]
            ):
                unknown += 1
                continue
            reviewed += all(p["state"] == STATE_APPROVED for p in parts)
            stamp = max(p["last_updated"] for p in parts)
            updated = max(updated, stamp) if updated else stamp
            if book.template["patches"][row["field_index"]]["path"] == ["name"]:
                title = parts[0]["target"] or title
        docs.append(
            {
                "id": book.pk,
                "title": title,
                "units": len(book.rows),
                "reviewed": reviewed,
                "unknown": unknown,
                "open_proposals": 0,
                "updated_at": updated.isoformat() if updated else None,
            }
        )
    terms = glossary_rows(ws)
    allowed = set(owner) | {r["id"] for r in terms}
    proposals = [
        p
        for p in Proposal.objects.filter(workspace=ws)
        .select_related("author")
        .order_by("-updated_at")
        if all(c["unitId"] in allowed for c in p.changes)
    ]
    counts = Counter(p.status for p in proposals)
    open_proposals = [
        p for p in proposals if p.status in ("draft", "submitted", "approved")
    ]
    per_book = Counter()
    for p in open_proposals:
        per_book.update({owner[c["unitId"]] for c in p.changes if c["unitId"] in owner})
    for doc in docs:
        doc["open_proposals"] = per_book[doc["id"]]
    by_id = {str(p.pk): p for p in proposals}
    # Only events for visible proposals: cross-component titles/authors stay private.
    activity = [
        {
            "action": e.action,
            "id": e.subject,
            "title": by_id[e.subject].title,
            "author": e.actor.get_full_name() or e.actor.username,
            "at": e.created_at.isoformat(),
        }
        for e in Event.objects.filter(
            workspace=ws, subject__in=by_id, action__startswith="proposal."
        )
        .select_related("actor")
        .order_by("-created_at")[:4]
    ]
    latest = (
        Release.objects.filter(workspace=ws)
        .order_by("-created_at")
        .values(
            "id",
            "title",
            "created_at",
            "document_count",
            "unit_count",
            "reviewed_count",
        )
        .first()
    )
    return {
        "at": timezone.now().isoformat(),
        "documents": docs,
        "totals": {
            "units": sum(d["units"] for d in docs),
            "reviewed": sum(d["reviewed"] for d in docs),
            "unknown": sum(d["unknown"] for d in docs),
        },
        "glossary": {
            "total": len(terms),
            "reviewed": sum(bool(r["approval"]) for r in terms),
            "open_proposals": sum(
                any(c["unitId"].startswith("glossary:") for c in p.changes)
                for p in open_proposals
            ),
        },
        "proposals": {
            s: counts[s]
            for s in ("draft", "submitted", "approved", "merged", "rejected")
        },
        "work": [
            {
                "id": str(p.pk),
                "title": p.title,
                "status": p.status,
                "author_name": p.author.get_full_name() or p.author.username,
                "mine": p.author_id == user.pk,
                "updated_at": p.updated_at.isoformat(),
                "units": len(p.changes),
            }
            for p in open_proposals[:8]
        ],
        "activity": activity,
        "latest_release": latest,
    }
