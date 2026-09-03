# Constra

Construction drawing annotation tool — take-home style project for a Full Stack
Software Engineer application (Provision, Toronto — construction automation / AI).

## What this app does

- Imports and renders a multipage construction drawing (source sample:
  https://github.com/wkoszek/takehome).
- Lets the user page through the drawing.
- Lets the user draw **red** rectangles around content to ignore and **green**
  rectangles around text to capture.
- Persists annotations so they survive an app restart.
- Bonus: runs local OCR on the contents of green rectangles and saves the
  extracted text.

## Repo layout

Decoupled two-service monorepo:

- **`frontend/`** — Next.js (App Router) + React + TypeScript. Talks to the
  backend as a REST API over HTTP, not via Next.js API routes.
- **`backend/`** — Django + Django REST Framework (Python). Owns the schema,
  migrations, and all persistence/business logic.

Run both concurrently in development: backend on `http://localhost:8000`,
frontend on `http://localhost:3000` (`NEXT_PUBLIC_API_BASE_URL` points the
frontend at the backend).

## Tech stack

- **Frontend**: Next.js (App Router), React, TypeScript. Canvas/SVG overlay
  for drawing and editing rectangles on top of rendered drawing pages. Calls
  the Django API via `fetch`, no server-side data layer of its own.
- **Backend**: Django + Django REST Framework, in `backend/`. Django's ORM
  and migration system are the source of truth for schema — no hand-written
  SQL files.
- **Database**: Neon Postgres (serverless Postgres), accessed from Django via
  `psycopg[binary]` (psycopg 3) + `dj-database-url` parsing Neon's
  `DATABASE_URL`. Use Neon's direct (non `-pooler`) host — see
  `neon-postgres-setup` skill for the exact settings (`conn_max_age`,
  `conn_health_checks`, `ssl_require`).
- **PDF → image**: `pypdfium2` (BSD/Apache license, bundles PDFium, no
  external Poppler/Ghostscript binary, prebuilt Windows wheels) converts the
  source PDF to per-page PNGs at import time, via a Django management
  command. Deliberately not PyMuPDF (AGPL license).
- **CORS**: `django-cors-headers`, explicit allowed origins for the frontend
  dev server — never wildcarded.
- **OCR (bonus)**: local OCR via `rapidocr` (ONNX-based, Apache-2.0) run only
  on green-rectangle crops, never the whole page. Any `ignore` rectangle
  overlapping a crop is masked to white *before* OCR — that is what makes the
  red boxes load-bearing rather than decorative. Deliberately **not**
  `pytesseract`: that needs the Tesseract binary installed separately from the
  pip package (it is not on this machine), and it is weaker on dense CAD text.
  `rapidocr` is pip-only with models in the wheel, so `pip install -r
  requirements.txt` stays the one setup step. Note `rapidocr-onnxruntime` is
  the abandoned 1.x line — the current package is `rapidocr` (3.x), whose API
  returns a `RapidOCROutput` object, not a list of tuples. Its orientation
  classifier only corrects 180° flips, so crops are OCR'd at 0° and 90° and
  the higher-scoring result wins — construction sheets are full of rotated
  dimension strings and vertical title-block text.
- **LLM (AI estimate)**: Google Gemini via `google-genai` (2.x) with structured
  JSON output, model `gemini-3.5-flash-lite`. It receives **OCR text only —
  never image bytes**, so no drawing imagery leaves the machine. `GEMINI_API_KEY`
  lives in `backend/.env` (gitignored); when it is absent the estimate endpoint
  returns 503 rather than failing hard, and every other feature still works.
  Deliberately not `google-generativeai` — that package hit permanent EOL on
  2025-11-30. Do not reach for `gemini-2.0-*` model ids; they are shut down.

## Data model (starting point — refine during planning)

Three Django models in `backend/drawings/models.py`: `Drawing` (name,
page_count), `Page` (drawing FK, page_number, image_url, width, height),
`Annotation` (drawing FK, page_number, type: `ignore`|`capture`, normalized
0–1 `x`/`y`/`width`/`height`, optional `ocr_text`, timestamps). Coordinates
are normalized so rectangles stay correctly positioned regardless of the
rendered image's pixel size — see `canvas-annotation-overlay` skill for why
this matters on the frontend, `neon-postgres-setup` for the exact schema.

## Team charter

The user is the **PM/owner**: they assign a task or GitHub issue and expect
a result back, not to route work between agents themselves. Default entry
point for any assigned task is the **`assign-task`** skill — invoke it
whenever the PM hands off a task or issue number, rather than calling a
single agent ad hoc.

Roles (`.claude/agents/`), each backed by a playbook skill under
`.claude/skills/` with the concrete how-to for that domain:

| Agent | Model | Role | Skill it uses |
|---|---|---|---|
| `product-planner` | Opus 5, web | Scopes ambiguous tasks into Goal/Scope/Acceptance Criteria/Out of Scope | `scope-writeup` |
| `tech-researcher` | Opus 5, web | Pulled in ad hoc for library/industry decisions | `tech-evaluation` |
| `backend-developer` | Sonnet 5 | Django/DRF models, migrations, API, persistence (`backend/`) — goes **first**, defines the contract | `neon-postgres-setup` |
| `frontend-developer` | Sonnet 5 | Next.js UI, canvas drawing, page nav (`frontend/`) — builds against the backend contract | `canvas-annotation-overlay` |
| `ocr-integration-engineer` | Sonnet 5 | Local OCR on green rectangles, on the Django backend | `local-ocr-pipeline` |
| `code-reviewer` | Sonnet 5 | Reviews everyone's diff — runs **last** | `annotation-review-checklist` |

Dependency order: `product-planner` (if unscoped) → `backend-developer` →
`frontend-developer` + `ocr-integration-engineer` (parallel) →
`code-reviewer` → report to PM. Skip any role a given task doesn't touch.

- Coding agents run on `claude-sonnet-5`; planning/research agents run on
  `claude-opus-5` and are allowed to browse the web for industry context
  (construction-tech competitors, document annotation UX, OCR approaches,
  and current package/version state — verify rather than assume, the
  ecosystem moves fast), not just this repo.
- Prefer small, working increments over a big-bang implementation — this
  project's origin is a strict one-hour take-home, so scope discipline matters
  more than completeness. When in doubt, cut scope and say what was cut.
- No production-hardening (auth, multi-tenant, deployment) unless asked —
  see "Out of Scope" on the tracking issue. This is also why CORS has no
  credentials and DRF has no authentication classes configured: it's a
  deliberate match to current scope, not an oversight — see
  `neon-postgres-setup`'s CSRF/CORS section before "fixing" it.
- GitHub is updated (issue comments, closing, checking boxes) only after
  confirming with the PM — it's a visible, shared action, not something to
  automate silently even inside the `assign-task` pipeline.
- The `assign-task` skill is the PM-facing orchestration entry point; the
  six skills above are what each agent actually executes against once
  delegated to.
