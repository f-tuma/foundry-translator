import json
import subprocess

from django.conf import settings


def content_engine(action, **kwargs):
    result = subprocess.run(
        ["/usr/local/bin/node", settings.EMBER_ENGINE_PATH],
        input=json.dumps({"action": action, **kwargs}, ensure_ascii=False),
        capture_output=True,
        text=True,
        timeout=45,
        check=False,
    )
    if len(result.stdout) > 60 * 1024 * 1024:
        raise ValueError("Příliš rozsáhlý obsah.")
    try:
        data = json.loads(result.stdout)
    except ValueError as error:
        raise ValueError("Kontrola obsahu selhala.") from error
    if not data.get("ok"):
        raise ValueError(data.get("error", "Neplatný obsah."))
    return data["result"]
