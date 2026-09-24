from django.conf import settings
from django.core.management.base import BaseCommand
from weblate.trans.models import Project

from ember_bridge.models import Workspace


class Command(BaseCommand):
    help = "Create the private Ember project. Accounts, invitations and roles are managed by Weblate."

    def handle(self, *args, **kwargs):
        project, created = Project.objects.get_or_create(
            slug=settings.EMBER_PROJECT,
            defaults={
                "name": "Ember — Český překlad",
                "web": settings.SITE_URL,
                "access_control": Project.ACCESS_PRIVATE,
                "translation_review": True,
                "contribute_shared_tm": False,
                "use_shared_tm": False,
            },
        )
        if project.access_control != Project.ACCESS_PRIVATE:
            raise ValueError("The Ember project must be private.")
        Workspace.objects.get_or_create(project=project)
        self.stdout.write(
            "Soukromý projekt Ember je připraven. Členy pozvěte ve Weblate → Projekt → Přístup."
        )
