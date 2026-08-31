---
name: neon-postgres-setup
description: How to connect to Neon Postgres from Next.js, define/migrate the annotation schema, and write safe queries for this project. Use whenever implementing or changing schema, API routes, or persistence for Constra (backend-developer's core skill).
---

# Neon Postgres setup for Constra

## Connection

Use `@neondatabase/serverless` — it talks to Neon over HTTP/WebSocket, so it
works from both Node and Edge runtimes in Next.js without connection-pool
management. Don't reach for a plain `pg.Pool` unless there's a concrete
reason (e.g. long-lived transactions); it needs Neon's `-pooler` connection
string and more careful lifecycle handling than this project needs.

```ts
// db.ts
import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL!);
```

- `DATABASE_URL` goes in `.env.local`, **never committed**. Confirm
  `.env*` (except `.env.example`) is in `.gitignore` before writing any code
  that touches it. Provide a `.env.example` with a placeholder value.
- Get the connection string from the Neon project dashboard — it looks like
  `postgresql://user:pass@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require`.
  Never print or log the real value.

## Schema

Keep migrations as plain, numbered SQL files under `db/migrations/` — no
ORM needed at this scale (Drizzle is a reasonable upgrade if the schema
grows, but don't add the dependency for a two-table project). Apply them
with a tiny script or directly via `sql` in a one-off setup route/CLI
command; there's no need for a migration framework here.

```sql
-- db/migrations/001_init.sql
create extension if not exists pgcrypto;

create table if not exists drawings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  page_count integer not null,
  created_at timestamptz not null default now()
);

create table if not exists annotations (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  type text not null check (type in ('ignore', 'capture')),
  -- normalized 0..1 relative to page width/height — resolution independent,
  -- see canvas-annotation-overlay skill for why this matters on the frontend
  x real not null check (x >= 0 and x <= 1),
  y real not null check (y >= 0 and y <= 1),
  width real not null check (width > 0 and width <= 1),
  height real not null check (height > 0 and height <= 1),
  ocr_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists annotations_drawing_page_idx
  on annotations (drawing_id, page_number);
```

Coordinates are **normalized (0–1)**, not pixels — this is the contract the
frontend and OCR agents build against. Storing pixels would break as soon
as the drawing renders at a different size (window resize, zoom, different
screen).

## Queries — always parameterized

`@neondatabase/serverless`'s `sql` tagged template auto-parameterizes.
Never string-concatenate or template-literal user input directly into SQL.

```ts
// Safe — driver parameterizes automatically
const rows = await sql`
  select * from annotations
  where drawing_id = ${drawingId} and page_number = ${pageNumber}
`;

// NEVER do this:
// const rows = await sql.query(`select * from annotations where drawing_id = '${drawingId}'`);
```

Validate at the API boundary even though the DB has check constraints —
constraints give you data integrity, not a clean 400 response:
- `type` must be exactly `"ignore"` or `"capture"`.
- `x`, `y`, `width`, `height` are finite numbers in `[0, 1]`, and
  `x + width <= 1`, `y + height <= 1` (reject out-of-bounds rectangles).
- `page_number` is a positive integer within the drawing's known page count.

## API route pattern (Next.js App Router)

One resource per concern, standard REST-ish shape:

```
GET    /api/drawings/[id]/pages/[page]/annotations   list annotations for a page
POST   /api/drawings/[id]/pages/[page]/annotations   create one
PATCH  /api/annotations/[id]                          update (resize/move/OCR text)
DELETE /api/annotations/[id]                          delete
```

Return the full annotation row (including generated `id`) from POST so the
frontend can reconcile its optimistic local state with the real record.

## Verifying persistence survives a restart

This is the project's hard requirement — verify it directly, don't infer it
from the schema existing:
1. Create an annotation through the API (or `sql` directly).
2. Stop and restart the dev server.
3. `GET` the same page's annotations and confirm the row comes back with
   the same coordinates and type.

Since Neon is an external managed database, "restart" naturally persists
data — the actual risk is a misconfigured/missing `DATABASE_URL` on
restart, or the frontend never having called the load endpoint on mount.
Check both.
