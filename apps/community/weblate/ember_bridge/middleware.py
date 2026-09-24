from django.conf import settings
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import translation
from django.utils.deprecation import MiddlewareMixin

from .models import Workspace


def community_locale(get_response):
    def middleware(request):
        if request.path_info.startswith(
            (
                "/weblate/accounts/",
                "/weblate/foundry/",
                "/weblate/js/",
            )
        ):
            # This studio serves one Czech community, regardless of browser or
            # native console language preferences. Do not alter stored profiles.
            with translation.override("cs"):
                request.LANGUAGE_CODE = "cs"
                response = get_response(request)
                response["Content-Language"] = "cs"
                return response
        return get_response(request)

    return middleware


class StudioBoundaryMiddleware(MiddlewareMixin):
    """Keep native editing/admin endpoints out of the contributor workflow.

    The account/authentication namespace (including invitation and MFA flows)
    remains native. Authorization inside the bridge and Weblate still applies.
    """

    def process_view(self, request, view_func, view_args, view_kwargs):
        path = request.path_info
        if not path.startswith("/weblate/"):
            return None
        if path.startswith(
            (
                "/weblate/accounts/",
                "/weblate/foundry/",
                "/weblate/static/",
                "/weblate/js/",
                "/weblate/legal/",
                "/weblate/healthz/",
            )
        ):
            return None
        user = request.user
        if user.is_authenticated and user.is_active:
            if user.is_superuser:
                return None
            ws = (
                Workspace.objects.select_related("project")
                .filter(project__slug=settings.EMBER_PROJECT)
                .first()
            )
            if ws and user.has_perm("project.edit", ws.project):
                return None
        if request.method in ("GET", "HEAD") and not path.startswith("/weblate/api/"):
            return HttpResponseRedirect("/editor")
        return JsonResponse(
            {"error": "Překlady se upravují v komunitním editoru."},
            status=403,
            headers={"Cache-Control": "private, no-store"},
        )
