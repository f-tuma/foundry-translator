from django.urls import path
from weblate.urls import urlpatterns as native_patterns

from . import views
from .accounts import security_page

urlpatterns = [
    path("weblate/foundry/<path:action>", views.endpoint),
    path("weblate/accounts/profile/", security_page),
] + native_patterns
