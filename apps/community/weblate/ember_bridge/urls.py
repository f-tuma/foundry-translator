from django.urls import path
from weblate.urls import urlpatterns as native_patterns

from . import views

urlpatterns = [path("weblate/foundry/<path:action>", views.endpoint)] + native_patterns
