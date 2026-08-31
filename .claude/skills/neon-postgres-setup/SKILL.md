---
name: neon-postgres-setup
description: How to connect Django to Neon Postgres, define/migrate the annotation schema, and write safe queries for this project. Use whenever implementing or changing models, migrations, or API views for Constra's backend (backend-developer's core skill).
---

# Neon Postgres setup for Constra (Django)

## Connection

Use `psycopg[binary]` (psycopg 3, not psycopg2 — Neon's own guidance
prefers it, and psycopg2 is feature-frozen) plus `dj-database-url` to parse
Neon's single `DATABASE_URL` connection string into Django's `DATABASES`
setting.

```python
# settings.py
import dj_database_url

DATABASES = {
    "default": dj_database_url.config(
        env="DATABASE_URL",
        conn_max_age=120,        # stay under Neon's ~300s autosuspend
        conn_health_checks=True, # revive a dead connection instead of 500ing
        ssl_require=True,
    )
}
```

- Use Neon's **direct** (non `-pooler`) connection host for Django — Django
  keeps its own persistent connections via `conn_max_age`, so you don't need
  PgBouncer in front of it. If you ever switch to the `-pooler` host, also
  set `DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True`.
- `DATABASE_URL` goes in `backend/.env` (or `backend/.env.local`), **never
  committed**. Confirm `.env*` (except `.env.example`) is in `.gitignore`
  before writing any code that touches it. Provide a `backend/.env.example`
  with a placeholder value. `SECRET_KEY` follows the same rule — generate a
  real one for local dev, never commit it, never reuse Django's insecure
  scaffold default outside local dev.
- Get the connection string from the Neon project dashboard. Never print or
  log the real value.

## Schema — Django models + migrations

Django's migration system is the source of truth here — no hand-written SQL
files. Keep it to one small app (e.g. `drawings`).

```python
# drawings/models.py
import uuid
from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator

class Drawing(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    page_count = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

class Page(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    drawing = models.ForeignKey(Drawing, on_delete=models.CASCADE, related_name="pages")
    page_number = models.PositiveIntegerField()
    image_url = models.CharField(max_length=500)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()

    class Meta:
        unique_together = ("drawing", "page_number")
        ordering = ["page_number"]

class Annotation(models.Model):
    IGNORE, CAPTURE = "ignore", "capture"
    TYPE_CHOICES = [(IGNORE, "Ignore"), (CAPTURE, "Capture")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    drawing = models.ForeignKey(Drawing, on_delete=models.CASCADE, related_name="annotations")
    page_number = models.PositiveIntegerField()
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    # normalized 0..1 relative to page width/height — resolution independent,
    # see canvas-annotation-overlay skill for why this matters on the frontend
    x = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    y = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    width = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    height = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    ocr_text = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["drawing", "page_number"])]
```

Model-level validators are a helpful guardrail but **do not** rely on them
alone for API input validation — `full_clean()` isn't called automatically
on `.save()`. Real validation belongs in the DRF serializer (next section).

Run `python manage.py makemigrations drawings && python manage.py migrate`
to apply. Migrations are committed to the repo like any other code.

## Serializer validation — the real system boundary

```python
# drawings/serializers.py
from rest_framework import serializers
from .models import Annotation

class AnnotationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Annotation
        fields = ["id", "drawing", "page_number", "type", "x", "y", "width", "height", "ocr_text", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, data):
        x = data.get("x", getattr(self.instance, "x", None))
        y = data.get("y", getattr(self.instance, "y", None))
        w = data.get("width", getattr(self.instance, "width", None))
        h = data.get("height", getattr(self.instance, "height", None))
        if x + w > 1:
            raise serializers.ValidationError("x + width must be <= 1")
        if y + h > 1:
            raise serializers.ValidationError("y + height must be <= 1")
        return data
```

This is what turns a bad request into a clean `400` instead of a raw `500`
from a DB constraint or an `IntegrityError`.

## Queries — the ORM parameterizes automatically

Use the ORM (`Model.objects.filter(...)`, etc.) for everything — it
parameterizes automatically. Never build raw SQL from user input:

```python
# Safe — standard ORM usage
Annotation.objects.filter(drawing_id=drawing_id, page_number=page_number)

# NEVER do this:
# Annotation.objects.raw(f"select * from annotations where drawing_id = '{drawing_id}'")
```

If a `.raw()` or `.extra()` call is ever genuinely necessary, parameters
must go through the driver's placeholder mechanism (`%s`), never Python
string interpolation.

## API shape (DRF)

One resource per concern; DRF's default trailing-slash convention:

```
GET    /api/drawings/                              list drawings
GET    /api/drawings/<uuid:id>/                     drawing + page list
GET    /api/drawings/<uuid:id>/pages/<int:page>/annotations/   list annotations for a page
POST   /api/drawings/<uuid:id>/pages/<int:page>/annotations/   create one
PATCH  /api/annotations/<uuid:id>/                  update (resize/move/OCR text)
DELETE /api/annotations/<uuid:id>/                  delete
```

Validate path params look like UUIDs/positive integers before querying —
DRF's `UUIDField`/`IntField` URL converters (`<uuid:id>`, `<int:page>`) do
this automatically at the routing layer and 404 cleanly on a malformed
value, so prefer typed URL converters over plain `<str:id>` + manual
parsing.

Return the full annotation row (including generated `id`) from POST so the
frontend can reconcile its optimistic local state with the real record.

## CORS

The frontend runs on a different origin (`localhost:3000` vs Django's
`localhost:8000`). Use `django-cors-headers`, restrict explicitly, no
authentication means no credentialed requests:

```python
INSTALLED_APPS += ["corsheaders"]
MIDDLEWARE = ["corsheaders.middleware.CorsMiddleware",  # before CommonMiddleware
              "django.middleware.common.CommonMiddleware", ...]
CORS_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
CORS_ALLOW_CREDENTIALS = False
```
List both `localhost` and `127.0.0.1` — browsers treat them as distinct
origins. Never combine `CORS_ALLOW_ALL_ORIGINS=True` with credentials.

## CSRF — leave it alone, don't disable it

This project has no authentication (see CLAUDE.md's Out of Scope). DRF's
`APIView` is CSRF-exempt by default; Django's CSRF middleware only blocks a
request once `SessionAuthentication` has authenticated a session cookie. So:

```python
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],  # not SessionAuthentication
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
}
```
Keep `CsrfViewMiddleware` in `MIDDLEWARE` — it still protects `/admin/`.
Do **not** add `@csrf_exempt` or disable CSRF globally; that's the unsafe
pattern this setup is specifically avoiding. If auth is ever added later,
CSRF handling becomes relevant again by design, not by accident.

## Verifying persistence survives a restart

This is the project's hard requirement — verify it directly, don't infer it
from the schema existing:
1. Create an annotation through the API.
2. Stop and restart `manage.py runserver`.
3. `GET` the same page's annotations and confirm the row comes back with
   the same coordinates and type.

Since Neon is an external managed database, "restart" naturally persists
data — the actual risk is a misconfigured/missing `DATABASE_URL` on
restart, or the frontend never having called the load endpoint on mount.
Check both.
