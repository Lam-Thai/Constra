---
name: canvas-annotation-overlay
description: How to build the rectangle-drawing overlay on top of a rendered drawing page — coordinate system, draw/select/resize/delete interactions, and syncing with the backend. Use whenever implementing or changing the drawing UI for Constra (frontend-developer's core skill).
---

# Canvas annotation overlay for Constra

## Architecture

Render each page as an `<img>` (rasterized page) inside a positioned
container; overlay an absolutely-positioned `<svg>` the same size as the
image, listening for pointer events. SVG is preferable to `<canvas>` here
because each rectangle needs to stay an addressable, styleable, hit-testable
element (for select/resize/delete) — redrawing everything on a canvas on
every interaction is unnecessary work for a project this size.

```tsx
<div style={{ position: "relative", width: pageWidth, height: pageHeight }}>
  <img src={pageImageUrl} width={pageWidth} height={pageHeight} />
  <svg
    style={{ position: "absolute", inset: 0 }}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
  >
    {annotations.map(a => <RectAnnotation key={a.id} {...a} />)}
  </svg>
</div>
```

## Coordinate system — normalize, don't store pixels

Compute pointer position relative to the SVG's bounding rect, then divide
by the rect's width/height to get **normalized 0–1 coordinates** before
storing or sending anything to the API. This matches the backend schema
(see `neon-postgres-setup`) and is what keeps rectangles aligned after a
window resize, zoom, or reload at a different viewport size.

```ts
function toNormalized(e: PointerEvent, svgEl: SVGSVGElement) {
  const rect = svgEl.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
}

// convert back for rendering:
const pixelX = normalized.x * rect.width;
```

Never persist raw `clientX`/`clientY` or CSS pixel values — they're only
valid for the viewport size they were captured at.

## Interaction states

A small state machine covers everything needed:

- **idle** — no active gesture. Toolbar selects the active mode: `ignore`
  (red), `capture` (green), or `select`.
- **drawing** — pointerdown in `ignore`/`capture` mode starts a rectangle;
  pointermove resizes it live from the anchor corner; pointerup finalizes
  it. Require a minimum drag distance (~4px) before committing a rectangle,
  so a stray click doesn't create a zero-size one.
- **selected** — in `select` mode, clicking an existing rectangle shows
  resize handles on its corners/edges and a delete affordance. Dragging the
  body moves it; dragging a handle resizes it; `Delete`/`Backspace` removes
  it.

Always normalize `x`/`y`/`width`/`height` to positive values on
finalize — a drag can go in any direction (right-to-left, bottom-to-top),
so compute `x = min(startX, endX)`, `width = abs(endX - startX)`, etc.
before saving. Clamp to `[0, 1]` so a drag past the image edge doesn't
produce out-of-bounds coordinates the backend will reject.

## Syncing with the backend

- The backend is a separate Django service (default `http://localhost:8000`,
  distinct from the Next.js dev server on `:3000`) — read the base URL from
  `process.env.NEXT_PUBLIC_API_BASE_URL`, never hardcode it, and remember
  DRF's routes end in a trailing slash (`/api/annotations/<id>/`, not
  `/api/annotations/<id>`) — a missing slash 404s.
- On finalize (pointerup) or after a resize/move/delete settles, call the
  API immediately — don't batch or silently discard failures. Optimistic
  update: add the rectangle to local state right away, then reconcile with
  the server's returned `id`; on failure, remove it and surface an error
  rather than leaving phantom state.
- On page load, `GET` that page's annotations before rendering the overlay,
  so a reload — or app restart — shows exactly what was there before. This
  is the UI-side half of the project's persistence requirement; the backend
  storing data correctly isn't enough if the frontend never re-fetches it.

## Rendering text safely

If OCR text (from `ocr-integration-engineer`'s work) is shown anywhere in
the UI (e.g. a tooltip or side panel on a capture rectangle), render it as
plain text — never `dangerouslySetInnerHTML`. OCR output is untrusted
content extracted from an image; treat it like any other user-controlled
string.
