from django.apps import AppConfig


class DrawingsConfig(AppConfig):
    name = 'drawings'

    def ready(self):
        # Import registers the module's @register()'d system checks (a
        # Warning-level "DEBUG=False with no S3 media storage configured"
        # check — see drawings/checks.py) — the import itself is the side
        # effect.
        from . import checks  # noqa: F401
