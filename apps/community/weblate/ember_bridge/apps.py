from django.apps import AppConfig


def initialize_project(sender, **kwargs):
    from django.core.management import call_command

    call_command("ember_init", verbosity=0)


class EmberBridgeConfig(AppConfig):
    name = "ember_bridge"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from django.db.models.signals import post_migrate

        post_migrate.connect(
            initialize_project,
            sender=self,
            dispatch_uid="ember_bridge.initialize_project",
        )
