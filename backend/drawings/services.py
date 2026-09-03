"""Shared logic for turning source files (PDF or raster image) into a
persisted Drawing + Page row(s), backed by PNGs written through Django's
Storage API (`django.core.files.storage.default_storage`) under the
`pages/<drawing_id>/page-XXX.png` key layout.

Used by both the `import_pdf` management command and the upload API view
(`DrawingCreateView`) so there is exactly one place that knows that key
layout and how a Page's `image_url` is built.

Goes through the Storage API rather than raw filesystem paths so this
works unmodified whether `default_storage` is local disk (dev/tests) or
an S3-compatible bucket (prod — see config.settings' USE_S3_MEDIA). Local
disk is still what backs `default_storage` in dev, so nothing here needs
to change to keep local dev/tests working exactly as before.
"""

import io
from pathlib import Path

import pypdfium2 as pdfium
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
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


def _build_image_url(name: str) -> str:
    """Turn a storage-relative key into the absolute URL stored on Page.image_url.

    `default_storage.url()` already returns a fully-qualified URL (bucket/
    CDN domain included) for the S3 backend; for local FileSystemStorage it
    only returns a MEDIA_URL-relative path, so that case still needs
    BACKEND_BASE_URL prefixed to match this project's existing contract of
    always handing the frontend an absolute image_url.
    """
    url = default_storage.url(name)
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"{settings.BACKEND_BASE_URL}{url}"


def page_png_storage_name(drawing_id, page_number: int) -> str:
    """Canonical storage-relative key for a page PNG — the single source of
    truth both this module and ocr.py build reads/writes from."""
    return f"pages/{drawing_id}/page-{page_number:03d}.png"


def page_png_path(drawing_id, page_number: int) -> Path:
    """Local-disk path for a page PNG. Only meaningful when the active
    storage backend is filesystem-based (local dev / tests) — kept around
    because that's exactly the environment this is used in (e.g. tests
    writing a fixture PNG directly). Prod (S3-backed) code must go through
    `page_png_storage_name()` + `default_storage` instead, never this."""
    return Path(settings.MEDIA_ROOT) / page_png_storage_name(drawing_id, page_number)


def _write_page_png(drawing_id, page_number: int, pil_image: Image.Image) -> tuple[str, int, int, str]:
    """Save a single page's PIL image as a PNG via the Storage API, return
    (image_url, width, height, storage_name)."""
    width, height = pil_image.size
    name = page_png_storage_name(drawing_id, page_number)

    buffer = io.BytesIO()
    pil_image.save(buffer, format="PNG")
    buffer.seek(0)

    # FileSystemStorage's default behavior on a name collision is to
    # *rename* (page-001_abc123.png) rather than overwrite, which would
    # silently orphan the old file and break the stable URL contract — so
    # delete first for that backend. Skip the extra exists()/delete()
    # round-trip on S3, which already has AWS_S3_FILE_OVERWRITE=True and
    # replaces the key in place on save().
    if not settings.USE_S3_MEDIA and default_storage.exists(name):
        default_storage.delete(name)
    default_storage.save(name, ContentFile(buffer.read()))

    return _build_image_url(name), width, height, name


def _delete_page_files(drawing_id, page_numbers) -> None:
    """Delete the stored PNGs for the given page numbers of a drawing.

    Safe to call with page numbers whose files don't exist — both
    FileSystemStorage and S3Storage no-op/ignore a delete of a missing key.
    """
    for page_number in page_numbers:
        default_storage.delete(page_png_storage_name(drawing_id, page_number))


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

        # PNGs written via the Storage API aren't part of the DB transaction
        # below, so track their storage names here to clean up on failure
        # and avoid leaving orphans (on disk locally, or in the bucket).
        written_names: list[str] = []

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

                    image_url, width, height, storage_name = _write_page_png(drawing.id, page_number, pil_image)
                    written_names.append(storage_name)

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
            # a partial render doesn't leave orphaned files behind.
            for stored_name in written_names:
                default_storage.delete(stored_name)
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

        image_url, width, height, _storage_name = _write_page_png(drawing.id, 1, pil_image)
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
