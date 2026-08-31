/**
 * One-time import script: downloads the sample multipage construction PDF,
 * renders each page to a PNG under public/pages/<drawing>/, and upserts one
 * `drawings` row + one `pages` row per page into Postgres (the DB, not a
 * manifest file, is the source of truth the API reads from).
 *
 * Run as a standalone script (not from a Next.js route handler) so the
 * native `@napi-rs/canvas` dependency pulled in by `pdf-to-png-converter`
 * never has to go through the Next.js bundler.
 *
 * Prerequisite: migrations must already be applied (`npx tsx scripts/migrate.ts`).
 *
 * Usage:
 *   npx tsx scripts/import-pdf.ts
 *
 * Safe to re-run: if the drawing is already fully imported (a `drawings`
 * row exists and it already has exactly `page_count` `pages` rows), the
 * script skips the download/render/DB work entirely. Otherwise it
 * re-downloads, re-renders, and upserts (on drawing name / page number),
 * so a partial or interrupted prior run is repaired rather than left
 * inconsistent.
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { pdfToPng, VerbosityLevel } from "pdf-to-png-converter";
import { requireDatabaseUrl } from "./env";

const PDF_URL =
  "https://raw.githubusercontent.com/wkoszek/takehome/main/residential-townhouse-remodel.pdf";
const DRAWING_NAME = "residential-townhouse-remodel";
// ~150 DPI: pdf.js viewports are scaled from the PDF's native 72 DPI.
const VIEWPORT_SCALE = 150 / 72;

async function main() {
  const sql = neon(requireDatabaseUrl());

  // --- Skip-if-already-imported check -------------------------------------
  let existing: { id: string; page_count: number }[];
  try {
    existing = (await sql`
      select id, page_count from drawings where name = ${DRAWING_NAME}
    `) as { id: string; page_count: number }[];
  } catch (err) {
    console.error(
      "Failed to query the `drawings` table. Have migrations been applied?\n" +
        "Run: npx tsx scripts/migrate.ts\n"
    );
    throw err;
  }

  if (existing.length > 0) {
    const drawing = existing[0];
    const [{ count }] = (await sql`
      select count(*)::int as count from pages where drawing_id = ${drawing.id}
    `) as { count: number }[];

    if (count === drawing.page_count) {
      console.log(
        `Drawing "${DRAWING_NAME}" already imported (${count} pages). Skipping.`
      );
      return;
    }
    console.log(
      `Drawing "${DRAWING_NAME}" exists but only has ${count}/${drawing.page_count} ` +
        `page rows — re-importing to repair it.`
    );
  }

  // --- Download -------------------------------------------------------------
  console.log(`Downloading ${PDF_URL} ...`);
  const response = await fetch(PDF_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download PDF: ${response.status} ${response.statusText}`
    );
  }
  const pdfBuffer = Buffer.from(await response.arrayBuffer());
  console.log(`Downloaded ${(pdfBuffer.byteLength / 1024 / 1024).toFixed(2)} MB.`);

  // --- Render to PNG ----------------------------------------------------------
  const outputFolder = path.join(process.cwd(), "public", "pages", DRAWING_NAME);
  // Clear any stale output from a previous partial run: pdf-to-png-converter
  // writes with exclusive-create and throws EEXIST on a pre-existing file.
  await rm(outputFolder, { recursive: true, force: true });
  await mkdir(outputFolder, { recursive: true });

  console.log(`Rendering pages at ${VIEWPORT_SCALE.toFixed(3)}x scale (~150 DPI) ...`);
  const pages = await pdfToPng(pdfBuffer, {
    outputFolder,
    outputFileMaskFunc: (pageNumber) => `page-${pageNumber}.png`,
    viewportScale: VIEWPORT_SCALE,
    returnPageContent: false, // we only need dimensions; PNGs are already on disk
    verbosityLevel: VerbosityLevel.ERRORS,
  });
  console.log(`Rendered ${pages.length} page(s).`);

  // --- Persist to Postgres ---------------------------------------------------
  const [drawing] = (await sql`
    insert into drawings (name, page_count)
    values (${DRAWING_NAME}, ${pages.length})
    on conflict (name) do update set page_count = excluded.page_count
    returning id
  `) as { id: string }[];

  for (const page of pages) {
    const imageUrl = `/pages/${DRAWING_NAME}/page-${page.pageNumber}.png`;
    await sql`
      insert into pages (drawing_id, page_number, image_url, width, height)
      values (${drawing.id}, ${page.pageNumber}, ${imageUrl}, ${page.width}, ${page.height})
      on conflict (drawing_id, page_number)
      do update set image_url = excluded.image_url,
                    width = excluded.width,
                    height = excluded.height
    `;
  }

  console.log(
    `Imported drawing "${DRAWING_NAME}" (id=${drawing.id}) with ${pages.length} page(s).`
  );
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
