import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
  isAnnotationType,
  isValidUuid,
  parsePositiveIntParam,
  validateRect,
} from "@/lib/validation";

interface AnnotationRow {
  id: string;
  drawing_id: string;
  page_number: number;
  type: "ignore" | "capture";
  x: number;
  y: number;
  width: number;
  height: number;
  ocr_text: string | null;
  created_at: string;
  updated_at: string;
}

async function pageExists(drawingId: string, pageNumber: number): Promise<boolean> {
  const rows = (await sql`
    select 1 from pages where drawing_id = ${drawingId} and page_number = ${pageNumber}
  `) as unknown[];
  return rows.length > 0;
}

// GET /api/drawings/[id]/pages/[page]/annotations
// Lists annotations for a single page.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; page: string }> }
) {
  const { id: drawingId, page } = await params;

  if (!isValidUuid(drawingId)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  const pageNumber = parsePositiveIntParam(page);
  if (pageNumber === null) {
    return NextResponse.json(
      { error: "page must be a positive integer" },
      { status: 400 }
    );
  }

  const annotations = (await sql`
    select id, drawing_id, page_number, type, x, y, width, height, ocr_text,
           created_at, updated_at
    from annotations
    where drawing_id = ${drawingId} and page_number = ${pageNumber}
    order by created_at
  `) as AnnotationRow[];

  return NextResponse.json(annotations);
}

// POST /api/drawings/[id]/pages/[page]/annotations
// Creates one annotation. Returns the full row (including generated id) so
// the frontend can reconcile optimistic local state with the real record.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; page: string }> }
) {
  const { id: drawingId, page } = await params;

  if (!isValidUuid(drawingId)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  const pageNumber = parsePositiveIntParam(page);
  if (pageNumber === null) {
    return NextResponse.json(
      { error: "page must be a positive integer" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const { type, x, y, width, height } = body as Record<string, unknown>;

  if (!isAnnotationType(type)) {
    return NextResponse.json(
      { error: 'type must be "ignore" or "capture"' },
      { status: 400 }
    );
  }

  const rectError = validateRect({
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
  });
  if (rectError) {
    return NextResponse.json({ error: rectError }, { status: 400 });
  }

  if (!(await pageExists(drawingId, pageNumber))) {
    return NextResponse.json(
      { error: "Drawing or page not found" },
      { status: 404 }
    );
  }

  const [annotation] = (await sql`
    insert into annotations (drawing_id, page_number, type, x, y, width, height)
    values (${drawingId}, ${pageNumber}, ${type}, ${x as number}, ${y as number}, ${width as number}, ${height as number})
    returning id, drawing_id, page_number, type, x, y, width, height, ocr_text,
              created_at, updated_at
  `) as AnnotationRow[];

  return NextResponse.json(annotation, { status: 201 });
}
