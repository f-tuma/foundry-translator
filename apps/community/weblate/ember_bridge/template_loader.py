"""Reuse pinned Weblate account templates with the studio shell.

Only their parent template changes; form fields, CSRF, widget media, validation
and authentication endpoints stay native. Tests assert the pinned contract.
"""

from pathlib import Path

import weblate
from django.template import Origin, TemplateDoesNotExist
from django.template.loaders.base import Loader as BaseLoader

NATIVE = Path(weblate.__file__).parent / "templates"
ACCOUNT_TEMPLATES = frozenset(
    {
        "accounts/login.html",
        "accounts/register.html",
        "accounts/reset.html",
        "accounts/password.html",
        "accounts/2fa.html",
        "accounts/email.html",
        "accounts/email-sent.html",
        "accounts/confirm.html",
        "accounts/totp.html",
        "accounts/recovery-codes.html",
        "accounts/removal.html",
        "accounts/redirect.html",
        "weblate_auth/invitation_detail.html",
    }
)


class Loader(BaseLoader):
    def get_template_sources(self, template_name):
        if template_name == "ember/native-login-info.html":
            yield Origin(
                str(NATIVE / "accounts/snippets/login-info.html"), template_name, self
            )
        if template_name in ACCOUNT_TEMPLATES:
            yield Origin(str(NATIVE / template_name), template_name, self)

    def get_contents(self, origin):
        try:
            source = Path(origin.name).read_text()
        except FileNotFoundError as error:
            raise TemplateDoesNotExist(origin) from error
        return source.replace(
            '{% extends "base.html" %}', '{% extends "ember/account-base.html" %}', 1
        )
