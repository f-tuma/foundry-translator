# ruff: noqa: F403, F405
from pathlib import Path

from weblate.settings_docker import *

INSTALLED_APPS = (*INSTALLED_APPS, "ember_bridge")
ROOT_URLCONF = "ember_bridge.urls"
EMBER_ENGINE_PATH = "/opt/ember/text-engine.cjs"
EMBER_PROJECT = "ember-cs"
LANGUAGE_CODE = "cs"
# Accounts and all authorization remain native Weblate. A closed private project
# admits only explicitly assigned members, even if someone creates an account.
DEFAULT_ACCESS_CONTROL = 100
DEFAULT_TRANSLATION_REVIEW = True
DEFAULT_SHARED_TM = False
REGISTRATION_OPEN = True  # required by native invitation registration
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024
# Keep login's redirect to the studio on this same host.
LOGIN_REDIRECT_URL = "/editor"
LOGOUT_REDIRECT_URL = "/vydani"
# Use native credential views with a separate presentation layer. The loader is
# scoped to account templates; administrators retain the native console.
TEMPLATES[0]["DIRS"] = [str(Path(__file__).parent / "templates")]
TEMPLATES[0]["APP_DIRS"] = False
TEMPLATES[0]["OPTIONS"]["loaders"] = [
    (
        "django.template.loaders.cached.Loader",
        [
            "django.template.loaders.filesystem.Loader",
            "ember_bridge.template_loader.Loader",
            "django.template.loaders.app_directories.Loader",
        ],
    )
]
MIDDLEWARE = list(MIDDLEWARE)
MIDDLEWARE.insert(
    MIDDLEWARE.index("django.contrib.auth.middleware.LoginRequiredMiddleware"),
    "ember_bridge.middleware.StudioBoundaryMiddleware",
)
MIDDLEWARE.insert(
    MIDDLEWARE.index("ember_bridge.middleware.StudioBoundaryMiddleware"),
    "ember_bridge.middleware.community_locale",
)
