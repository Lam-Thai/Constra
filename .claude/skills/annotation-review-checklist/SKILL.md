---
name: annotation-review-checklist
description: Project-specific failure modes to check for when reviewing Constra changes, on top of general code review — coordinate math, persistence, and SQL/XSS safety. Use when reviewing a diff from backend-developer, frontend-developer, or ocr-integration-engineer (code-reviewer's core skill).
---

# Annotation review checklist for Constra

Run this alongside general code review (the built-in `code-review` skill
covers correctness/simplification broadly) — this checklist targets the
specific ways this project breaks.

## Coordinate math

- Are coordinates normalized (0–1) everywhere they cross a
  frontend/backend/OCR boundary, never raw pixels? Check both the API
  payload shape and the DB schema.
- On draw/resize, is `x`/`y`/`width`/`height` normalized to positive values
  regardless of drag direction (`x = min(start, end)`, not just
  `end - start`)? A negative width silently breaks rendering and any
  bounds check.
- Are values clamped to `[0, 1]` (and `x + width <= 1`, `y + height <= 1`)
  before saving? An unclamped drag past the page edge produces
  out-of-bounds rectangles.

## Persistence (the project's hard requirement)

- Does the frontend actually re-fetch annotations on page load/mount, not
  just rely on in-memory state from the drawing session? Persisting
  correctly server-side is useless if the client never reloads it.
- Trace the save path for a rectangle end to end — draw → API call → DB
  write — don't accept "the schema supports it" as evidence it works.

## SQL and input safety

- All queries go through the Django ORM (`.filter()`, `.get()`, etc.) —
  flag any `.raw()` or `.extra()` call, and double-check it uses `%s`
  placeholders rather than Python string interpolation if one exists.
- DRF serializers validate `type` (enum) and coordinate bounds
  server-side — not just Django model `validators=[...]` (those aren't
  enforced on `.save()` without an explicit `full_clean()` call) and not
  just DB constraints (which give a 500, not a clean 400).
- URL routes use typed converters (`<uuid:id>`, `<int:page>`) so a
  malformed path param 404s at the routing layer instead of throwing an
  unhandled exception deeper in the view.

## Django-specific

- `CORS_ALLOWED_ORIGINS` is an explicit list (dev frontend origin(s)),
  never `CORS_ALLOW_ALL_ORIGINS=True`, and `CORS_ALLOW_CREDENTIALS` is
  only `True` if the project actually added authentication.
- No `@csrf_exempt` decorators or global CSRF disabling — DRF's `APIView`
  is already safely CSRF-exempt by default; see `neon-postgres-setup` for
  why disabling it further isn't needed and would be a red flag if found.
- `SECRET_KEY` and `DATABASE_URL` come from environment variables, never
  hardcoded in `settings.py` or committed in `backend/.env`.
- Migrations in the diff actually match the models — a model field change
  without a corresponding migration file is a bug that only surfaces at
  deploy/restart time, not in the running dev server that already has the
  column cached.

## OCR-specific

- Does an OCR failure ever propagate up and fail the annotation save
  itself? It shouldn't — the rectangle must save regardless of OCR outcome.
- Is OCR text rendered as plain text on the frontend, never injected as
  HTML?

## Race conditions

- Rapid draw-then-immediately-drag-another-rectangle: does each save
  request carry enough identity (temp client-side id → real server id
  reconciliation) that a slow response can't overwrite a different,
  newer rectangle's state?

## Secrets

- No `DATABASE_URL` or other credential committed, logged, or hardcoded —
  check diffs touching `.env*`, config files, and anything that prints
  connection details.
