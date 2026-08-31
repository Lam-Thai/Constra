-- 001_init.sql
-- Core schema for Constra: drawings (uploaded multipage PDFs), pages (one
-- row per rendered page image, with pixel dimensions), and annotations
-- (ignore/capture rectangles drawn on a page, in normalized 0..1 coords).

create extension if not exists pgcrypto;

create table if not exists drawings (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  page_count integer not null,
  created_at timestamptz not null default now()
);

-- One row per rendered page image. width/height are the PNG's pixel
-- dimensions at import time — the frontend needs these to convert the
-- normalized 0..1 annotation coordinates back to pixels for rendering,
-- and OCR needs them to crop the right region out of the page image.
create table if not exists pages (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  image_url text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  unique (drawing_id, page_number)
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
  updated_at timestamptz not null default now(),
  constraint annotations_x_in_bounds check (x + width <= 1),
  constraint annotations_y_in_bounds check (y + height <= 1)
);

create index if not exists annotations_drawing_page_idx
  on annotations (drawing_id, page_number);

create index if not exists pages_drawing_idx
  on pages (drawing_id);
