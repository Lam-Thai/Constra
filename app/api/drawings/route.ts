import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

interface DrawingListRow {
  id: string;
  name: string;
  page_count: number;
}

// GET /api/drawings
// Minimal list endpoint so the frontend has something to open on `/`.
// Full detail (pages, dimensions) comes from GET /api/drawings/[id].
export async function GET() {
  const drawings = (await sql`
    select id, name, page_count
    from drawings
    order by created_at
  `) as DrawingListRow[];

  return NextResponse.json(drawings);
}
