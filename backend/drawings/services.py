"""Shared logic for turning source files (PDF or raster image) into a
persisted Drawing + Page row(s), backed by PNGs under MEDIA_ROOT.

Used by both the `import_pdf` management command and the upload API view
(`DrawingCreateView`) so there is exactly one place that knows the
on-disk layout (`MEDIA_ROOT/pages/<drawing_id>/page-XXX.png`) and how a
Page's `image_url` is built.
"""

from pathlib import Path

import pypdfium2 as pdfium
from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from PIL import Image, UnidentifiedImageError

from .models import Annotation, Drawing, Page

DPI = 150
SCALE = DPI / 72  # pypdfium2 renders at 72 DPI = scale 1.0


class SourceFileError(ValueError):
    """Raised when the uploaded/downloaded source file can't be parsed.

    Callers (management command, API view) map this to their own
    error-reporting mechanism (CommandError, 400 response, ...).
    """


def _page_out_dir(drawing_id) -> Path:
    out_dir = Path(settings.MEDIA_ROOT) / "pages" / str(drawing_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def _build_image_url(drawing_id, filename: str) -> str:
    relative_url = f"{settings.MEDIA_URL}pages/{drawing_id}/{filename}"
    return f"{settings.BACKEND_BASE_URL}{relative_url}"


def _page_file_path(drawing_id, page_number: int) -> Path:
    return _page_out_dir(drawing_id) / f"page-{page_number:03d}.png"


def page_png_path(drawing_id, page_number: int) -> Path:
    """Public accessor for the on-disk page PNG path — used by ocr.py so
    every consumer of the `MEDIA_ROOT/pages/<drawing_id>/page-XXX.png`
    layout goes through this one place instead of recomputing it."""
    return _page_file_path(drawing_id, page_number)


def _write_page_png(drawing_id, page_number: int, pil_image: Image.Image) -> tuple[str, int, int, Path]:
    """Save a single page's PIL image as a PNG, return (image_url, width, height, file_path)."""
    width, height = pil_image.size
    file_path = _page_file_path(drawing_id, page_number)
    pil_image.save(file_path, format="PNG")
    return _build_image_url(drawing_id, file_path.name), width, height, file_path


def _delete_page_files(drawing_id, page_numbers) -> None:
    """Delete the on-disk PNGs for the given page numbers of a drawing.

    Safe to call with page numbers whose files don't exist (missing_ok).
    """
    for page_number in page_numbers:
        _page_file_path(drawing_id, page_number).unlink(missing_ok=True)


def create_or_update_drawing_from_pdf_bytes(name: str, pdf_bytes: bytes) -> Drawing:
    """Parse `pdf_bytes`, render every page to a PNG, and create/update the
    Drawing + Page rows. Idempotent on `name` (re-running updates in place).

    Raises SourceFileError if the bytes aren't a parseable PDF, or if any
    individual page fails to render (in which case the DB is left exactly
    as it was before the call — see the `transaction.atomic()` wrap below).
    """
    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except Exception as err:
        raise SourceFileError(f"Could not parse PDF — file may be corrupt or truncated: {err}") from err

    try:
        page_count = len(pdf)
        if page_count == 0:
            raise SourceFileError("PDF has no pages")

        # PNGs written to disk aren't part of the DB transaction below, so
        # track them here to clean up on failure and avoid leaving orphans.
        written_files: list[Path] = []

        try:
            with transaction.atomic():
                is_replace = Drawing.objects.filter(name=name).exists()

                drawing, _ = Drawing.objects.update_or_create(
                    name=name,
                    defaults={"page_count": page_count},
                )

                if is_replace:
                    # Existing Page rows for still-present page numbers are
                    # about to be overwritten with new image content — any
                    # annotations drawn against the old content no longer
                    # correspond to anything and must not survive a replace.
                    Annotation.objects.filter(drawing=drawing).delete()

                for index in range(page_count):
                    page_number = index + 1
                    try:
                        pdf_page = pdf[index]
                        bitmap = pdf_page.render(scale=SCALE)
                        pil_image = bitmap.to_pil()
                    except Exception as err:
                        raise SourceFileError(
                            f"Could not render page {page_number} — PDF may be corrupt or truncated: {err}"
                        ) from err

                    image_url, width, height, file_path = _write_page_png(drawing.id, page_number, pil_image)
                    written_files.append(file_path)

                    Page.objects.update_or_create(
                        drawing=drawing,
                        page_number=page_number,
                        defaults={"image_url": image_url, "width": width, "height": height},
                    )

                # Drop any orphaned pages (and their backing PNGs) from a
                # prior, longer version of this drawing.
                stale_page_numbers = list(
                    Page.objects.filter(drawing=drawing, page_number__gt=page_count).values_list(
                        "page_number", flat=True
                    )
                )
                Page.objects.filter(drawing=drawing, page_number__gt=page_count).delete()
                _delete_page_files(drawing.id, stale_page_numbers)
        except SourceFileError:
            # The atomic block above has already rolled back every DB change
            # from this call. Also remove any page PNGs written this run so
            # a partial render doesn't leave orphaned files on disk.
            for path in written_files:
                path.unlink(missing_ok=True)
            raise
    finally:
        pdf.close()

    return drawing


def create_drawing_from_image(name: str, uploaded_file: UploadedFile) -> Drawing:
    """Create a single-page Drawing from a raster image upload (PNG/JPEG).

    The image is re-encoded to PNG for consistency with the PDF import path.
    Raises SourceFileError if the file isn't a decodable image.
    """
    try:
        pil_image = Image.open(uploaded_file)
        pil_image.load()  # force decode now, not lazily later
    except (UnidentifiedImageError, OSError) as err:
        raise SourceFileError(f"Could not parse image — file may be corrupt or unsupported: {err}") from err

    if pil_image.mode not in ("RGB", "L"):
        pil_image = pil_image.convert("RGB")

    with transaction.atomic():
        # update_or_create (not .create()) so re-uploading under the same
        # name replaces the drawing in place instead of raising an
        # IntegrityError on the unique `name` constraint — matches the PDF
        # path's idempotency.
        is_replace = Drawing.objects.filter(name=name).exists()

        drawing, _ = Drawing.objects.update_or_create(name=name, defaults={"page_count": 1})

        if is_replace:
            # Same rationale as the PDF path: old annotations are keyed to
            # page content that's about to be overwritten.
            Annotation.objects.filter(drawing=drawing).delete()

        image_url, width, height, _file_path = _write_page_png(drawing.id, 1, pil_image)
        Page.objects.update_or_create(
            drawing=drawing,
            page_number=1,
            defaults={"image_url": image_url, "width": width, "height": height},
        )

        stale_page_numbers = list(
            Page.objects.filter(drawing=drawing, page_number__gt=1).values_list("page_number", flat=True)
        )
        Page.objects.filter(drawing=drawing, page_number__gt=1).delete()
        _delete_page_files(drawing.id, stale_page_numbers)

    return drawing
