import urllib.error
import urllib.request

from django.core.management.base import BaseCommand, CommandError

from drawings.services import SourceFileError, create_or_update_drawing_from_pdf_bytes

PDF_URL = "https://raw.githubusercontent.com/wkoszek/takehome/main/residential-townhouse-remodel.pdf"
DRAWING_NAME = "residential-townhouse-remodel"


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
            drawing = create_or_update_drawing_from_pdf_bytes(DRAWING_NAME, pdf_bytes)
        except SourceFileError as err:
            raise CommandError(str(err)) from err

        self.stdout.write(
            self.style.SUCCESS(
                f"Import complete: drawing {drawing.id} ('{drawing.name}'), {drawing.page_count} pages"
            )
        )
