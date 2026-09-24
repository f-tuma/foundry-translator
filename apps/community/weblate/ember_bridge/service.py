import hashlib
import json
import shutil
import uuid
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from weblate.lang.models import Language
from weblate.trans.models import Component, Project, Unit
from weblate.utils.state import STATE_APPROVED
from weblate.vcs.git import LocalRepository

from .engine import content_engine
from .models import Book, Event, Proposal, ProposalRequest, Release, Workspace


class Problem(Exception):
    def __init__(self, status, message, details=None):
        self.status, self.message, self.details = status, message, details


def digest(value):
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode()
    ).hexdigest()


def workspace(user, permission=None, lock=False):
    query = Workspace.objects.select_related("project")
    if lock:
        query = query.select_for_update()
    ws = query.filter(project__slug=settings.EMBER_PROJECT).first()
    if not user.is_authenticated or not user.is_active:
        raise Problem(401, "Přihlaste se do Weblate.")
    if not ws:
        raise Problem(503, "Správce musí nejprve inicializovat projekt.")
    if ws.project.access_control != Project.ACCESS_PRIVATE:
        raise Problem(
            503, "Projekt redakce musí mít ve Weblate nastavený soukromý přístup."
        )
    if not user.can_access_project(ws.project) or (
        permission and not user.has_perm(permission, ws.project)
    ):
        raise Problem(403, "Přístup do redakce musí schválit správce projektu.")
    return ws


def event(ws, user, action, subject, details=None):
    Event.objects.create(
        workspace=ws,
        actor=user,
        action=action,
        subject=str(subject),
        details=details or {},
    )


def rows_for_books(books, lock=False):
    books = list(books)
    query = Unit.objects.filter(
        translation__component_id__in=[b.component_id for b in books],
        translation__language__code="cs",
    ).select_related("translation__component__project")
    if lock:
        query = query.order_by("pk").select_for_update()
    units = {(u.translation.component_id, u.context): u for u in query}
    rows, native = [], {}
    for book in books:
        name_row = next(
            (
                r
                for r in book.rows
                if book.template["patches"][r["field_index"]]["path"] == ["name"]
            ),
            None,
        )
        name_unit = (
            units.get((book.component_id, f"{name_row['id']}_0")) if name_row else None
        )
        title = name_unit.target if name_unit and name_unit.target else book.title
        page_labels = {}
        for stored in book.rows:
            path = book.template["patches"][stored["field_index"]]["path"]
            if len(path) == 3 and path[0] == "pages" and path[2] == "name":
                page_unit = units.get((book.component_id, f"{stored['id']}_0"))
                if page_unit:
                    page_labels[path[1]] = page_unit.target
        for stored in book.rows:
            path = book.template["patches"][stored["field_index"]]["path"]
            label = (
                "Název dokumentu"
                if path == ["name"]
                else page_labels.get(path[1], stored["label"])
                if len(path) > 1 and path[0] == "pages"
                else stored["label"]
            )
            parts = [
                units.get((book.component_id, f"{stored['id']}_{i}"))
                for i in range(len(stored["source"]))
            ]
            if any(part is None for part in parts):
                raise Problem(
                    409,
                    "Weblate ještě zpracovává import nebo změnil strukturu dokumentu. Obnovte stránku.",
                )
            if [p.source for p in parts] != stored["source"]:
                raise Problem(
                    409,
                    "Originál ve Weblate se změnil. Je nutné znovu posoudit mapování dokumentu.",
                )
            value = [p.target for p in parts]
            stamp = max(p.last_updated for p in parts).isoformat()
            row = {
                **stored,
                "value": value,
                "label": label,
                "document_title": title,
                "revision": digest(
                    [
                        [p.pk, p.source, p.target, p.state, p.last_updated.isoformat()]
                        for p in parts
                    ]
                ),
                "approval": {"at": stamp, "userName": "Weblate"}
                if all(p.state == STATE_APPROVED for p in parts)
                else None,
            }
            rows.append(row)
            native[row["id"]] = parts
    return rows, native


def book_titles(books):
    books = list(books)
    names = {
        b.component_id: next(
            (
                f"{r['id']}_0"
                for r in b.rows
                if b.template["patches"][r["field_index"]]["path"] == ["name"]
            ),
            None,
        )
        for b in books
    }
    titles = {
        u.translation.component_id: u.target
        for u in Unit.objects.filter(
            translation__component_id__in=names,
            translation__language__code="cs",
            context__in=[v for v in names.values() if v],
        ).select_related("translation")
        if names[u.translation.component_id] == u.context
    }
    return {b.pk: titles.get(b.component_id) or b.title for b in books}


def import_preview(user, json_text):
    ws = workspace(user, "project.edit")
    parsed = content_engine("normalize", json=json_text)
    existing = {b.pk: b for b in Book.objects.filter(workspace=ws)}
    conflicts = [
        d["template"]["sourceName"]
        for d in parsed["documents"]
        if d["id"] in existing and existing[d["id"]].template != d["template"]
    ]
    return {
        "digest": digest(json_text),
        "documents": len(parsed["documents"]),
        "newDocuments": sum(d["id"] not in existing for d in parsed["documents"]),
        "conflicts": conflicts,
        "glossary": len(parsed["bundle"]["glossary"]),
        "skippedUi": parsed["skippedUi"],
        "importedReviews": parsed["importedReviews"],
    }


def import_commit(user, json_text, expected):
    prepared = []
    try:
        return _import_commit(user, json_text, expected, prepared)
    except Exception:
        # Git is outside SQL: compensate only repositories created by this import.
        # Weblate's queued scans are on_commit and never run after a rollback.
        for location in reversed(prepared):
            shutil.rmtree(location, ignore_errors=True)
        raise


@transaction.atomic
def _import_commit(user, json_text, expected, prepared):
    ws = workspace(user, "project.edit", lock=True)
    if digest(json_text) != expected:
        raise Problem(409, "Soubor se změnil. Připravte nový náhled.")
    parsed = content_engine("normalize", json=json_text)
    meta = {k: v for k, v in parsed["bundle"].items() if k != "documents"}
    if ws.metadata and any(
        ws.metadata[k] != meta[k] for k in ("systemId", "systemVersion", "glossary")
    ):
        raise Problem(
            409, "Jiná verze systému nebo glosáře. Existující projekt nebyl změněn."
        )
    existing = {b.pk: b for b in Book.objects.filter(workspace=ws)}
    for doc in parsed["documents"]:
        if doc["id"] in existing and existing[doc["id"]].template != doc["template"]:
            raise Problem(
                409, "Dokument již existuje s jiným exportem. Změny nebyly přepsány."
            )
    if sum(len(d["rows"]) for d in parsed["documents"]) > 30000:
        raise Problem(400, "Nahrajte menší část exportu (nejvýše 30 000 oddílů).")
    if not ws.metadata:
        ws.metadata = meta
        ws.save(update_fields=["metadata"])
    count = 0
    for doc in parsed["documents"]:
        if doc["id"] in existing:
            continue
        title = next(
            (
                p["translation"]
                for p in doc["template"]["patches"]
                if p["path"] == ["name"]
            ),
            doc["template"]["sourceName"],
        )
        component = Component(
            project=ws.project,
            name=title[:100],
            slug=f"book-{doc['id'][:24]}",
            vcs="local",
            repo="local:",
            filemask="*.json",
            template="en.json",
            file_format="json",
            source_language=Language.objects.get(code="en"),
            new_lang="none",
            push_on_commit=False,
            manage_units=False,
            suggestion_voting=False,
        )
        location = Path(component.full_path)
        if location.exists():
            raise Problem(
                409,
                "Zůstal nedokončený import. Správce musí zkontrolovat lokální repozitář Weblate.",
            )
        prepared.append(location)
        en, cs = {}, {}
        for row in doc["rows"]:
            for i, value in enumerate(row["source"]):
                key = f"{row['id']}_{i}"
                en[key] = value
                cs[key] = row["value"][i]
        LocalRepository.from_files(
            str(location),
            {
                "en.json": json.dumps(en, ensure_ascii=False).encode(),
                "cs.json": json.dumps(cs, ensure_ascii=False).encode(),
            },
        )
        component.save()
        Book.objects.create(
            id=doc["id"],
            workspace=ws,
            component=component,
            title=title,
            template=doc["template"],
            rows=doc["rows"],
        )
        count += 1
    event(ws, user, "import", expected, {"documents": count})
    return {"imported": count, "duplicate": count == 0}


def proposal_json(p):
    return {
        "id": str(p.pk),
        "title": p.title,
        "author_id": str(p.author_id),
        "author_name": p.author.get_full_name() or p.author.username,
        "status": p.status,
        "revision": p.revision,
        "changes": p.changes,
        "approval": p.approval,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
    }


def check_changes(ws, user, changes, strict=True, review=False):
    if (
        not isinstance(changes, list)
        or not 1 <= len(changes) <= 500
        or any(
            not isinstance(c, dict) or not isinstance(c.get("unitId"), str)
            for c in changes
        )
        or len({c["unitId"] for c in changes}) != len(changes)
    ):
        raise Problem(400, "Návrh musí obsahovat 1 až 500 různých oddílů.")
    # Row IDs bind immutable book structure; never accept a foreign Weblate unit ID.
    wanted = {c["unitId"] for c in changes}
    books = [
        b
        for b in Book.objects.filter(workspace=ws).select_related("component")
        if any(r["id"] in wanted for r in b.rows)
    ]
    rows, native = rows_for_books(books, lock=True)
    by_id = {r["id"]: r for r in rows}
    conflicts = []
    for change in changes:
        row = by_id.get(change["unitId"])
        if not row or (
            strict
            and (
                row["revision"] != change.get("baseRevision")
                or row["value"] != change.get("before")
            )
        ):
            conflicts.append({"unitId": change["unitId"], "current": row})
        if not row:
            continue
        permission = "unit.review" if review else "suggestion.add"
        if any(not user.has_perm(permission, p) for p in native[row["id"]]):
            raise Problem(403, "Chybí oprávnění pro tento oddíl.")
        after = change.get("after")
        if (
            not isinstance(after, list)
            or len(after) != len(row["value"])
            or any(not isinstance(v, str) or len(v) > 100000 for v in after)
        ):
            raise Problem(400, "Neplatná struktura opravy.")
    if conflicts:
        raise Problem(
            409,
            "Některé oddíly se mezitím změnily. Porovnejte aktuální text.",
            conflicts,
        )
    replacements = {c["unitId"]: c["after"] for c in changes}
    for book in books:
        content_engine(
            "validate",
            template=book.template,
            units=[
                {**r, "value": replacements.get(r["id"], r["value"])}
                for r in rows
                if r["document_id"] == book.pk
            ],
        )
    return rows, native


@transaction.atomic
def save_proposal(user, data):
    ws = workspace(user, lock=True)
    try:
        request_id = uuid.UUID(data.get("requestId", ""))
    except (ValueError, TypeError, AttributeError):
        raise Problem(400, "Chybí platný identifikátor požadavku.")
    request_hash = digest(data)
    previous = (
        ProposalRequest.objects.select_related("proposal").filter(pk=request_id).first()
    )
    if previous:
        if (
            previous.proposal.author_id != user.pk
            or previous.proposal.workspace_id != ws.pk
            or previous.request_hash != request_hash
        ):
            raise Problem(409, "Identifikátor požadavku již patří jiné opravě.")
        return {"id": str(previous.proposal_id), "duplicate": True}
    title = data.get("title", "").strip()
    if not 1 <= len(title) <= 200:
        raise Problem(400, "Doplňte název návrhu (nejvýše 200 znaků).")
    check_changes(ws, user, data.get("changes"))
    if data.get("id"):
        p = Proposal.objects.select_for_update().get(pk=data["id"], workspace=ws)
        if p.author_id != user.pk or p.status in ("merged", "rejected"):
            raise Problem(403, "Tento návrh nelze upravit.")
        if p.revision != data.get("revision"):
            raise Problem(409, "Návrh se změnil. Načtěte aktuální verzi.")
        p.revision += 1
        p.status = "draft"
        p.approval = None
    else:
        p = Proposal(id=uuid.uuid4(), workspace=ws, author=user)
    p.title = title
    p.changes = data["changes"]
    p.save()
    ProposalRequest.objects.create(id=request_id, proposal=p, request_hash=request_hash)
    event(ws, user, "proposal.save", p.pk, {"revision": p.revision})
    return {"id": str(p.pk)}


@transaction.atomic
def transition(user, data):
    ws = workspace(user, lock=True)
    p = (
        Proposal.objects.select_for_update()
        .select_related("author")
        .get(pk=data["id"], workspace=ws)
    )
    action = data.get("action")
    if action not in ("submit", "approve", "merge", "reject", "rebase"):
        raise Problem(400, "Neznámá operace.")
    reviewer = user.has_perm("unit.review", ws.project)
    if action == "merge" and p.status == "merged" and reviewer:
        return {"id": str(p.pk), "duplicate": True}
    if (
        action == "submit"
        and p.status in ("submitted", "approved", "merged")
        and p.author_id == user.pk
        and p.revision == data.get("revision")
    ):
        return {"id": str(p.pk), "duplicate": True}
    if p.revision != data.get("revision"):
        raise Problem(409, "Návrh se změnil. Obnovte náhled.")
    if action in ("submit", "rebase"):
        if p.author_id != user.pk or p.status in ("merged", "rejected"):
            raise Problem(403, "Tuto změnu může provést autor otevřeného návrhu.")
        rows, _ = check_changes(ws, user, p.changes, strict=action != "rebase")
        if action == "rebase":
            current = {r["id"]: r for r in rows}
            bases = data.get("bases", [])
            for change in p.changes:
                r = current[change["unitId"]]
                if not any(
                    b.get("unitId") == r["id"] and b.get("revision") == r["revision"]
                    for b in bases
                ):
                    raise Problem(409, "Porovnání už není aktuální. Obnovte je.")
                change["before"] = r["value"]
                change["baseRevision"] = r["revision"]
            p.status = "draft"
            p.revision += 1
        else:
            p.status = "submitted"
        p.approval = None
    else:
        if not reviewer or p.author_id == user.pk:
            raise Problem(403, "Návrh musí zkontrolovat jiný reviewer.")
        if action == "approve":
            if p.status != "submitted":
                raise Problem(409, "Návrh není odeslán ke kontrole.")
            check_changes(ws, user, p.changes, review=True)
            p.status = "approved"
            p.approval = {
                "revision": p.revision,
                "userId": str(user.pk),
                "userName": user.get_full_name() or user.username,
                "at": timezone.now().isoformat(),
            }
        elif action == "reject":
            if p.status not in ("submitted", "approved"):
                raise Problem(409, "Návrh již nelze zamítnout.")
            p.status = "rejected"
            p.approval = None
        else:
            if (
                p.status != "approved"
                or not p.approval
                or p.approval["revision"] != p.revision
            ):
                raise Problem(409, "Chybí schválení aktuální verze návrhu.")
            from weblate.auth.models import User

            approver = User.objects.filter(
                pk=p.approval["userId"], is_active=True
            ).first()
            if (
                not approver
                or not approver.can_access_project(ws.project)
                or not approver.has_perm("unit.review", ws.project)
            ):
                raise Problem(
                    409,
                    "Schvalující reviewer už nemá přístup. Je potřeba nové schválení.",
                )
            _, native = check_changes(ws, user, p.changes, review=True)
            if any(
                not approver.has_perm("unit.review", unit)
                for parts in native.values()
                for unit in parts
            ):
                raise Problem(
                    409, "Schvalující reviewer už nemá oprávnění k oddílům návrhu."
                )
            for change in p.changes:
                for unit, value in zip(
                    native[change["unitId"]], change["after"], strict=True
                ):
                    if not user.has_perm("unit.edit", unit):
                        raise Problem(403, "Chybí oprávnění uložit překlad.")
                    unit.translate(
                        user,
                        value,
                        STATE_APPROVED,
                        propagate=False,
                        author=p.author,
                        change_details={"ember_proposal": str(p.pk)},
                    )
                    if unit.target != value or unit.state != STATE_APPROVED:
                        raise Problem(
                            409,
                            "Kontrola Weblate změnila text nebo odmítla ověření. Sloučení bylo vráceno.",
                        )
            p.status = "merged"
    p.save()
    event(ws, user, f"proposal.{action}", p.pk, {"revision": p.revision})
    return {"id": str(p.pk)}


@transaction.atomic
def publish(user, data):
    ws = workspace(user, "project.edit", lock=True)
    release_id = data.get("id", "")
    title = data.get("title", "").strip()
    notes = data.get("notes", "")
    import re

    if (
        not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,79}", release_id)
        or not 1 <= len(title) <= 200
        or len(notes) > 8000
    ):
        raise Problem(400, "Neplatné označení vydání, název nebo poznámky.")
    old = Release.objects.filter(pk=release_id).first()
    if old:
        if old.title != title or old.notes != notes:
            raise Problem(409, "Označení vydání již existuje.")
        return {"id": old.pk, "duplicate": True}
    books = list(Book.objects.filter(workspace=ws).select_related("component"))
    rows, _ = rows_for_books(books, lock=True)
    if not books:
        raise Problem(409, "Nejprve nahrajte export.")
    payload = content_engine(
        "release",
        meta=ws.metadata,
        documents=[b.template for b in books],
        units=rows,
        title=title,
        notes=notes,
        id=release_id,
    )
    Release.objects.create(
        id=release_id,
        workspace=ws,
        title=title,
        notes=notes,
        payload=payload,
        content_hash=digest(payload),
        actor=user,
        document_count=len(books),
        unit_count=len(rows),
        reviewed_count=sum(bool(r["approval"]) for r in rows),
    )
    event(ws, user, "release.publish", release_id)
    return {"id": release_id}
