# ruff: noqa: F403, F405
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
