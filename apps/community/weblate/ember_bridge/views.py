import json

from django.contrib.auth.decorators import login_not_required
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie

from .models import Book, Comment, Event, Proposal, Release
from .service import (
    Problem,
    book_titles,
    import_commit,
    import_preview,
    proposal_json,
    publish,
    rows_for_books,
    save_proposal,
    transition,
    workspace,
)


def public_releases():
    return list(
        Release.objects.order_by("-created_at").values(
            "id",
            "title",
            "notes",
            "content_hash",
            "document_count",
            "unit_count",
            "reviewed_count",
            "created_at",
        )[:100]
    )


def accessible_books(ws, user):
    return [
        b
        for b in Book.objects.filter(workspace=ws).select_related("component__project")
        if user.can_access_component(b.component)
    ]


def visible_proposal(p, books):
    allowed = {r["id"] for b in books for r in b.rows}
    return all(c["unitId"] in allowed for c in p.changes)


@login_not_required
@ensure_csrf_cookie
@csrf_protect
def endpoint(request, action):
    try:
        if request.method not in ("GET", "POST"):
            raise Problem(405, "Nepodporovaná metoda.")
        action = action.strip("/")
        if action == "releases" and request.method == "GET":
            return JsonResponse({"releases": public_releases()})
        if action.startswith("download/") and request.method == "GET":
            release = Release.objects.get(pk=action.split("/")[1])
            result = HttpResponse(
                json.dumps(
                    release.payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                content_type="application/json",
            )
            result["Content-Disposition"] = (
                f'attachment; filename="ember-cs-{release.pk}.json"'
            )
            result["Cache-Control"] = "public, max-age=31536000, immutable"
            result["ETag"] = f'"{release.content_hash}"'
            return result
        ws = workspace(request.user)
        books = accessible_books(ws, request.user)
        if request.method == "GET":
            if action == "session":
                reviewer = bool(request.user.has_perm("unit.review", ws.project))
                admin = bool(request.user.has_perm("project.edit", ws.project))
                output = {
                    "member": {
                        "id": str(request.user.pk),
                        "name": request.user.get_full_name() or request.user.username,
                        "email": request.user.email,
                        "role": "admin"
                        if admin
                        else "reviewer"
                        if reviewer
                        else "translator",
                    },
                    "csrf": get_token(request),
                }
            elif action == "books":
                titles = book_titles(books)
                output = {
                    "books": [
                        {
                            "id": b.pk,
                            "title": titles[b.pk],
                            "source_uuid": b.template["sourceUuid"],
                            "units": len(b.rows),
                            "reviewed": None,
                        }
                        for b in books
                    ]
                }
            elif action == "units":
                book_id = request.GET.get("book")
                search = request.GET.get("q", "")[:200].casefold()
                selected = [b for b in books if not book_id or b.pk == book_id]
                rows, _ = rows_for_books(selected)
                if search:
                    rows = [
                        r
                        for r in rows
                        if search in " ".join(r["source"] + r["value"]).casefold()
                    ]
                if request.GET.get("state") == "reviewed":
                    rows = [r for r in rows if r["approval"]]
                if request.GET.get("state") == "pending":
                    rows = [r for r in rows if not r["approval"]]
                offset = max(0, int(request.GET.get("offset", "0")))
                output = {"rows": rows[offset : offset + 60], "total": len(rows)}
            elif action == "glossary":
                output = {"entries": ws.metadata.get("glossary", [])}
            elif action == "proposals":
                output = {
                    "proposals": [
                        proposal_json(p)
                        for p in Proposal.objects.filter(workspace=ws)
                        .select_related("author")
                        .order_by("-updated_at")[:200]
                        if visible_proposal(p, books)
                    ]
                }
            elif action.startswith("proposals/"):
                p = Proposal.objects.select_related("author").get(
                    pk=action.split("/")[1], workspace=ws
                )
                if not visible_proposal(p, books):
                    raise Problem(403, "Chybí přístup k dokumentům návrhu.")
                ids = {c["unitId"] for c in p.changes}
                selected = [b for b in books if any(r["id"] in ids for r in b.rows)]
                rows, _ = rows_for_books(selected)
                output = {
                    "proposal": proposal_json(p),
                    "rows": [r for r in rows if r["id"] in ids],
                    "comments": [
                        {
                            "id": c.pk,
                            "body": c.body,
                            "author": c.author.get_full_name() or c.author.username,
                            "at": c.created_at.isoformat(),
                        }
                        for c in Comment.objects.filter(proposal=p)
                        .select_related("author")
                        .order_by("created_at")[:300]
                    ],
                }
            elif action == "history":
                # Events carry no source/proposal payload; native text history is linked separately.
                output = {
                    "events": [
                        {
                            "action": e.action,
                            "subject": e.subject,
                            "author": e.actor.get_full_name() or e.actor.username,
                            "at": e.created_at.isoformat(),
                        }
                        for e in Event.objects.filter(workspace=ws)
                        .select_related("actor")
                        .order_by("-created_at")[:100]
                    ]
                }
            else:
                raise Problem(404, "Stránka neexistuje.")
        else:
            if len(request.body) > 25 * 1024 * 1024:
                raise Problem(413, "Soubor je příliš velký.")
            data = json.loads(request.body)
            if not isinstance(data, dict):
                raise Problem(400, "Neplatná data.")
            if action == "import/preview":
                output = import_preview(request.user, data["json"])
            elif action == "import/commit":
                output = import_commit(request.user, data["json"], data["digest"])
            elif action == "proposals/save":
                output = save_proposal(request.user, data)
            elif action == "proposals/transition":
                output = transition(request.user, data)
            elif action == "publish":
                output = publish(request.user, data)
            elif action == "comments":
                p = Proposal.objects.get(pk=data["id"], workspace=ws)
                if not visible_proposal(p, books):
                    raise Problem(403, "Chybí přístup k návrhu.")
                body = data.get("body", "").strip()
                if not 1 <= len(body) <= 8000:
                    raise Problem(400, "Komentář musí mít 1 až 8000 znaků.")
                Comment.objects.create(proposal=p, author=request.user, body=body)
                output = {"ok": True}
            else:
                raise Problem(404, "Operace neexistuje.")
        result = JsonResponse(output)
        result["Cache-Control"] = "private, no-store"
        return result
    except Problem as error:
        return JsonResponse(
            {"error": error.message, "details": error.details},
            status=error.status,
            headers={"Cache-Control": "private, no-store"},
        )
    except ObjectDoesNotExist:
        return JsonResponse(
            {"error": "Záznam neexistuje."},
            status=404,
            headers={"Cache-Control": "private, no-store"},
        )
    except (ValueError, KeyError, TypeError, AttributeError, ValidationError) as error:
        return JsonResponse(
            {"error": str(error)[:1000]},
            status=400,
            headers={"Cache-Control": "private, no-store"},
        )
