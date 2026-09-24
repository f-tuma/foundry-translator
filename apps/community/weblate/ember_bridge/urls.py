from django.urls import path
from weblate.accounts.views import WeblateLogoutView
from weblate.urls import urlpatterns as native_patterns

from . import views
from .accounts import security_page

urlpatterns = [
    path("weblate/foundry/<path:action>", views.endpoint),
    path("weblate/accounts/profile/", security_page),
    path(
        "weblate/accounts/logout/",
        WeblateLogoutView.as_view(template_name="ember/signed-out.html"),
    ),
] + native_patterns
