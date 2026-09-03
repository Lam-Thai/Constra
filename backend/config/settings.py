"""
Django settings for config project.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/6.0/ref/settings/
"""

import os
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Load backend/.env
load_dotenv(BASE_DIR / ".env")


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/6.0/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ["SECRET_KEY"]

# SECURITY WARNING: don't run with debug turned on in production!
# Defaults to False (safe) when unset — DEBUG=True is only ever set in a
# local backend/.env, never in a deployed environment's env vars.
DEBUG = os.environ.get("DEBUG", "False") == "True"

# Comma-separated list of extra hosts (e.g. Render's "<app>.onrender.com"
# and/or a custom domain), additive on top of localhost/127.0.0.1 so local
# dev (`manage.py runserver`) always keeps working.
# Example: ALLOWED_HOSTS="constra-backend.onrender.com,api.example.com"
_extra_hosts = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip()]
# Render auto-injects RENDER_EXTERNAL_HOSTNAME (the service's own
# "<app>.onrender.com" hostname) into every web service's environment —
# pick it up automatically so the PM doesn't have to duplicate it into
# ALLOWED_HOSTS by hand. A no-op (empty string, filtered out) anywhere but
# Render.
_render_hostname = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip()
if _render_hostname:
    _extra_hosts.append(_render_hostname)
ALLOWED_HOSTS = ["localhost", "127.0.0.1"] + _extra_hosts


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'drawings',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # Serves STATIC_ROOT directly from the app process — Render's web
    # service has no separate static-file host/CDN in front of it, so
    # admin's CSS/JS need to come from somewhere. Must sit right after
    # SecurityMiddleware, per whitenoise's own install docs.
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# Database
# https://docs.djangoproject.com/en/6.0/ref/settings/#databases

DATABASES = {
    "default": dj_database_url.config(
        env="DATABASE_URL",
        conn_max_age=120,        # stay under Neon's ~300s autosuspend
        conn_health_checks=True, # revive a dead connection instead of 500ing
        ssl_require=True,
    )
}

# Neon's pooled (pgbouncer) connections don't support server-side cursors.
if "-pooler" in DATABASES["default"].get("HOST", ""):
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True


# Password validation
# https://docs.djangoproject.com/en/6.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.0/howto/static-files/

STATIC_URL = 'static/'
# Populated by `manage.py collectstatic` (run as part of render.yaml's
# buildCommand on every deploy) so whitenoise has something to serve; only
# used to make django.contrib.admin's own assets work in production.
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Media files (imported drawing page PNGs)
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Base URL this server is reachable at, used to build absolute image_url
# values when importing pages (dev default matches `manage.py runserver`).
BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://localhost:8000")

# --- Media storage backend (page PNGs) ---
#
# Render's web service disk is ephemeral across deploys/restarts (a
# persistent disk is a paid add-on we're deliberately not relying on), so
# local disk (FileSystemStorage under MEDIA_ROOT) can't be the durable
# store there — only local dev gets to rely on it. When S3-compatible
# bucket credentials are present in the environment, media switches to
# `django-storages`'
# generic S3 backend (works unmodified against AWS S3, Cloudflare R2, or
# any other S3-compatible endpoint via AWS_S3_ENDPOINT_URL — deliberately
# not a provider-specific SDK). When they're absent (default local dev),
# media falls back to plain FileSystemStorage exactly as before — reading
# these env vars must never crash Django startup either way.
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
AWS_STORAGE_BUCKET_NAME = os.environ.get("AWS_STORAGE_BUCKET_NAME")
# Optional — only set for a non-AWS S3-compatible endpoint (e.g. Cloudflare
# R2's "https://<account_id>.r2.cloudflarestorage.com"). Leave unset for
# real AWS S3.
AWS_S3_ENDPOINT_URL = os.environ.get("AWS_S3_ENDPOINT_URL") or None
AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "auto")

# All three credentials/bucket vars are required together to switch on S3;
# any subset present without the rest just silently stays on local disk
# rather than half-configuring a broken backend.
USE_S3_MEDIA = bool(AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY and AWS_STORAGE_BUCKET_NAME)

if USE_S3_MEDIA:
    # These three are only set inside STORAGES["default"]["OPTIONS"] below —
    # that's the only place django-storages' dict-based STORAGES config
    # (Django 4.2+) actually reads them from; the legacy top-level
    # AWS_S3_FILE_OVERWRITE / AWS_DEFAULT_ACL / AWS_QUERYSTRING_AUTH
    # settings would be dead weight here, not a second source of truth.
    _default_storage_backend = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": AWS_STORAGE_BUCKET_NAME,
            "region_name": AWS_S3_REGION_NAME,
            "access_key": AWS_ACCESS_KEY_ID,
            "secret_key": AWS_SECRET_ACCESS_KEY,
            "file_overwrite": True,
            "default_acl": None,
            "querystring_auth": False,
            **({"endpoint_url": AWS_S3_ENDPOINT_URL} if AWS_S3_ENDPOINT_URL else {}),
        },
    }
else:
    _default_storage_backend = {"BACKEND": "django.core.files.storage.FileSystemStorage"}

STORAGES = {
    "default": _default_storage_backend,
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Upload size limits — construction drawings (multi-page PDFs, scanned
# images) commonly exceed Django's 2.5MB defaults; bump both so a
# legitimate upload via POST /api/drawings/ isn't rejected before it
# reaches DrawingUploadSerializer's own validation. Local dev only — no
# reverse proxy in front of runserver to also configure.
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024  # 25MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024  # 25MB

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# Django REST Framework — no authentication, this project has none by design.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
}

# CORS — the Next.js dev server runs on a different origin, and so does the
# Vercel deployment in production. Comma-separated env var, additive on top
# of the local dev origins so `npm run dev` keeps working unmodified.
# Explicit allow-list only — this project deliberately never wildcards CORS.
# Example: CORS_ALLOWED_ORIGINS="https://constra.vercel.app,https://constra-git-main-yourteam.vercel.app"
_extra_cors_origins = [o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
] + _extra_cors_origins
CORS_ALLOW_CREDENTIALS = False
