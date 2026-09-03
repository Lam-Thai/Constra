"""Local OCR on `capture` annotations (Increment 1, see SPEC.md).

Ownership split (per PM decision):
- `build_masked_crop` below is a fully working implementation — pure PIL +
  geometry, not vendor code.
- `run_ocr_on_annotation` runs the real OCR engine (RapidOCR, local/offline
  — see local-ocr-pipeline skill and VERIFIED-DEPS.md), implemented by
  ocr-integration-engineer.

Contract:
    OcrResult(text, confidence, engine) — `confidence` is a 0..1 mean word
    confidence, or None if the engine doesn't expose one (including "no
    text detected", which is not an error). `engine` is a provenance
    string like "rapidocr@3.9.2", with the version read dynamically from
    the installed package rather than hardcoded.

    run_ocr_on_annotation(annotation):
      1. Calls build_masked_crop(annotation) to get the masked PIL crop.
      2. Upscales ~3x (bicubic) without grayscaling/binarizing.
      3. Runs RapidOCR locally at 0, +90, and -90 degrees, keeps whichever
         pass has the highest mean confidence (RapidOCR's built-in
         classifier only reliably corrects 180-degree flips, and — see the
         function's docstring — a single 90-degree direction is not
         reliably rescued back to the correct reading by that classifier
         either, so both directions are tried explicitly).
      4. Joins recognized lines preserving reading order and averages
         line confidences.
      5. Raises OcrError (not a bare exception) on any engine failure so
         the calling view can catch it per-annotation without aborting a
         batch. No detections is NOT an error — see OcrResult contract.

    `ignore` annotations are never passed to this function directly, but
    `build_masked_crop` reads them from the same page to mask them out of
    a `capture` crop.
"""

from __future__ import annotations

import importlib.metadata
import logging
import threading
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

# --- RapidOCR engine params (tuned for 150 DPI construction-drawing crops,
# see local-ocr-pipeline skill / VERIFIED-DEPS.md) ---
_ENGINE_PARAMS = {
    "Global.text_score": 0.5,
    "Det.box_thresh": 0.4,
    "Det.unclip_ratio": 2.0,
    "Det.score_mode": "slow",
}

# Empirically swept 2x/3x/4x on real crops from the sample drawing (see
# ocr-integration-engineer's task notes): 3x is at least tied with 2x and
# beats 4x on every crop tested, and clearly wins on dense small-font text
# (paragraph note block: 0.9937 mean conf at 3x vs 0.9876 at 2x / 0.9879 at
# 4x). Matches VERIFIED-DEPS.md's 2.5-3x guidance.
_UPSCALE_FACTOR = 3.0
# Cap the upscaled dimension so a very large capture rectangle can't blow up
# memory/CPU — 4000px is comfortably above what a 3x upscale of a normal
# capture crop needs, while still bounding worst case.
_MAX_UPSCALED_DIM = 4000

_engine = None
_engine_lock = threading.Lock()


class OcrError(RuntimeError):
    """Raised when OCR fails for a single annotation. Callers must catch
    this per-annotation (see views.DrawingOcrView) so one bad crop doesn't
    abort a whole-drawing OCR batch."""


@dataclass
class OcrResult:
    text: str
    confidence: float | None  # 0..1 mean word confidence, None if unavailable
    engine: str  # e.g. "rapidocr@1.2.3" — provenance, persisted on the annotation


def _page_png_path(annotation) -> Path:
    """Resolve the on-disk PNG for the page this annotation belongs to,
    reusing services.py's on-disk layout convention
    (MEDIA_ROOT/pages/<drawing_id>/page-XXX.png) rather than recomputing it
    independently."""
    from .services import page_png_path  # local import avoids a cycle at module load time

    return page_png_path(annotation.drawing_id, annotation.page_number)


def _denormalize_rect(rect_owner, width: int, height: int) -> tuple[int, int, int, int]:
    """Convert a 0..1 normalized (x, y, width, height) rect to a pixel-space
    (left, top, right, bottom) box, clamped to the image bounds."""
    left = rect_owner.x * width
    top = rect_owner.y * height
    right = (rect_owner.x + rect_owner.width) * width
    bottom = (rect_owner.y + rect_owner.height) * height

    left = max(0, min(width, left))
    top = max(0, min(height, top))
    right = max(0, min(width, right))
    bottom = max(0, min(height, bottom))

    return int(round(left)), int(round(top)), int(round(right)), int(round(bottom))


def build_masked_crop(annotation) -> Image.Image:
    """Crop `annotation`'s region out of its page PNG, with every
    overlapping `ignore` rectangle on the same page painted white first.

    This is the whole point of the red boxes (SPEC.md, Increment 1): text
    inside a red rectangle must never reach the OCR engine, even if it
    falls partly inside a green capture rectangle.

    Steps:
      1. Load the page PNG from MEDIA_ROOT (via services.py's path helper).
      2. Denormalize `annotation`'s rect to pixels, clamped to image bounds.
      3. For every `ignore` annotation on the same page, denormalize its
         rect too, intersect it with the capture rect, and paint the
         *intersection* white directly on the page image (in a copy) before
         cropping — so a red box that only partly overlaps the green box
         only masks the overlapping portion.
      4. Crop and return the resulting PIL Image (mode "RGB").

    Raises OcrError if the page PNG can't be loaded.
    """
    # Import here (not at module top) to avoid a circular import — models.py
    # doesn't import ocr.py, but this keeps the dependency direction obvious.
    from .models import Annotation

    png_path = _page_png_path(annotation)
    try:
        page_image = Image.open(png_path)
        page_image.load()
    except (FileNotFoundError, OSError) as err:
        raise OcrError(f"Could not load page image for masking: {err}") from err

    if page_image.mode != "RGB":
        page_image = page_image.convert("RGB")

    width, height = page_image.size
    capture_box = _denormalize_rect(annotation, width, height)
    cap_left, cap_top, cap_right, cap_bottom = capture_box

    # Work on a copy so we never mutate the on-disk page PNG.
    working_image = page_image.copy()
    draw = ImageDraw.Draw(working_image)

    ignore_rects = Annotation.objects.filter(
        drawing_id=annotation.drawing_id,
        page_number=annotation.page_number,
        type=Annotation.IGNORE,
    )
    for ignore in ignore_rects:
        ig_left, ig_top, ig_right, ig_bottom = _denormalize_rect(ignore, width, height)

        # Intersection of the ignore box and the capture box.
        inter_left = max(cap_left, ig_left)
        inter_top = max(cap_top, ig_top)
        inter_right = min(cap_right, ig_right)
        inter_bottom = min(cap_bottom, ig_bottom)

        if inter_left < inter_right and inter_top < inter_bottom:
            # PIL's rectangle() treats the second point as inclusive, so
            # subtract 1 to keep the filled region exactly the intersection.
            draw.rectangle(
                [inter_left, inter_top, inter_right - 1, inter_bottom - 1],
                fill=(255, 255, 255),
            )

    if cap_right <= cap_left or cap_bottom <= cap_top:
        # Degenerate (zero-area) rect after clamping — return a 1x1 white
        # pixel rather than raising, so callers can still record an
        # "empty" OCR result instead of a hard failure.
        return Image.new("RGB", (1, 1), (255, 255, 255))

    return working_image.crop((cap_left, cap_top, cap_right, cap_bottom))


def _get_engine():
    """Lazily instantiate the module-level RapidOCR singleton.

    Model load (~1-2s) is expensive, so this must happen once per process,
    not per request — but importing `rapidocr` (and loading its bundled
    ONNX models) must never happen at module import time, since that would
    make importing this module (e.g. from an unrelated test, or a Django
    autoreload pass) fail or stall if RapidOCR/onnxruntime are ever
    unavailable in some environment. Double-checked locking keeps this
    thread-safe enough for Django's dev server without adding a heavier
    dependency.
    """
    global _engine
    if _engine is not None:
        return _engine

    with _engine_lock:
        if _engine is None:
            try:
                from rapidocr import RapidOCR
            except Exception as err:  # pragma: no cover - environment issue, not logic
                raise OcrError(f"RapidOCR is not available: {err}") from err
            try:
                _engine = RapidOCR(params=_ENGINE_PARAMS)
            except Exception as err:
                raise OcrError(f"Failed to initialize RapidOCR engine: {err}") from err
    return _engine


def _engine_version() -> str:
    try:
        version = importlib.metadata.version("rapidocr")
    except importlib.metadata.PackageNotFoundError:  # pragma: no cover - shouldn't happen if RapidOCR loaded
        version = "unknown"
    return f"rapidocr@{version}"


def _upscale(image: Image.Image) -> Image.Image:
    """Upscale a crop ~3x with bicubic interpolation before OCR.

    Rationale (VERIFIED-DEPS.md): RapidOCR's rec model resizes every
    detected line to 48px tall; ~1/8in text at 150 DPI is only ~19px
    natively, so it upsamples internally and invents detail if we don't
    give it more pixels to work with first. Deliberately NOT converting to
    grayscale or binarizing here — PP-OCR's models are trained on natural
    RGB crops and Otsu/adaptive thresholding measurably hurts them.

    Dimensions are capped at `_MAX_UPSCALED_DIM` so an unusually large
    capture rectangle can't blow up memory.
    """
    width, height = image.size
    target_w = int(round(width * _UPSCALE_FACTOR))
    target_h = int(round(height * _UPSCALE_FACTOR))

    longest = max(target_w, target_h)
    if longest > _MAX_UPSCALED_DIM:
        scale = _MAX_UPSCALED_DIM / longest
        target_w = int(round(target_w * scale))
        target_h = int(round(target_h * scale))

    target_w = max(1, target_w)
    target_h = max(1, target_h)
    return image.resize((target_w, target_h), Image.Resampling.BICUBIC)


def _run_pass(engine, image: Image.Image) -> tuple[str, float | None]:
    """Run one OCR pass over `image` and return (joined_text, mean_conf).

    Returns ("", None) when RapidOCR detects no text at all — that's a
    normal outcome (an empty crop, a rectangle drawn over blank space),
    not an error.
    """
    import numpy as np

    array = np.array(image)
    try:
        result = engine(array)
    except Exception as err:
        raise OcrError(f"RapidOCR engine call failed: {err}") from err

    texts = getattr(result, "txts", None) if result is not None else None
    scores = getattr(result, "scores", None) if result is not None else None
    if not texts:
        return "", None

    text = "\n".join(texts)
    mean_conf = (sum(scores) / len(scores)) if scores else None
    return text, mean_conf


def run_ocr_on_annotation(annotation) -> OcrResult:
    """Crop the annotation's region from its page PNG, mask any
    overlapping `ignore` rectangles to white, preprocess, and OCR locally
    with RapidOCR.

    Multi-pass rotation (required, not optional — see VERIFIED-DEPS.md):
    RapidOCR's classifier only reliably corrects 180-degree flips, not
    90/270, and construction sheets are full of rotated dimension strings
    and vertical title-block text. We OCR the upscaled crop at 0 degrees
    and again rotated +90 and -90 degrees, and keep whichever pass has the
    highest mean confidence.

    IMPORTANT, empirically discovered while implementing this (see task
    notes): a single 90-degree pass in only ONE rotation direction is NOT
    enough. On a real vertical "6\"" dimension label from the sample
    drawing, the crop's actual rotation needed a -90 (clockwise) turn to
    read correctly (0.98 mean conf, correct '6"' text); the "other" 90
    (+90/counter-clockwise) landed on a garbled orientation that scored
    just as poorly as doing nothing (0.81 vs 0.80, both wrong), and
    RapidOCR's built-in classifier did NOT rescue it back to the correct
    reading despite `use_cls=True` being the default — so relying on "0 and
    90, cls handles the rest" silently fails for exactly the short,
    low-signal rotated strings (dimension callouts) this is meant to fix.
    Trying both +90 and -90 explicitly closes that gap.

    No detections is NOT an error: returns an OcrResult with empty text so
    the caller records status `empty` rather than `failed`.

    Raises OcrError on any actual engine failure.
    """
    crop = build_masked_crop(annotation)
    if crop.mode != "RGB":
        crop = crop.convert("RGB")

    upscaled = _upscale(crop)
    engine = _get_engine()

    candidates = [
        upscaled,
        upscaled.transpose(Image.Transpose.ROTATE_90),  # +90, counter-clockwise
        upscaled.transpose(Image.Transpose.ROTATE_270),  # -90, clockwise
    ]

    best_text, best_conf = "", None
    for candidate in candidates:
        text, conf = _run_pass(engine, candidate)
        # Treat "no detections" (None) as the lowest possible score for the
        # comparison, without pretending it's a real confidence value.
        if (conf or 0.0) > (best_conf or 0.0):
            best_text, best_conf = text, conf

    return OcrResult(text=best_text, confidence=best_conf, engine=_engine_version())
