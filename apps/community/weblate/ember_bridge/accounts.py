"""Account presentation only; credential flows remain owned by Weblate."""

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from weblate.accounts.forms import UserForm
from weblate.accounts.views import user_profile
from weblate.auth.models import User

from .service import Problem, digest


@never_cache
@login_required
@require_GET
def security_page(request):
    # Reuse native context (registered factors, activity, etc.) with our template.
    # Profile edits go through the narrowly scoped, validated account endpoint.
    return user_profile(request)


def account_json(user):
    form = UserForm(instance=user)
    fields = {key: getattr(user, key) for key in ("username", "full_name", "email")}
    return {
        "id": str(user.pk),
        **fields,
        "name": user.get_full_name() or user.username,
        "emails": [value for value, _ in form.fields["email"].choices],
        "revision": digest(fields),
        "hasPassword": user.has_usable_password(),
        "hasSecondFactor": user.profile.has_2fa,
    }


@transaction.atomic
def update_account(request, data):
    user = User.objects.select_for_update().get(pk=request.user.pk)
    if data.get("revision") != account_json(user)["revision"]:
        raise Problem(
            409, "Účet se mezitím změnil. Obnovte stránku a zkontrolujte údaje."
        )
    # Native form allows only verified e-mails and validates unique usernames.
    # Reject unexpected fields: neither roles nor another user's ID are writable.
    if set(data) != {"revision", "username", "full_name", "email"}:
        raise Problem(400, "Neplatná pole účtu.")
    form = UserForm(data, instance=user)
    if not form.is_valid():
        raise Problem(400, "Zkontrolujte údaje účtu.", form.errors.get_json_data())
    form.audit(request)
    form.save()
    return account_json(user)
