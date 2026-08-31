import urllib.error
import urllib.request
from pathlib import Path

import pypdfium2 as pdfium
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from drawings.models import Drawing, Page

PDF_URL = "https://raw.githubusercontent.com/wkoszek/takehome/main/residential-townhouse-remodel.pdf"
DRAWING_NAME = "residential-townhouse-remodel"
DPI = 150
SCALE = DPI / 72  # pypdfium2 renders at 72 DPI = scale 1.0


class Command(BaseCommand):
    help = (
        "Download the sample construction PDF, render each page to a PNG "
        "under MEDIA_ROOT, and create/update the Drawing + Page rows. "
        "Safe to re-run (idempotent: updates in place if already imported)."
    )

    def handle(self, *args, **options):
        self.stdout.write(f"Downloading PDF from {PDF_URL} ...")
        request = urllib.request.Request(PDF_URL, headers={"User-Agent": "Constra-import/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                pdf_bytes = response.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as err:
            raise CommandError(f"Failed to download source PDF from {PDF_URL}: {err}") from err
        self.stdout.write(f"Downloaded {len(pdf_bytes)} bytes")

        try:
            pdf = pdfium.PdfDocument(pdf_bytes)
        except Exception as err:
            raise CommandError(
                f"Failed to parse downloaded PDF — file may be corrupt or truncated: {err}"
            ) from err
        page_count = len(pdf)

        drawing, created = Drawing.objects.update_or_create(
            name=DRAWING_NAME,
            defaults={"page_count": page_count},
        )
        self.stdout.write(
            f"{'Created' if created else 'Updated'} drawing {drawing.id} "
            f"({DRAWING_NAME}), {page_count} pages"
        )

        out_dir = Path(settings.MEDIA_ROOT) / "pages" / str(drawing.id)
        out_dir.mkdir(parents=True, exist_ok=True)

        for index in range(page_count):
            page_number = index + 1
            pdf_page = pdf[index]
            bitmap = pdf_page.render(scale=SCALE)
            pil_image = bitmap.to_pil()
            width, height = pil_image.size

            filename = f"page-{page_number:03d}.png"
            file_path = out_dir / filename
            pil_image.save(file_path)

            relative_url = f"{settings.MEDIA_URL}pages/{drawing.id}/{filename}"
            image_url = f"{settings.BACKEND_BASE_URL}{relative_url}"

            Page.objects.update_or_create(
                drawing=drawing,
                page_number=page_number,
                defaults={"image_url": image_url, "width": width, "height": height},
            )
            self.stdout.write(f"  page {page_number}: {width}x{height} -> {file_path}")

        deleted_count, _ = Page.objects.filter(drawing=drawing, page_number__gt=page_count).delete()
        if deleted_count:
            self.stdout.write(f"  removed {deleted_count} orphaned page row(s) from a prior run")

        pdf.close()
        self.stdout.write(self.style.SUCCESS(f"Import complete: {page_count} pages for '{DRAWING_NAME}'"))
