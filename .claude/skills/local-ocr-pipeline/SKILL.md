---
name: local-ocr-pipeline
description: How to run local OCR on a green "capture" rectangle's cropped pixels and save the result — cropping approach, library choice, and error handling. Use when implementing the OCR bonus feature for Constra (ocr-integration-engineer's core skill).
---

# Local OCR pipeline for Constra

## Constraint: local only

The project brief requires OCR to run **locally** — no cloud OCR API
(Google Vision, AWS Textract, Azure CV, etc.), even if one would be more
accurate. Use `tesseract.js`, which runs entirely in-process via WASM, no
API key, no network call.

```bash
npm install tesseract.js sharp
```

## Crop before OCR, never OCR the whole page

Given a capture rectangle's normalized coordinates (see
`neon-postgres-setup` / `canvas-annotation-overlay` for the shared 0–1
coordinate contract) and the source page image, crop to just that region
at native resolution using `sharp` before running OCR. This is both faster
and more accurate than OCR-ing the full page and discarding everything
outside the rectangle.

```ts
import sharp from "sharp";
import { createWorker } from "tesseract.js";

interface NormalizedRect { x: number; y: number; width: number; height: number }

export async function ocrRegion(pageImagePath: string, rect: NormalizedRect) {
  const image = sharp(pageImagePath);
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("could not read page image dimensions");

  const left = Math.round(rect.x * meta.width);
  const top = Math.round(rect.y * meta.height);
  const width = Math.max(1, Math.round(rect.width * meta.width));
  const height = Math.max(1, Math.round(rect.height * meta.height));

  const cropped = await image
    .extract({ left, top, width, height })
    .toBuffer();

  const worker = await createWorker("eng");
  try {
    const { data: { text } } = await worker.recognize(cropped);
    return text.trim();
  } finally {
    await worker.terminate();
  }
}
```

Clamp `left`/`top`/`width`/`height` to the image bounds before calling
`extract` — a rectangle drawn right at the page edge can otherwise produce
an out-of-range crop that throws.

## When to run it

Trigger OCR server-side right after a capture (green) rectangle is saved,
as its own step — don't block the annotation save on OCR completing. Save
the rectangle first (so drawing feels instant), then run OCR and `PATCH`
the `ocr_text` field once it resolves. Show a per-rectangle loading state
in the UI rather than freezing the whole page.

A worker pool (reusing `tesseract.js` workers across requests) would cut
the ~1–2s worker-init cost, but isn't worth the complexity at this
project's scale — one worker per OCR call is fine.

## Error handling

OCR failure must never break the save flow:

```ts
try {
  const text = await ocrRegion(pageImagePath, rect);
  await sql`update annotations set ocr_text = ${text}, updated_at = now() where id = ${id}`;
} catch (err) {
  console.error("OCR failed for annotation", id, err);
  // leave ocr_text null; the annotation itself is already saved.
  // surface a retry affordance in the UI rather than failing the request.
}
```

Distinguish "OCR hasn't run yet" from "OCR ran and found no text" from
"OCR failed" if the UI needs to show different states — a `null` vs empty
string vs an explicit status field, whichever the schema already supports;
don't overload one value to mean three things.

## Testing

Run it against at least one real capture rectangle drawn on the actual
sample drawing (not a synthetic test image) before considering this done —
font rendering and scan quality in real construction drawings can behave
differently than a clean test crop.
