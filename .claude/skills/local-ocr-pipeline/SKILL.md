---
name: local-ocr-pipeline
description: How to run local OCR on a green "capture" rectangle's cropped pixels and save the result — cropping approach, library choice, and error handling. Use when implementing the OCR bonus feature for Constra (ocr-integration-engineer's core skill).
---

# Local OCR pipeline for Constra (Django)

## Constraint: local only

The project brief requires OCR to run **locally** — no cloud OCR API
(Google Vision, AWS Textract, Azure CV, etc.), even if one would be more
accurate. Use `pytesseract`, a thin Python wrapper around the open-source
Tesseract OCR engine.

```bash
pip install pytesseract Pillow
```

**Important environment caveat, unlike the rest of this stack**:
`pytesseract` only wraps the `tesseract` CLI binary — it does not bundle
the OCR engine itself. The Tesseract binary must be installed separately
on the machine running the backend (e.g. the official Windows installer,
`apt install tesseract-ocr` on Linux, `brew install tesseract` on macOS).
This is a real local system dependency, not a pip-installable one — flag
it to the PM before starting this work if it isn't already installed,
the same way a missing `DATABASE_URL` was flagged, rather than silently
assuming it's there.

## Crop before OCR, never OCR the whole page

Given a capture rectangle's normalized coordinates (see
`neon-postgres-setup` / `canvas-annotation-overlay` for the shared 0–1
coordinate contract) and the source page image, crop to just that region
at native resolution using Pillow before running OCR. This is both faster
and more accurate than OCR-ing the full page and discarding everything
outside the rectangle.

```python
from PIL import Image
import pytesseract

def ocr_region(page_image_path: str, x: float, y: float, width: float, height: float) -> str:
    with Image.open(page_image_path) as image:
        img_w, img_h = image.size
        left = round(x * img_w)
        top = round(y * img_h)
        right = min(img_w, round((x + width) * img_w))
        bottom = min(img_h, round((y + height) * img_h))
        cropped = image.crop((left, top, right, bottom))
        return pytesseract.image_to_string(cropped).strip()
```

Clamp the crop box to the image bounds (as above) before calling `.crop()`
— a rectangle drawn right at the page edge can otherwise produce an
out-of-range box.

## When to run it

Trigger OCR server-side right after a capture (green) rectangle is saved,
as its own step — don't block the annotation's create/update response on
OCR completing if it's slow enough to matter. For a project this size,
running it synchronously inside the request (Tesseract on a small crop is
typically well under a second) is simpler than standing up a task queue
(Celery, etc.) and is fine — don't add background job infrastructure unless
OCR proves too slow in practice. If it does end up async, save the
rectangle first, then `PATCH` `ocr_text` once OCR resolves, with a
per-rectangle loading state in the UI.

## Error handling

OCR failure must never break the save flow:

```python
try:
    text = ocr_region(page_image_path, x, y, width, height)
except Exception:
    logger.exception("OCR failed for annotation %s", annotation_id)
    text = None
    # leave ocr_text null; the annotation itself is already saved.
    # surface a retry affordance in the UI rather than failing the request.
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
