from django.conf import settings
from django.db import models


class Workspace(models.Model):
    project = models.OneToOneField(
        "trans.Project", on_delete=models.PROTECT, related_name="ember_workspace"
    )
    metadata = models.JSONField(default=dict)
    # Per-term editorial revision/approval; never included in public bundles.
    glossary_state = models.JSONField(default=dict)


class Book(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    workspace = models.ForeignKey(Workspace, on_delete=models.PROTECT)
    component = models.OneToOneField("trans.Component", on_delete=models.PROTECT)
    title = models.TextField()
    template = models.JSONField()
    # Immutable mapping/structure only. Current text belongs to Weblate Units.
    rows = models.JSONField()


class Proposal(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.PROTECT)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=20, default="draft")
    revision = models.PositiveIntegerField(default=1)
    changes = models.JSONField()
    approval = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ProposalRequest(models.Model):
    id = models.UUIDField(primary_key=True)
    proposal = models.ForeignKey(Proposal, on_delete=models.PROTECT)
    request_hash = models.CharField(max_length=64)


class Comment(models.Model):
    proposal = models.ForeignKey(Proposal, on_delete=models.PROTECT)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="ember_comments",
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)


class Release(models.Model):
    id = models.CharField(primary_key=True, max_length=80)
    workspace = models.ForeignKey(Workspace, on_delete=models.PROTECT)
    title = models.CharField(max_length=200)
    notes = models.TextField()
    payload = models.JSONField()
    content_hash = models.CharField(max_length=64)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    document_count = models.PositiveIntegerField()
    unit_count = models.PositiveIntegerField()
    reviewed_count = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class Event(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=80)
    subject = models.CharField(max_length=200)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
