#!/usr/bin/env bash
# Render start command (invoked via render.yaml's `startCommand: bash start.sh`).
#
# Runs migrations before starting the app server, then execs gunicorn.
#
# Belt-and-suspenders rationale: render.yaml also declares a
# `preDeployCommand: python manage.py migrate --noinput`, which is Render's
# documented pre-deploy/release-phase hook — but preDeployCommand is only
# honored on paid instance types, not the free tier (see Render's docs,
# checked at the time this was written). Rather than make "migrations
# actually run" depend on which plan the PM picks, this script re-runs the
# same idempotent `migrate --noinput` here too, so schema changes are
# guaranteed to apply before gunicorn binds and starts serving traffic on
# *every* deploy/restart, on every plan — free tier included, first deploy
# included, no manual "run it once by hand" step required. Running migrate
# twice back-to-back (once via preDeployCommand where supported, once here)
# is a harmless no-op the second time.
set -euo pipefail

echo "==> Running database migrations..."
python manage.py migrate --noinput

echo "==> Starting gunicorn..."
exec gunicorn config.wsgi:application --bind "0.0.0.0:${PORT:-8000}"
