import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isAnnotationType, isValidUuid, validateRect } from "@/lib/validation";

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

// PATCH /api/annotations/[id]
// Partial update: resize/move (x, y, width, height), change type, or set
// ocr_text (this is also where the OCR pipeline will write extracted text
// later — not implemented in this pass). Only provided fields are changed;
// the resulting rectangle is re-validated as a whole.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
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

  const patch = body as Record<string, unknown>;
  const allowedFields = ["type", "x", "y", "width", "height", "ocr_text"] as const;
  const unknownFields = Object.keys(patch).filter(
    (k) => !allowedFields.includes(k as (typeof allowedFields)[number])
  );
  if (unknownFields.length > 0) {
    return NextResponse.json(
      { error: `Unknown field(s): ${unknownFields.join(", ")}` },
      { status: 400 }
    );
  }

  const existingRows = (await sql`
    select id, drawing_id, page_number, type, x, y, width, height, ocr_text,
           created_at, updated_at
    from annotations
    where id = ${id}
  `) as AnnotationRow[];
  const existing = existingRows[0];
  if (!existing) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }

  if ("type" in patch && !isAnnotationType(patch.type)) {
    return NextResponse.json(
      { error: 'type must be "ignore" or "capture"' },
      { status: 400 }
    );
  }
  if ("ocr_text" in patch && patch.ocr_text !== null && typeof patch.ocr_text !== "string") {
    return NextResponse.json(
      { error: "ocr_text must be a string or null" },
      { status: 400 }
    );
  }

  const merged = {
    type: ("type" in patch ? patch.type : existing.type) as "ignore" | "capture",
    x: "x" in patch ? patch.x : existing.x,
    y: "y" in patch ? patch.y : existing.y,
    width: "width" in patch ? patch.width : existing.width,
    height: "height" in patch ? patch.height : existing.height,
    ocr_text: ("ocr_text" in patch ? patch.ocr_text : existing.ocr_text) as string | null,
  };

  const rectError = validateRect({
    x: merged.x as number,
    y: merged.y as number,
    width: merged.width as number,
    height: merged.height as number,
  });
  if (rectError) {
    return NextResponse.json({ error: rectError }, { status: 400 });
  }

  const [updated] = (await sql`
    update annotations
    set type = ${merged.type},
        x = ${merged.x as number},
        y = ${merged.y as number},
        width = ${merged.width as number},
        height = ${merged.height as number},
        ocr_text = ${merged.ocr_text},
        updated_at = now()
    where id = ${id}
    returning id, drawing_id, page_number, type, x, y, width, height, ocr_text,
              created_at, updated_at
  `) as AnnotationRow[];

  return NextResponse.json(updated);
}

// DELETE /api/annotations/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  const [deleted] = (await sql`
    delete from annotations where id = ${id} returning id
  `) as { id: string }[];

  if (!deleted) {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }

  return NextResponse.json({ id: deleted.id });
}
