# Constra

Construction drawing annotation tool. See `CLAUDE.md` for the project brief,
data model, and team charter.

Two services: `backend/` (Django + DRF + Neon Postgres) and `frontend/`
(Next.js). Run both.

## Getting started — backend

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate   # Windows; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env   # then fill in your real Neon DATABASE_URL and a generated SECRET_KEY
python manage.py migrate
python manage.py import_pdf   # download + convert the sample PDF, seed the DB
python manage.py runserver    # http://localhost:8000
```

## Getting started — frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL, defaults to http://localhost:8000
npm run dev                  # http://localhost:3000
```

Or from the repo root, `npm run dev` proxies to the frontend (backend still
needs to be started separately, as above).
