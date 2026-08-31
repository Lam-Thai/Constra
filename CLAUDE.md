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

## Tech stack

- **Frontend**: Next.js (App Router), React, TypeScript. Canvas/SVG overlay for
  drawing and editing rectangles on top of rendered drawing pages.
- **Database**: Neon Postgres (serverless Postgres). Access via a lightweight
  client (`@neondatabase/serverless` or `pg` + a thin query layer / Prisma —
  decide in the implementation plan, don't assume an ORM up front).
- **OCR (bonus)**: local OCR (e.g. Tesseract via `tesseract.js` or a Python
  sidecar) run only on green-rectangle crops, never the whole page.

## Data model (starting point — refine during planning)

An annotation belongs to a drawing page and has: type (`ignore` | `capture`),
pixel/normalized rectangle coordinates, page number, optional OCR text (capture
only), timestamps. Store enough to re-render every rectangle exactly where the
user drew it after a reload.

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
| `backend-developer` | Sonnet 5 | Schema, API routes, persistence — goes **first**, defines the contract | `neon-postgres-setup` |
| `frontend-developer` | Sonnet 5 | UI, canvas drawing, page nav — builds against the backend contract | `canvas-annotation-overlay` |
| `ocr-integration-engineer` | Sonnet 5 | Local OCR on green rectangles — builds against the backend contract | `local-ocr-pipeline` |
| `code-reviewer` | Sonnet 5 | Reviews everyone's diff — runs **last** | `annotation-review-checklist` |

The `assign-task` skill is the PM-facing orchestration entry point; the
six skills above are what each agent actually executes against once
delegated to.

Dependency order: `product-planner` (if unscoped) → `backend-developer` →
`frontend-developer` + `ocr-integration-engineer` (parallel) →
`code-reviewer` → report to PM. Skip any role a given task doesn't touch.

- Coding agents run on `claude-sonnet-5`; planning/research agents run on
  `claude-opus-5` and are allowed to browse the web for industry context
  (construction-tech competitors, document annotation UX, OCR approaches),
  not just this repo.
- Prefer small, working increments over a big-bang implementation — this
  project's origin is a strict one-hour take-home, so scope discipline matters
  more than completeness. When in doubt, cut scope and say what was cut.
- No production-hardening (auth, multi-tenant, deployment) unless asked —
  see "Out of Scope" on the tracking issue.
- GitHub is updated (issue comments, closing, checking boxes) only after
  confirming with the PM — it's a visible, shared action, not something to
  automate silently even inside the `assign-task` pipeline.
