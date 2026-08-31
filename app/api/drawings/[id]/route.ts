import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isValidUuid } from "@/lib/validation";

interface DrawingRow {
  id: string;
  name: string;
  page_count: number;
  created_at: string;
}

interface PageRow {
  page_number: number;
  image_url: string;
  width: number;
  height: number;
}

// GET /api/drawings/[id]
// Returns drawing metadata plus its full page list, so the frontend can
// build the whole viewer from a single call.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  const drawings = (await sql`
    select id, name, page_count, created_at
    from drawings
    where id = ${id}
  `) as DrawingRow[];

  const drawing = drawings[0];
  if (!drawing) {
    return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
  }

  const pages = (await sql`
    select page_number, image_url, width, height
    from pages
    where drawing_id = ${id}
    order by page_number
  `) as PageRow[];

  return NextResponse.json({
    id: drawing.id,
    name: drawing.name,
    page_count: drawing.page_count,
    created_at: drawing.created_at,
    pages,
  });
}
