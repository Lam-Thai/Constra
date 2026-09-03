"""Deploy-time Django system checks.

Registered from `DrawingsConfig.ready()` so they run automatically as part
of `manage.py check`, `manage.py migrate`, and `manage.py runserver` — in
particular, `start.sh` runs `migrate --noinput` before `exec gunicorn`, so
a check here prints loudly in Render's deploy logs instead of letting a
misconfigured service silently start serving 404'd images.

Deliberately `Warning`, not `Error`: Django's own `test` command forces
`settings.DEBUG = False` regardless of the local `.env` (see
`django.test.utils.setup_test_environment`), and the test environment has
no `AWS_*` vars set — an `Error`-level check here would fail
`manage.py test` outright on every run, everywhere, which is worse than the
problem it's solving. `Warning` still surfaces in `migrate`/`check` output
(non-interactive included) without blocking the test suite or a
runserver/migrate that's merely misconfigured rather than broken.
"""

from django.conf import settings
from django.core.checks import Warning, register


@register()
def media_storage_configured(app_configs, **kwargs):
    """Catch "DEBUG=False with no durable media storage" before it ships.

    `config/urls.py` only serves `/media/...` locally, when `DEBUG=True`.
    In production (`DEBUG=False`, e.g. Render), nothing serves that path at
    all. If `USE_S3_MEDIA` is also False there — because one or more of the
    required `AWS_*` env vars was missed — `_build_image_url()` in
    `drawings/services.py` still happily builds `Page.image_url` values
    like `https://<host>.onrender.com/media/pages/...`, which 404 on the
    very first request. That's worse than "doesn't survive a restart": it's
    broken from the moment it's deployed, and nothing short of opening the
    app surfaces it. Warn loudly at deploy time instead.
    """
    if settings.DEBUG or settings.USE_S3_MEDIA:
        return []

    return [
        Warning(
            "DEBUG=False but no S3-compatible media storage is configured "
            "(USE_S3_MEDIA is False) — page images will 404 in production.",
            hint=(
                "Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and "
                "AWS_STORAGE_BUCKET_NAME together (all three, or none) in "
                "the deploy environment so Page.image_url points at "
                "durable, publicly-reachable bucket storage instead of the "
                "ephemeral local filesystem. See README.md's Deployment "
                "section, 'Setting up S3-compatible media storage', for "
                "bucket creation + public-read policy steps for both "
                "Cloudflare R2 and AWS S3."
            ),
            id="drawings.W001",
        )
    ]
