# Constra

A small web app for viewing and marking up multipage construction
drawings — built as a take-home-style project for a Full Stack Software
Engineer role.

## What is this? (in plain terms)

Construction drawing sets are long, multipage PDFs full of dense detail.
Constra lets you:

1. **Open a drawing and flip through its pages**, like a document viewer.
2. **Draw a red box** around anything you want to mark as "ignore."
3. **Draw a green box** around any text you want to "capture."
4. **Everything you draw is saved automatically** — close the app, come
   back later, and your boxes are exactly where you left them.
5. *(Optional bonus)* **Automatically read the text inside each green
   box** and save it, using software that runs entirely on your own
   computer — nothing is sent to an outside AI service to do this.

That's the whole product. It's intentionally small and focused: it does
one job (view + mark up + save) rather than trying to be a full CAD or
document-management tool.

## Features

| Feature | Status |
|---|---|
| Import and view a multipage construction drawing | ✅ Done |
| Page navigation (next/prev, jump to page) | ✅ Done |
| Draw red ("ignore") and green ("capture") rectangles | ✅ Done |
| Select, resize, and delete existing rectangles | ✅ Done |
| Annotations persist after the app restarts | ✅ Done |
| Local OCR on green rectangles (bonus) | ⏳ Not yet started |
| Demo video (bonus) | ⏳ Not yet started |

See [GitHub issue #1](https://github.com/Lam-Thai/Constra/issues/1) for
the original scoped brief this was built against.

## How it's built (technical)

Two independent services, talking over a plain REST API:

```
frontend/   Next.js (App Router) + React + TypeScript
            — the drawing viewer, page navigation, and the
              draw/select/resize/delete rectangle overlay

backend/    Django + Django REST Framework (Python)
            — owns the database schema, the API, and the
              PDF-to-image import pipeline

Neon        Serverless Postgres — where every drawing, page,
Postgres    and annotation is durably stored
```

The frontend never talks to the database directly — it only calls the
Django API. Annotation coordinates are stored **normalized (0–1)** rather
than in pixels, so a rectangle stays correctly positioned no matter what
size the drawing is rendered at.

**Why this stack**: the frontend/backend split (Next.js + Django + DRF) was
chosen to mirror the actual production stack used by the company this
project was built for, rather than the simplest possible single-service
setup.

### Running it locally

```bash
# backend (Django + Neon Postgres)
cd backend
python -m venv .venv && .venv\Scripts\activate   # Windows; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env   # then fill in your real Neon DATABASE_URL and a generated SECRET_KEY
python manage.py migrate
python manage.py import_pdf   # downloads + converts the sample PDF, seeds the DB
python manage.py runserver    # http://localhost:8000
```

```bash
# frontend (Next.js), in a second terminal
cd frontend
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL, defaults to http://localhost:8000
npm run dev                  # http://localhost:3000
```

Both services need to be running for the app to work. From the repo root,
`npm run dev` is a shortcut that proxies to the frontend only — the backend
still needs to be started separately, as above.

## How this was built: an AI team, not a single assistant

Instead of one AI assistant doing everything, this project was built by a
small set of specialists — each with a narrow job, a fixed way of working,
and (for the two research-heavy roles) permission to look things up on the
current internet rather than guess. This section explains that setup for
both audiences.

### In plain terms

Think of it like a small engineering team with defined roles, where you
(the project owner) hand over a task or a written brief, and the team
figures out who does what:

- **The planner** turns a rough idea into a clear, written plan — what's
  being built, how you'll know it's done, and what's deliberately left
  out — the way a project manager writes a one-page brief before work
  starts.
- **The researcher** looks up current, real information (which software
  tool to use, how similar products solve a problem) before a technical
  decision gets locked in, instead of guessing from memory.
- **The backend developer** builds the parts you don't see: the database,
  the server, and the rules for saving and loading your data safely.
- **The frontend developer** builds the parts you click: the drawing
  viewer, the page controls, and the boxes you draw.
- **The OCR specialist** builds the feature that automatically reads text
  out of the green boxes.
- **The reviewer** checks everyone else's work for bugs and security
  issues before it's considered finished — a second pair of eyes, the way
  one engineer reviews a colleague's work before it ships.

Each role also follows its own **playbook** — a written, step-by-step
guide for how to do its specific job well (e.g. exactly how to safely
connect to the database, or exactly how to keep a drawn rectangle aligned
with the image underneath it) — so the same careful approach is used every
time, rather than being reinvented (or forgotten) from scratch.

### Technical detail

Implemented as [Claude Code](https://claude.com/claude-code) **subagents**
(`.claude/agents/`) and **skills** (`.claude/skills/`). Coding agents run
on Claude Sonnet 5; the two planning/research agents run on Claude Opus 5
and are granted `WebSearch`/`WebFetch` so they can ground decisions in
current package versions, licenses, and industry practice rather than
stale training data.

#### Agents (`.claude/agents/`)

| Agent | Model | Responsible for | Playbook it follows |
|---|---|---|---|
| [`product-planner`](.claude/agents/product-planner.md) | Opus 5, web-enabled | Turning ambiguous requests into a Goal / Scope / Acceptance Criteria / Out of Scope writeup; filing/updating GitHub issues | [`scope-writeup`](.claude/skills/scope-writeup/SKILL.md) |
| [`tech-researcher`](.claude/agents/tech-researcher.md) | Opus 5, web-enabled | Evaluating libraries, frameworks, and technical approaches against current (not assumed) information | [`tech-evaluation`](.claude/skills/tech-evaluation/SKILL.md) |
| [`backend-developer`](.claude/agents/backend-developer.md) | Sonnet 5 | Django models, migrations, REST API, and Neon Postgres persistence (`backend/`) — builds **first**, since the other coding agents depend on its API contract | [`neon-postgres-setup`](.claude/skills/neon-postgres-setup/SKILL.md) |
| [`frontend-developer`](.claude/agents/frontend-developer.md) | Sonnet 5 | The Next.js viewer, page navigation, and the draw/select/resize/delete rectangle overlay (`frontend/`) | [`canvas-annotation-overlay`](.claude/skills/canvas-annotation-overlay/SKILL.md) |
| [`ocr-integration-engineer`](.claude/agents/ocr-integration-engineer.md) | Sonnet 5 | The bonus local-OCR feature on green "capture" rectangles | [`local-ocr-pipeline`](.claude/skills/local-ocr-pipeline/SKILL.md) |
| [`code-reviewer`](.claude/agents/code-reviewer.md) | Sonnet 5 | Reviewing every other agent's diff for correctness bugs and security issues before it's called done — runs **last** | [`annotation-review-checklist`](.claude/skills/annotation-review-checklist/SKILL.md) |

**Dependency order**: `product-planner` scopes the work (only if it isn't
already scoped) → `backend-developer` builds the API contract →
`frontend-developer` and `ocr-integration-engineer` build against that
contract in parallel (they don't depend on each other) →
`code-reviewer` checks the result → a summary goes back to the project
owner. Any role a given task doesn't touch is skipped.

#### Skills (`.claude/skills/`)

A skill is a written playbook an agent loads before starting its part of
the work — the concrete "how," not just the "who." One skill drives the
overall workflow; the rest are per-domain playbooks tied to a specific
agent above.

| Skill | Used by | What it covers |
|---|---|---|
| [`assign-task`](.claude/skills/assign-task/SKILL.md) | The project owner's entry point | Given a task or GitHub issue number, runs the whole pipeline above automatically — nobody has to manually pick which agent to call |
| [`scope-writeup`](.claude/skills/scope-writeup/SKILL.md) | `product-planner` | The Goal/Scope/Acceptance Criteria/Out of Scope template, and the confirm-before-posting rule for GitHub issues |
| [`tech-evaluation`](.claude/skills/tech-evaluation/SKILL.md) | `tech-researcher` | A decision framework: hard constraints first, then currency/license/integration cost, then a direct recommendation |
| [`neon-postgres-setup`](.claude/skills/neon-postgres-setup/SKILL.md) | `backend-developer` | Django ↔ Neon connection pattern, schema, DRF validation, CORS/CSRF configuration for a no-auth API |
| [`canvas-annotation-overlay`](.claude/skills/canvas-annotation-overlay/SKILL.md) | `frontend-developer` | The SVG overlay architecture, the normalized 0–1 coordinate contract, and the draw/select/resize/delete interaction states |
| [`local-ocr-pipeline`](.claude/skills/local-ocr-pipeline/SKILL.md) | `ocr-integration-engineer` | Cropping a capture rectangle and running local OCR on it without ever blocking the annotation save on OCR completing |
| [`annotation-review-checklist`](.claude/skills/annotation-review-checklist/SKILL.md) | `code-reviewer` | This project's specific failure modes: coordinate-math bugs, persistence gaps, SQL/CORS/CSRF safety, race conditions |

See [`CLAUDE.md`](CLAUDE.md) for the full data model, the team charter
these agents operate under, and the working agreements (e.g. GitHub is
only ever updated after explicit confirmation, never silently).
