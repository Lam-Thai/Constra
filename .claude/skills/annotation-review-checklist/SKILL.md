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

- Every query touching user input uses the `sql` tagged template's
  parameterization — no string-concatenated or manually interpolated SQL.
- API routes validate `type` (enum), numeric bounds, and `page_number`
  server-side, not just via DB constraints (which give a 500, not a clean
  400).

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
