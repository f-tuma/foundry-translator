"""Integration tests against Weblate's real database models and translation API."""

import copy
import json
import subprocess
import tempfile
import uuid
from unittest.mock import patch

from django.db import transaction
from django.test import Client, TestCase, override_settings
from weblate.auth.data import SELECTION_ALL
from weblate.auth.models import Group, Role, User
from weblate.trans.models import Project, Unit
from weblate.utils.state import STATE_TRANSLATED

from .models import Book, Proposal, Release, Workspace
from .service import (
    Problem,
    import_commit,
    import_preview,
    publish,
    rows_for_books,
    save_proposal,
    transition,
)


def fixture():
    return dict(
        format="foundry-translate-bundle",
        version=3,
        moduleVersion="0.28.0",
        createdAt="2026-09-24",
        systemId="crucible",
        systemVersion="1",
        targetLanguage="cs",
        glossary=[],
        documents=[
            dict(
                kind="JournalEntry",
                sourceUuid="JournalEntry.synthetic",
                sourceName="Private original",
                sourceFingerprint="a" * 64,
                partial=False,
                processedPageIds=["page"],
                fallbackTextSegments=0,
                providerId="openai-compatible",
                sourceLanguage="en",
                translatedAt="2026-09-24",
                engineRevision=1,
                patches=[
                    dict(
                        path=["name"],
                        format="text",
                        source="Private original",
                        translation="Příručka",
                    ),
                    dict(
                        path=["pages", 0, "text", "content"],
                        format="html",
                        source="<p>The forest is quiet.</p><p>The scout waits. @UUID[Actor.scout]{Scout}</p>",
                        translation="<p>Les je tichý.</p><p>Zvěd čeká. @UUID[Actor.scout]{Zvěd}</p>",
                    ),
                ],
            )
        ],
    )


class EditorialTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ember-tests-")
        self.addCleanup(self.directory.cleanup)
        self.settings_override = override_settings(
            DATA_DIR=self.directory.name,
            CACHE_DIR=None,
            EMBER_PROJECT="test-" + uuid.uuid4().hex,
            ALLOWED_HOSTS=["testserver"],
            CELERY_TASK_ALWAYS_EAGER=False,
        )
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        from pathlib import Path

        from weblate.vcs.git import LocalRepository

        Path(self.directory.name, "home").mkdir()
        LocalRepository.global_setup()
        from django.conf import settings

        project = Project.objects.create(
            slug=settings.EMBER_PROJECT,
            name="Synthetic private project",
            web="https://example.test",
            access_control=Project.ACCESS_PRIVATE,
            translation_review=True,
            contribute_shared_tm=False,
            use_shared_tm=False,
        )
        self.ws = Workspace.objects.create(project=project)
        self.admin = User.objects.create_user(
            "test-admin", "admin@example.test", is_superuser=True, is_active=True
        )
        self.author = User.objects.create_user(
            "test-author", "author@example.test", is_active=True
        )
        self.reviewer = User.objects.create_user(
            "test-reviewer", "reviewer@example.test", is_active=True
        )
        self.outsider = User.objects.create_user(
            "test-outsider", "outsider@example.test", is_active=True
        )
        for user, role in [
            (self.author, "Translate"),
            (self.reviewer, "Review strings"),
        ]:
            group = Group.objects.create(
                name=user.username, language_selection=SELECTION_ALL
            )
            group.projects.add(project)
            group.roles.add(Role.objects.get(name=role))
            user.groups.add(group)
            user.clear_permissions_cache()
        self.input = json.dumps(fixture(), ensure_ascii=False)
        preview = import_preview(self.admin, self.input)
        import_commit(self.admin, self.input, preview["digest"])
        self.book = Book.objects.get(workspace=self.ws)
        # TestCase keeps on_commit jobs deferred; scan explicitly in this test DB.
        self.book.component.create_translations_immediate(force=True)
        self.rows, self.native = rows_for_books([self.book])

    def proposal(self, count=1):
        changes = [
            dict(
                unitId=r["id"],
                baseRevision=r["revision"],
                before=r["value"],
                after=[
                    v.replace("Příručka", "Průvodce").replace(
                        "Les je tichý.", "Les mlčí."
                    )
                    for v in r["value"]
                ],
            )
            for r in self.rows[:count]
        ]
        data = dict(requestId=str(uuid.uuid4()), title="Oprava", changes=changes)
        saved = save_proposal(self.author, data)
        return dict(id=saved["id"], revision=1), data

    def approved(self, count=1):
        args, data = self.proposal(count)
        transition(self.author, {**args, "action": "submit"})
        transition(self.reviewer, {**args, "action": "approve"})
        return args, data

    def assert_problem(self, status, fn, *args):
        with self.assertRaises(Problem) as caught:
            fn(*args)
        self.assertEqual(caught.exception.status, status)

    def test_import_is_idempotent_and_never_overwrites_changed_export(self):
        preview = import_preview(self.admin, self.input)
        self.assertEqual(
            import_commit(self.admin, self.input, preview["digest"]),
            {"imported": 0, "duplicate": True},
        )
        altered = fixture()
        altered["documents"][0]["patches"][0]["translation"] = "Jiný text"
        text = json.dumps(altered)
        self.assertTrue(import_preview(self.admin, text)["conflicts"])
        self.assert_problem(
            409,
            import_commit,
            self.admin,
            text,
            import_preview(self.admin, text)["digest"],
        )
        self.assertEqual(rows_for_books([self.book])[0][0]["value"], ["Příručka"])

    def test_anonymous_outsider_csrf_and_revocation(self):
        client = Client(enforce_csrf_checks=True)
        for path in ("session", "books", "units", "glossary", "proposals", "history"):
            self.assertEqual(client.get("/weblate/foundry/" + path).status_code, 401)
        client.force_login(self.outsider)
        self.assertEqual(client.get("/weblate/foundry/units").status_code, 403)
        client.force_login(self.author)
        self.assertEqual(client.get("/weblate/foundry/units").status_code, 200)
        self.assertEqual(
            client.post(
                "/weblate/foundry/proposals/save",
                data="{}",
                content_type="application/json",
            ).status_code,
            403,
        )
        self.author.groups.clear()
        self.author.clear_permissions_cache()
        self.assertEqual(client.get("/weblate/foundry/units").status_code, 403)

    def test_translator_cannot_import_publish_or_self_approve(self):
        self.assert_problem(403, import_preview, self.author, self.input)
        self.assert_problem(
            403, publish, self.author, {"id": "v1", "title": "Vydání", "notes": ""}
        )
        args, _ = self.proposal()
        transition(self.author, {**args, "action": "submit"})
        self.assert_problem(403, transition, self.author, {**args, "action": "approve"})
        self.assertEqual(rows_for_books([self.book])[0][0]["value"], ["Příručka"])

    def test_safe_save_retry_and_approved_atomic_merge(self):
        args, data = self.approved(2)
        self.assertTrue(save_proposal(self.author, data)["duplicate"])
        transition(self.reviewer, {**args, "action": "merge"})
        self.assertTrue(
            transition(self.reviewer, {**args, "action": "merge"})["duplicate"]
        )
        self.assertTrue(
            transition(self.author, {**args, "action": "submit"})["duplicate"]
        )
        self.assertEqual(Proposal.objects.get(pk=args["id"]).status, "merged")
        rows, _ = rows_for_books([self.book])
        self.assertEqual(rows[0]["value"], ["Průvodce"])
        self.assertEqual(rows[1]["value"], ["Les mlčí."])
        self.assertTrue(rows[0]["approval"])
        altered = copy.deepcopy(data)
        altered["title"] = "Other"
        self.assert_problem(409, save_proposal, self.author, altered)

    def test_external_native_edit_blocks_entire_merge(self):
        args, _ = self.approved(2)
        unit = self.native[self.rows[1]["id"]][0]
        with transaction.atomic():
            unit.translate(
                self.reviewer, "Tichý les.", STATE_TRANSLATED, propagate=False
            )
        self.assert_problem(409, transition, self.reviewer, {**args, "action": "merge"})
        rows, _ = rows_for_books([self.book])
        self.assertEqual(rows[0]["value"], ["Příručka"])
        self.assertEqual(rows[1]["value"], ["Tichý les."])
        self.assertEqual(Proposal.objects.get(pk=args["id"]).status, "approved")

    def test_late_native_failure_rolls_back_all_written_units(self):
        args, _ = self.approved(2)
        original = Unit.translate
        calls = []

        def fail_second(unit, *a, **kw):
            calls.append(unit.pk)
            if len(calls) == 2:
                raise Problem(409, "Synthetic native rejection")
            return original(unit, *a, **kw)

        with patch.object(Unit, "translate", fail_second):
            self.assert_problem(
                409, transition, self.reviewer, {**args, "action": "merge"}
            )
        self.assertEqual(len(calls), 2)
        rows, _ = rows_for_books([self.book])
        self.assertEqual(rows[0]["value"], ["Příručka"])
        self.assertEqual(rows[1]["value"], ["Les je tichý."])
        self.assertEqual(Proposal.objects.get(pk=args["id"]).status, "approved")

    def test_explicit_rebase_invalidates_approval(self):
        args, _ = self.approved()
        unit = self.native[self.rows[0]["id"]][0]
        with transaction.atomic():
            unit.translate(
                self.reviewer, "Nová Příručka", STATE_TRANSLATED, propagate=False
            )
        rows, _ = rows_for_books([self.book])
        bases = [{"unitId": r["id"], "revision": r["revision"]} for r in rows]
        transition(self.author, {**args, "action": "rebase", "bases": bases})
        p = Proposal.objects.get(pk=args["id"])
        self.assertEqual(p.revision, 2)
        self.assertIsNone(p.approval)
        self.assertEqual(p.changes[0]["before"], ["Nová Příručka"])
        self.assert_problem(409, transition, self.reviewer, {**args, "action": "merge"})

    def test_public_snapshot_is_immutable_and_source_free(self):
        args, _ = self.approved()
        transition(self.reviewer, {**args, "action": "merge"})
        request = {"id": "v1", "title": "Český překlad", "notes": "Veřejné poznámky"}
        publish(self.admin, request)
        saved = Release.objects.get(pk="v1")
        payload = copy.deepcopy(saved.payload)
        unit = self.native[self.rows[0]["id"]][0]
        with transaction.atomic():
            unit.translate(
                self.reviewer, "Pozdější změna", STATE_TRANSLATED, propagate=False
            )
        self.assertTrue(publish(self.admin, request)["duplicate"])
        response = Client().get("/weblate/foundry/download/v1")
        self.assertEqual(response.status_code, 200)
        text = response.content.decode()
        self.assertNotIn("Private original", text)
        self.assertNotIn("The forest is quiet", text)
        self.assertNotIn("test-author", text)
        self.assertNotIn("Pozdější změna", text)
        self.assertEqual(response.json(), payload)
        self.assertEqual(response["ETag"], f'"{saved.content_hash}"')
        self.assertEqual(Client().get("/weblate/foundry/releases").status_code, 200)

    def test_editing_a_proposal_invalidates_approval_and_retries_safely(self):
        args, data = self.approved()
        updated = {
            **data,
            "id": args["id"],
            "revision": 1,
            "requestId": str(uuid.uuid4()),
            "title": "Přesnější oprava",
        }
        updated["changes"] = copy.deepcopy(data["changes"])
        updated["changes"][0]["after"] = ["Průvodce Světem"]
        save_proposal(self.author, updated)
        self.assertTrue(save_proposal(self.author, updated)["duplicate"])
        p = Proposal.objects.get(pk=args["id"])
        self.assertEqual(p.revision, 2)
        self.assertEqual(p.status, "draft")
        self.assertIsNone(p.approval)
        self.assert_problem(409, transition, self.reviewer, {**args, "action": "merge"})
        self.assertEqual(rows_for_books([self.book])[0][0]["value"], ["Příručka"])

    def test_revoked_approver_cannot_authorize_a_later_admin_merge(self):
        args, _ = self.approved()
        self.reviewer.groups.clear()
        self.assert_problem(409, transition, self.admin, {**args, "action": "merge"})
        self.assertEqual(rows_for_books([self.book])[0][0]["value"], ["Příručka"])

    def test_import_failure_removes_only_the_new_repository(self):
        from pathlib import Path

        from weblate.vcs.git import LocalRepository

        source = fixture()
        source["documents"][0]["sourceUuid"] = "JournalEntry.second"
        raw = json.dumps(source)
        preview = import_preview(self.admin, raw)
        original = LocalRepository.from_files
        created = []

        def fail_after_git(path, files):
            created.append(path)
            original(path, files)
            raise RuntimeError("Synthetic import failure")

        with patch.object(LocalRepository, "from_files", fail_after_git):
            with self.assertRaises(RuntimeError):
                import_commit(self.admin, raw, preview["digest"])
        self.assertEqual(len(created), 1)
        self.assertFalse(Path(created[0]).exists())
        self.assertTrue(Path(self.book.component.full_path).exists())
        self.assertEqual(Book.objects.filter(workspace=self.ws).count(), 1)

    def test_account_is_available_without_membership_but_content_stays_private(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.get("/weblate/foundry/account").status_code, 401)
        client.force_login(self.outsider)
        session = client.get("/weblate/foundry/session").json()
        self.assertIsNone(session["member"])
        self.assertEqual(session["account"]["username"], self.outsider.username)
        self.assertNotIn("password", session["account"])
        self.assertEqual(client.get("/weblate/foundry/units").status_code, 403)
        self.assertEqual(client.get("/weblate/accounts/profile/").status_code, 200)

    def test_account_edits_use_native_validation_csrf_audit_and_revision(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.author)
        session = client.get("/weblate/foundry/session").json()
        original = session["account"]
        payload = {
            k: original[k] for k in ("username", "full_name", "email", "revision")
        }
        payload["full_name"] = "Zkušební Překladatel"
        url = "/weblate/foundry/account"
        self.assertEqual(
            client.post(url, data=payload, content_type="application/json").status_code,
            403,
        )

        def post(data):
            return client.post(
                url,
                data=data,
                content_type="application/json",
                HTTP_X_CSRFTOKEN=session["csrf"],
            )

        self.assertEqual(post({**payload, "is_superuser": True}).status_code, 400)
        self.assertEqual(
            post({**payload, "email": "unverified@example.test"}).status_code, 400
        )
        self.assertEqual(
            post({**payload, "username": self.reviewer.username}).status_code, 400
        )
        before = self.author.auditlog_set.count()
        response = post(payload)
        self.assertEqual(response.status_code, 200, response.content)
        self.author.refresh_from_db()
        self.assertEqual(self.author.full_name, payload["full_name"])
        self.assertEqual(self.author.email, original["email"])
        self.assertFalse(self.author.is_superuser)
        self.assertGreater(self.author.auditlog_set.count(), before)
        self.assertEqual(post({**payload, "full_name": "Stale edit"}).status_code, 409)
        self.author.refresh_from_db()
        self.assertEqual(self.author.full_name, payload["full_name"])

    def test_native_editor_is_reserved_for_admins(self):
        client = Client()
        native = f"/weblate/projects/{self.ws.project.slug}/"
        self.assertRedirects(
            client.get(native), "/prehled", fetch_redirect_response=False
        )
        client.force_login(self.reviewer)
        self.assertRedirects(
            client.get(native), "/prehled", fetch_redirect_response=False
        )
        self.assertEqual(client.post(native).status_code, 403)
        self.assertEqual(client.get("/weblate/api/projects/").status_code, 403)
        client.force_login(self.admin)
        self.assertEqual(client.get(native).status_code, 200)

    def test_account_templates_keep_native_forms_and_brand_shell(self):
        from django.template.loader import get_template

        from .template_loader import ACCOUNT_TEMPLATES, NATIVE

        for name in ACCOUNT_TEMPLATES:
            self.assertIn('{% extends "base.html" %}', (NATIVE / name).read_text())
            get_template(name)
        client = Client(enforce_csrf_checks=True)
        for path in ("login", "reset", "register"):
            response = client.get(
                "/weblate/accounts/" + path + "/", HTTP_ACCEPT_LANGUAGE="en-US"
            )
            self.assertEqual(response.status_code, 200, response.content[:300])
            self.assertEqual(response["Content-Language"], "cs")
            if path == "login":
                self.assertContains(response, "Uživatelské jméno nebo e-mail")
            self.assertContains(response, 'id="ember-account-content"')
            self.assertContains(response, "csrfmiddlewaretoken")
            self.assertNotContains(response, "navbar-collapse")
        self.assertEqual(
            client.post(
                "/weblate/accounts/login/", {"username": "bad", "password": "bad"}
            ).status_code,
            403,
        )
        client.force_login(self.author)
        for path in ("password", "profile"):
            response = client.get("/weblate/accounts/" + path + "/")
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, 'id="ember-account-content"')
        self.assertEqual(
            client.post(
                "/weblate/accounts/profile/",
                HTTP_X_CSRFTOKEN=client.get("/weblate/foundry/session").json()["csrf"],
            ).status_code,
            405,
        )

    def test_native_login_still_enforces_second_factor_and_safe_redirect(self):
        from django_otp.plugins.otp_totp.models import TOTPDevice

        self.author.set_password("Synthetic-test-password-123!")
        self.author.save()
        client = Client()
        response = client.post(
            "/weblate/accounts/login/",
            {
                "username": self.author.username,
                "password": "Synthetic-test-password-123!",
                "next": "https://external.example.test/",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertNotIn("external.example.test", response.url)
        client.logout()
        device = TOTPDevice.objects.create(
            user=self.author, name="Test TOTP", confirmed=True
        )
        response = client.post(
            "/weblate/accounts/login/",
            {
                "username": self.author.username,
                "password": "Synthetic-test-password-123!",
                "next": "/editor",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertIn("/auth/second-factor/", response.url)
        self.assertEqual(client.get("/weblate/foundry/units").status_code, 401)
        self.assertContains(client.get(response.url), 'id="ember-account-content"')
        from django_otp.oath import totp

        token = str(
            totp(device.bin_key, step=device.step, t0=device.t0, digits=device.digits)
        ).zfill(device.digits)
        verified = client.post(response.url, {"otp_token": token, "next": "/editor"})
        self.assertEqual(verified.status_code, 302)
        self.assertEqual(client.get("/weblate/foundry/units").status_code, 200)

    def test_native_invitation_keeps_matching_user_check(self):
        from weblate.auth.models import Invitation

        invite = Invitation.objects.create(
            author=self.admin,
            user=self.outsider,
            email=self.outsider.email,
            username=self.outsider.username,
            full_name="",
            group=self.author.groups.get(name=self.author.username),
        )
        client = Client()
        client.force_login(self.reviewer)
        self.assertEqual(client.post(invite.get_absolute_url()).status_code, 302)
        self.assertFalse(self.outsider.groups.filter(pk=invite.group_id).exists())
        client.force_login(self.outsider)
        response = client.get(invite.get_absolute_url())
        self.assertContains(response, 'id="ember-account-content"')
        response = client.post(invite.get_absolute_url())
        self.assertEqual(response.status_code, 302)
        self.assertTrue(self.outsider.groups.filter(pk=invite.group_id).exists())

    def test_logout_keeps_ember_shell_and_ends_session_with_native_csrf(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.author)
        csrf = client.get("/weblate/foundry/session").json()["csrf"]
        url = "/weblate/accounts/logout/"
        self.assertEqual(client.get(url).status_code, 405)
        self.assertEqual(client.post(url).status_code, 403)
        self.assertEqual(client.get("/weblate/foundry/session").status_code, 200)
        response = client.post(url, HTTP_X_CSRFTOKEN=csrf)
        self.assertContains(response, 'id="ember-account-content"')
        self.assertContains(response, "Odhlášeno")
        self.assertNotContains(response, "navbar-collapse")
        self.assertEqual(client.get("/weblate/foundry/session").status_code, 401)

    def seed_glossary(self):
        self.ws.refresh_from_db()
        self.ws.metadata["glossary"] = [
            {
                "source": "Old Carinth",
                "replacement": "Starý Carinth",
                "category": "location",
                "aliases": [],
                "mode": "inflect",
            },
            {
                "source": "Scout",
                "replacement": "Zvěd",
                "category": "character",
                "aliases": [],
            },
        ]
        self.ws.save(update_fields=["metadata"])
        from .glossary import glossary_rows

        return glossary_rows(self.ws)

    def glossary_proposal(self):
        row = self.seed_glossary()[0]
        after = list(row["value"])
        after[0] = "Starobylý Carinth"
        after[3] = "Soukromá poznámka redakce"
        data = {
            "requestId": str(uuid.uuid4()),
            "title": "Glosář: Carinth",
            "changes": [
                {
                    "unitId": row["id"],
                    "baseRevision": row["revision"],
                    "before": row["value"],
                    "after": after,
                }
            ],
        }
        saved = save_proposal(self.author, data)
        return {"id": saved["id"], "revision": 1}, data

    def test_glossary_uses_separate_review_atomic_merge_and_public_snapshot(self):
        from .glossary import glossary_rows

        args, data = self.glossary_proposal()
        self.assertTrue(save_proposal(self.author, data)["duplicate"])
        client = Client()
        client.force_login(self.reviewer)
        response = client.get("/weblate/foundry/proposals/" + args["id"])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["rows"][0]["kind"], "glossary")
        transition(self.author, {**args, "action": "submit"})
        self.assert_problem(403, transition, self.author, {**args, "action": "approve"})
        transition(self.reviewer, {**args, "action": "approve"})
        self.ws.refresh_from_db()
        self.assertEqual(glossary_rows(self.ws)[0]["value"][0], "Starý Carinth")
        transition(self.reviewer, {**args, "action": "merge"})
        self.ws.refresh_from_db()
        row = glossary_rows(self.ws)[0]
        self.assertEqual(row["value"][0], "Starobylý Carinth")
        self.assertTrue(row["approval"])
        self.assertNotEqual(row["revision"], data["changes"][0]["baseRevision"])
        self.assertEqual(rows_for_books([self.book])[0][0]["value"], ["Příručka"])
        self.assertTrue(
            transition(self.reviewer, {**args, "action": "merge"})["duplicate"]
        )
        publish(
            self.admin, {"id": "glossary-v1", "title": "Opravený glosář", "notes": ""}
        )
        release = Release.objects.get(pk="glossary-v1").payload
        term = release["bundle"]["glossary"][0]
        self.assertEqual(term["replacement"], "Starobylý Carinth")
        self.assertEqual(term["mode"], "inflect")
        self.assertNotIn("notes", term)
        self.assertNotIn("glossary_state", release["bundle"])

    def test_glossary_conflict_alias_validation_and_revoked_approver(self):
        from .glossary import glossary_rows

        args, data = self.glossary_proposal()
        bad = copy.deepcopy(data)
        bad["requestId"] = str(uuid.uuid4())
        bad["changes"][0]["after"][4] = "Scout"
        with self.assertRaises(ValueError):
            save_proposal(self.author, bad)
        self.assertEqual(Proposal.objects.filter(workspace=self.ws).count(), 1)
        transition(self.author, {**args, "action": "submit"})
        transition(self.reviewer, {**args, "action": "approve"})
        self.ws.refresh_from_db()
        self.ws.metadata["glossary"][0]["replacement"] = "Jiný Carinth"
        self.ws.save(update_fields=["metadata"])
        self.assert_problem(409, transition, self.reviewer, {**args, "action": "merge"})
        self.ws.refresh_from_db()
        self.assertFalse(glossary_rows(self.ws)[0]["approval"])
        current = glossary_rows(self.ws)[0]
        transition(
            self.author,
            {
                **args,
                "action": "rebase",
                "bases": [{"unitId": current["id"], "revision": current["revision"]}],
            },
        )
        p = Proposal.objects.get(pk=args["id"])
        self.assertIsNone(p.approval)
        self.assertEqual(p.revision, 2)
        args["revision"] = 2
        transition(self.author, {**args, "action": "submit"})
        transition(self.reviewer, {**args, "action": "approve"})
        self.reviewer.groups.clear()
        self.assert_problem(409, transition, self.admin, {**args, "action": "merge"})

    def test_glossary_and_document_changes_rollback_together(self):
        args, data = self.glossary_proposal()
        row = self.rows[0]
        data.update(id=args["id"], revision=1, requestId=str(uuid.uuid4()))
        data["changes"].append(
            {
                "unitId": row["id"],
                "baseRevision": row["revision"],
                "before": row["value"],
                "after": ["Nová Příručka"],
            }
        )
        save_proposal(self.author, data)
        args["revision"] = 2
        transition(self.author, {**args, "action": "submit"})
        transition(self.reviewer, {**args, "action": "approve"})
        with patch(
            "ember_bridge.glossary.merge_glossary",
            side_effect=Problem(409, "Late failure"),
        ):
            self.assert_problem(
                409, transition, self.reviewer, {**args, "action": "merge"}
            )
        self.assertEqual(rows_for_books([self.book])[0][0]["value"], ["Příručka"])
        self.assertEqual(Proposal.objects.get(pk=args["id"]).status, "approved")

    def test_dashboard_counts_current_rows_separately_from_approved_proposals(self):
        client = Client()
        self.assertEqual(client.get("/weblate/foundry/dashboard").status_code, 401)
        client.force_login(self.outsider)
        self.assertEqual(client.get("/weblate/foundry/dashboard").status_code, 403)
        client.force_login(self.reviewer)
        args, _ = self.approved()
        data = client.get("/weblate/foundry/dashboard").json()
        self.assertEqual(data["totals"]["units"], len(self.rows))
        self.assertEqual(data["totals"]["reviewed"], 0)
        self.assertEqual(data["proposals"]["approved"], 1)
        self.assertEqual(data["documents"][0]["open_proposals"], 1)
        self.assertNotIn("Private original", json.dumps(data))
        self.assertNotIn("The forest is quiet", json.dumps(data))
        transition(self.reviewer, {**args, "action": "merge"})
        data = client.get("/weblate/foundry/dashboard").json()
        self.assertEqual(data["totals"]["reviewed"], 1)
        self.assertEqual(data["proposals"]["approved"], 0)
        self.assertEqual(data["proposals"]["merged"], 1)
        self.assertEqual(data["documents"][0]["title"], "Průvodce")
        self.assertEqual(data["documents"][0]["open_proposals"], 0)
        # Revocation of component visibility must also hide its proposal activity.
        with patch("ember_bridge.views.accessible_books", return_value=[]):
            data = client.get("/weblate/foundry/dashboard").json()
        self.assertEqual(data["totals"]["units"], 0)
        self.assertFalse(data["activity"])
        self.assertFalse(data["work"])
        self.assertEqual(data["proposals"]["merged"], 0)

    def test_dashboard_missing_or_changed_native_parts_are_unknown_not_pending(self):
        client = Client()
        client.force_login(self.reviewer)
        part = self.native[self.rows[0]["id"]][0]
        Unit.objects.filter(pk=part.pk).update(source="Different source")
        data = client.get("/weblate/foundry/dashboard").json()
        self.assertEqual(data["totals"]["unknown"], 1)
        self.assertEqual(data["totals"]["reviewed"], 0)
        Unit.objects.filter(pk=part.pk).update(context="not-in-import")
        self.assertEqual(
            client.get("/weblate/foundry/dashboard").json()["totals"]["unknown"], 1
        )

    def test_dashboard_requires_every_part_and_counts_glossary_separately(self):
        from weblate.utils.state import STATE_APPROVED

        from .dashboard import overview

        terms = self.seed_glossary()
        # One logical row can span two native strings: approving one is insufficient.
        row = copy.deepcopy(self.rows[0])
        row["source"] = ["First", "Second"]
        book = copy.copy(self.book)
        book.rows = [row]
        parts = [
            {
                "translation__component_id": book.component_id,
                "context": f"{row['id']}_{i}",
                "source": source,
                "target": "Překlad",
                "state": STATE_APPROVED if i == 0 else STATE_TRANSLATED,
                "last_updated": self.native[self.rows[0]["id"]][0].last_updated,
            }
            for i, source in enumerate(row["source"])
        ]
        with patch("ember_bridge.dashboard.Unit.objects.filter") as query:
            query.return_value.values.return_value = parts
            data = overview(self.ws, [book], self.reviewer)
            self.assertEqual(data["totals"], {"units": 1, "reviewed": 0, "unknown": 0})
            parts[1]["state"] = STATE_APPROVED
            data = overview(self.ws, [book], self.reviewer)
        self.assertEqual(data["totals"]["reviewed"], 1)
        self.assertEqual(data["glossary"]["total"], len(terms))
        self.assertEqual(data["glossary"]["reviewed"], 0)

    def test_reviewer_cannot_reject_or_retry_hidden_document_proposals(self):
        args, _ = self.approved()
        with patch.object(User, "can_access_component", return_value=False):
            self.assert_problem(
                403, transition, self.reviewer, {**args, "action": "reject"}
            )
            self.assert_problem(
                403, transition, self.reviewer, {**args, "action": "merge"}
            )
        self.assertEqual(Proposal.objects.get(pk=args["id"]).status, "approved")

    def test_rejection_does_not_require_valid_translation_content(self):
        args, _ = self.approved()
        with patch(
            "ember_bridge.service.content_engine",
            side_effect=ValueError("Invalid content"),
        ):
            transition(self.reviewer, {**args, "action": "reject"})
        self.assertEqual(Proposal.objects.get(pk=args["id"]).status, "rejected")

    def test_history_respects_component_visibility(self):
        self.approved()
        client = Client()
        client.force_login(self.reviewer)
        self.assertTrue(client.get("/weblate/foundry/history").json()["events"])
        with patch("ember_bridge.views.accessible_books", return_value=[]):
            self.assertFalse(client.get("/weblate/foundry/history").json()["events"])

    def test_import_limit_counts_file_bytes_not_escaped_request(self):
        client = Client()
        client.force_login(self.admin)
        large = fixture()
        large["ignored"] = "\\" * (9 * 1024 * 1024)
        text = json.dumps(large)
        body = json.dumps({"json": text})
        self.assertLess(len(text.encode()), 25 * 1024 * 1024)
        self.assertGreater(len(body.encode()), 25 * 1024 * 1024)
        response = client.post(
            "/weblate/foundry/import/preview",
            data=body,
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content[:500])
        self.assert_problem(413, import_preview, self.admin, "ž" * (13 * 1024 * 1024))

    def test_content_timeout_returns_retryable_error_and_keeps_proposal(self):
        client = Client()
        client.force_login(self.reviewer)
        args, _ = self.approved()
        with patch(
            "ember_bridge.service.content_engine",
            side_effect=subprocess.TimeoutExpired("node", 45),
        ):
            response = client.post(
                "/weblate/foundry/proposals/transition",
                data={**args, "action": "merge"},
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(Proposal.objects.get(pk=args["id"]).status, "approved")
        self.assertEqual(rows_for_books([self.book])[0][0]["value"], ["Příručka"])
