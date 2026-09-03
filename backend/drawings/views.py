import csv
import io
import logging
import os

from django.db import DatabaseError, transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .estimating import ExtractionError, ExtractionUnavailable, extract_line_items
from .models import Annotation, Drawing, EstimateLineItem, EstimateRun, Page, UnitPrice
from .ocr import OcrError, run_ocr_on_annotation
from .pricing import compute_totals, price_extracted_item
from .serializers import (
    UNIT_PRICE_CSV_FIELDS,
    AnnotationSerializer,
    DrawingDetailSerializer,
    DrawingEstimateRequestSerializer,
    DrawingListSerializer,
    DrawingOcrRequestSerializer,
    DrawingUploadSerializer,
    EstimateRunListSerializer,
    EstimateRunSerializer,
    UnitPriceCsvRowSerializer,
    UnitPriceSerializer,
)
from .services import SourceFileError, create_drawing_from_image, create_or_update_drawing_from_pdf_bytes

logger = logging.getLogger(__name__)

# CSV import safety caps (SPEC.md) — small, generous for ~30-a-few-hundred
# catalog rows, but bounded so a malformed/huge upload can't hang the
# request or exhaust memory.
CSV_IMPORT_MAX_BYTES = 2 * 1024 * 1024  # 2MB
CSV_IMPORT_MAX_ROWS = 2000

# Cells starting with any of these are neutralized on CSV export (CSV
# injection / formula injection protection) by prefixing with a single
# quote, which Excel/Sheets treat as "force text" and strip on display.
_CSV_INJECTION_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


class DrawingListView(APIView):
    # JSONParser is DRF's default; MultiPartParser/FormParser are needed for
    # the file-upload POST below (multipart/form-data request bodies).
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        drawings = Drawing.objects.all().order_by("name")
        return Response(DrawingListSerializer(drawings, many=True).data)

    def post(self, request):
        upload = DrawingUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        name = upload.validated_data["name"]
        uploaded_file = upload.validated_data["file"]
        ext = os.path.splitext(uploaded_file.name or "")[1].lower()

        try:
            if ext == ".pdf":
                pdf_bytes = uploaded_file.read()
                drawing = create_or_update_drawing_from_pdf_bytes(name, pdf_bytes)
            else:
                drawing = create_drawing_from_image(name, uploaded_file)
        except SourceFileError as err:
            return Response({"file": [str(err)]}, status=status.HTTP_400_BAD_REQUEST)

        return Response(DrawingDetailSerializer(drawing).data, status=status.HTTP_201_CREATED)


class DrawingDetailView(APIView):
    def get(self, request, id):
        drawing = get_object_or_404(Drawing, id=id)
        return Response(DrawingDetailSerializer(drawing).data)


class PageAnnotationListView(APIView):
    def _get_drawing_and_page(self, id, page):
        drawing = get_object_or_404(Drawing, id=id)
        get_object_or_404(Page, drawing=drawing, page_number=page)
        return drawing

    def get(self, request, id, page):
        drawing = self._get_drawing_and_page(id, page)
        annotations = Annotation.objects.filter(drawing=drawing, page_number=page).order_by("created_at")
        return Response(AnnotationSerializer(annotations, many=True).data)

    def post(self, request, id, page):
        drawing = self._get_drawing_and_page(id, page)
        serializer = AnnotationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(drawing=drawing, page_number=page)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AnnotationDetailView(APIView):
    def patch(self, request, id):
        annotation = get_object_or_404(Annotation, id=id)
        serializer = AnnotationSerializer(annotation, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, id):
        annotation = get_object_or_404(Annotation, id=id)
        annotation_id = annotation.id
        annotation.delete()
        return Response({"id": annotation_id}, status=status.HTTP_200_OK)


class DrawingOcrView(APIView):
    """POST /api/drawings/<uuid:id>/ocr/ — run local OCR over this
    drawing's `capture` annotations (one page, or the whole drawing).

    Synchronous by design (explicit button, SPEC.md) but must not hold a
    DB transaction open across the OCR calls — each annotation's own
    .save() is its own small implicit transaction, there is no
    transaction.atomic() wrapping the loop.
    """

    def post(self, request, id):
        drawing = get_object_or_404(Drawing, id=id)
        body = DrawingOcrRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        page = body.validated_data.get("page")
        force = body.validated_data.get("force", False)

        queryset = Annotation.objects.filter(drawing=drawing, type=Annotation.CAPTURE)
        if page is not None:
            get_object_or_404(Page, drawing=drawing, page_number=page)
            queryset = queryset.filter(page_number=page)
        queryset = queryset.order_by("page_number", "created_at")

        counts = {"processed": 0, "skipped": 0, "empty": 0, "failed": 0}
        touched = []

        for annotation in queryset:
            touched.append(annotation)

            already_done_and_current = (
                annotation.ocr_status == Annotation.DONE
                and annotation.ocr_ran_at is not None
                and annotation.geometry_updated_at is not None
                and annotation.ocr_ran_at >= annotation.geometry_updated_at
            )
            if not force and already_done_and_current:
                counts["skipped"] += 1
                continue

            try:
                result = run_ocr_on_annotation(annotation)
            except (OcrError, NotImplementedError) as err:
                logger.warning("OCR failed for annotation %s: %s", annotation.id, err)
                annotation.ocr_status = Annotation.FAILED
                annotation.ocr_ran_at = timezone.now()
                # ocr_text is deliberately left untouched: "failure keeps
                # prior text" per SPEC.md.
                annotation.save(update_fields=["ocr_status", "ocr_ran_at"])
                counts["failed"] += 1
                continue

            annotation.ocr_confidence = result.confidence
            annotation.ocr_engine = result.engine
            annotation.ocr_ran_at = timezone.now()
            if result.text and result.text.strip():
                annotation.ocr_status = Annotation.DONE
                annotation.ocr_text = result.text
                counts["processed"] += 1
            else:
                annotation.ocr_status = Annotation.EMPTY
                annotation.ocr_text = result.text or ""
                counts["empty"] += 1
            annotation.save(
                update_fields=["ocr_status", "ocr_text", "ocr_confidence", "ocr_engine", "ocr_ran_at"]
            )

        return Response(
            {**counts, "annotations": AnnotationSerializer(touched, many=True).data},
            status=status.HTTP_200_OK,
        )


class DrawingEstimateView(APIView):
    """POST /api/drawings/<uuid:id>/estimate/ — gather OCR text from every
    `capture` annotation, call the (stubbed) structuring model, price the
    result against the UnitPrice catalog, and persist an EstimateRun."""

    # Bounds the payload sent onward; estimating.py is responsible for its
    # own deterministic chunking if a single call still needs splitting.
    MAX_OCR_TEXT_CHARS = 200_000

    def post(self, request, id):
        drawing = get_object_or_404(Drawing, id=id)
        body = DrawingEstimateRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        waste_pct = body.validated_data["waste_pct"]
        markup_pct = body.validated_data["markup_pct"]

        # Selected on "has usable text", NOT on ocr_status == DONE.
        # A PATCH that sets ocr_text by hand does not change ocr_status, so
        # gating on DONE silently dropped exactly the annotations a user had
        # just corrected by hand (status stays `empty`/`failed` while the
        # text is now correct) — their correction wouldn't count, with no
        # error shown anywhere. Text presence is the thing we actually need.
        annotations = (
            Annotation.objects.filter(drawing=drawing, type=Annotation.CAPTURE)
            .exclude(ocr_text__isnull=True)
            .exclude(ocr_text__exact="")
            .order_by("page_number", "created_at")
        )

        if not annotations.exists():
            return Response(
                {
                    "error": (
                        "No OCR'd capture annotations found for this drawing. "
                        "Run OCR first: POST /api/drawings/<id>/ocr/."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        page_by_annotation_id: dict[str, int] = {}
        annotation_by_id: dict[str, Annotation] = {}
        payload = []
        total_chars = 0
        for annotation in annotations:
            text = (annotation.ocr_text or "").strip()
            if not text:
                continue
            annotation_id = str(annotation.id)
            page_by_annotation_id[annotation_id] = annotation.page_number
            annotation_by_id[annotation_id] = annotation
            total_chars += len(text)
            payload.append({"annotation_id": annotation_id, "page_number": annotation.page_number, "ocr_text": text})

        if not payload:
            return Response(
                {
                    "error": (
                        "No captured text found for this drawing. "
                        "Run OCR first: POST /api/drawings/<id>/ocr/."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Actually enforce the cap. estimating.py chunks at 20k chars and
        # calls the model once per chunk, sequentially and synchronously,
        # each with its own retry/backoff — so an unbounded payload turns
        # one POST into an unbounded series of network calls inside a single
        # request. SPEC requires this endpoint stay bounded; a log line is
        # not a bound.
        if total_chars > self.MAX_OCR_TEXT_CHARS:
            logger.warning(
                "Estimate payload for drawing %s is %d chars, over the %d cap — rejected.",
                drawing.id,
                total_chars,
                self.MAX_OCR_TEXT_CHARS,
            )
            return Response(
                {
                    "error": (
                        f"This drawing has {total_chars:,} characters of captured text, over the "
                        f"{self.MAX_OCR_TEXT_CHARS:,} character limit for a single estimate. "
                        "Reduce the number or size of capture rectangles and try again."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            extraction = extract_line_items(payload)
        except ExtractionUnavailable as err:
            return Response(
                {"error": str(err) or "AI estimating is not configured on this server (missing API key)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except NotImplementedError:
            # estimating.py is a stub until ocr-integration-engineer lands
            # the real Gemini call — surface the same shape a real
            # ExtractionUnavailable would, never a raw 500.
            return Response(
                {"error": "AI estimating is not implemented yet on this server."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except ExtractionError:
            # Never leak the underlying error (which could echo API
            # response internals) to the client — log server-side only.
            logger.exception("Estimate extraction failed for drawing %s", drawing.id)
            return Response(
                {"error": "Estimate generation failed. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        try:
            with transaction.atomic():
                run = EstimateRun.objects.create(
                    drawing=drawing,
                    status=EstimateRun.RUNNING,
                    model_name=extraction.model_name,
                    summary=extraction.summary,
                    waste_pct=waste_pct,
                    markup_pct=markup_pct,
                    prompt_tokens=extraction.prompt_tokens,
                    output_tokens=extraction.output_tokens,
                )

                line_totals = []
                line_items = []
                for item in extraction.items:
                    priced = price_extracted_item(item)
                    line_totals.append(priced["line_total"])

                    annotation_obj = None
                    page_number = 0
                    if item.annotation_id:
                        page_number = page_by_annotation_id.get(item.annotation_id, 0)
                        # Looked up from the dict built above rather than one
                        # query per line item (N+1).
                        annotation_obj = annotation_by_id.get(item.annotation_id)

                    line_items.append(
                        EstimateLineItem(run=run, annotation=annotation_obj, page_number=page_number, **priced)
                    )

                EstimateLineItem.objects.bulk_create(line_items)

                totals = compute_totals(line_totals, waste_pct, markup_pct)
                run.subtotal = totals.subtotal
                run.waste_amount = totals.waste_amount
                run.markup_amount = totals.markup_amount
                run.total = totals.total
                run.status = EstimateRun.COMPLETE
                run.completed_at = timezone.now()
                run.save()
        except DatabaseError:
            # The atomic block has rolled back, taking the EstimateRun row
            # with it — so without this, a genuinely failed run would leave
            # no record at all and the FAILED status/error_message fields
            # would be unreachable dead code. Persist a failure record
            # OUTSIDE the rolled-back transaction so the run is diagnosable.
            logger.exception("Persisting estimate for drawing %s failed", drawing.id)
            EstimateRun.objects.create(
                drawing=drawing,
                status=EstimateRun.FAILED,
                model_name=extraction.model_name,
                summary="",
                waste_pct=waste_pct,
                markup_pct=markup_pct,
                error_message="Could not save the generated estimate. See server logs for details.",
            )
            return Response(
                {"error": "Estimate generation failed while saving. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        run.refresh_from_db()
        return Response(EstimateRunSerializer(run).data, status=status.HTTP_201_CREATED)


class DrawingEstimateListView(APIView):
    def get(self, request, id):
        drawing = get_object_or_404(Drawing, id=id)
        runs = EstimateRun.objects.filter(drawing=drawing).order_by("-created_at")
        return Response(EstimateRunListSerializer(runs, many=True).data)


class EstimateDetailView(APIView):
    def get(self, request, id):
        run = get_object_or_404(EstimateRun, id=id)
        return Response(EstimateRunSerializer(run).data)


def _csv_safe(value) -> str:
    """Neutralize CSV/formula injection: a cell whose text starts with
    `= + - @` or a tab/CR is prefixed with `'` so spreadsheet apps treat it
    as literal text instead of evaluating it as a formula.

    The dangerous prefix is looked for after stripping leading whitespace,
    because some spreadsheet apps do the same before deciding whether a
    cell is a formula — so a payload like " =1+1" must be caught too. The
    original text is returned unmodified apart from the quote prefix.
    """
    text = "" if value is None else str(value)
    if text.lstrip().startswith(_CSV_INJECTION_PREFIXES):
        return "'" + text
    return text


def _safe_filename_component(text: str) -> str:
    return "".join(ch if (ch.isalnum() or ch in "-_") else "-" for ch in text)[:80]


class EstimateExportCsvView(APIView):
    def get(self, request, id):
        run = get_object_or_404(EstimateRun, id=id)
        line_items = run.line_items.select_related("unit_price").order_by("page_number", "category", "description")

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "page_number",
                "category",
                "description",
                "quantity",
                "unit",
                "unit_price_code",
                "unit_cost",
                "line_total",
                "match_method",
                "confidence",
                "match_confidence",
                "needs_review",
                "raw_text",
            ]
        )
        for item in line_items:
            writer.writerow(
                [
                    _csv_safe(item.page_number),
                    _csv_safe(item.category),
                    _csv_safe(item.description),
                    _csv_safe(item.quantity),
                    _csv_safe(item.unit),
                    _csv_safe(item.unit_price.code if item.unit_price_id else ""),
                    _csv_safe(item.unit_cost),
                    _csv_safe(item.line_total),
                    _csv_safe(item.match_method),
                    _csv_safe(item.confidence),
                    _csv_safe(item.match_confidence),
                    _csv_safe("yes" if item.needs_review else "no"),
                    _csv_safe(item.raw_text),
                ]
            )
        writer.writerow([])
        writer.writerow(["", "", "", "", "", "", "Subtotal", _csv_safe(run.subtotal)])
        writer.writerow(["", "", "", "", "", "", f"Waste ({run.waste_pct}%)", _csv_safe(run.waste_amount)])
        writer.writerow(["", "", "", "", "", "", f"Markup ({run.markup_pct}%)", _csv_safe(run.markup_amount)])
        writer.writerow(["", "", "", "", "", "", "Total", _csv_safe(run.total)])
        writer.writerow([])
        writer.writerow(["AI-generated draft — verify before bidding."])

        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        filename = f"estimate-{_safe_filename_component(run.drawing.name)}-{run.id}.csv"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class EstimateReportView(APIView):
    """GET /api/estimates/<uuid:id>/report/ — printable HTML report.
    Deliberately no weasyprint/reportlab (SPEC.md): print-to-PDF from the
    browser covers this without a painful Windows dependency."""

    def get(self, request, id):
        run = get_object_or_404(EstimateRun, id=id)
        items = list(
            run.line_items.select_related("unit_price", "annotation").order_by(
                "page_number", "category", "description"
            )
        )

        pages: dict[int, list] = {}
        for item in items:
            pages.setdefault(item.page_number, []).append(item)

        context = {
            "run": run,
            "drawing": run.drawing,
            "pages": sorted(pages.items()),
            "unmatched_count": sum(1 for item in items if item.match_method == EstimateLineItem.UNMATCHED),
            "needs_review_count": sum(1 for item in items if item.needs_review),
            "generated_at": timezone.now(),
        }
        return render(request, "drawings/estimate_report.html", context)


class UnitPriceListView(APIView):
    def get(self, request):
        unit_prices = UnitPrice.objects.all().order_by("category", "code")
        return Response(UnitPriceSerializer(unit_prices, many=True).data)


class UnitPriceDetailView(APIView):
    def patch(self, request, id):
        unit_price = get_object_or_404(UnitPrice, id=id)
        serializer = UnitPriceSerializer(unit_price, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class UnitPriceImportView(APIView):
    """POST /api/unit-prices/import/ — multipart CSV upsert by `code`.

    Every row is validated independently; a bad row is reported (not
    raised), so one typo doesn't abort the whole batch. Never `eval`s
    anything — costs are parsed with `Decimal`, nothing else.
    """

    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            return Response({"error": "Missing multipart file field 'file'."}, status=status.HTTP_400_BAD_REQUEST)

        if uploaded_file.size > CSV_IMPORT_MAX_BYTES:
            return Response(
                {"error": f"File too large — max {CSV_IMPORT_MAX_BYTES // (1024 * 1024)}MB."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            raw_text = uploaded_file.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            return Response({"error": "File must be UTF-8 encoded CSV."}, status=status.HTTP_400_BAD_REQUEST)

        reader = csv.DictReader(io.StringIO(raw_text))
        if not reader.fieldnames:
            return Response({"error": "CSV has no header row."}, status=status.HTTP_400_BAD_REQUEST)

        normalized_fieldnames = {(name or "").strip().lower() for name in reader.fieldnames}
        required_fieldnames = {"code", "description", "category", "unit", "unit_cost"}
        missing = required_fieldnames - normalized_fieldnames
        if missing:
            return Response(
                {"error": f"CSV is missing required column(s): {', '.join(sorted(missing))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rows = list(reader)
        if len(rows) > CSV_IMPORT_MAX_ROWS:
            return Response(
                {"error": f"CSV has {len(rows)} data rows — max {CSV_IMPORT_MAX_ROWS} per import."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created = 0
        updated = 0
        errors = []

        with transaction.atomic():
            for index, row in enumerate(rows, start=1):
                normalized_row = {
                    (key or "").strip().lower(): (value or "").strip()
                    for key, value in row.items()
                    if key is not None
                }
                if "unit" in normalized_row:
                    normalized_row["unit"] = normalized_row["unit"].upper()

                row_serializer = UnitPriceCsvRowSerializer(data=normalized_row)
                if not row_serializer.is_valid():
                    messages = [
                        f"{field}: {'; '.join(str(e) for e in field_errors)}"
                        for field, field_errors in row_serializer.errors.items()
                    ]
                    errors.append({"row": index, "message": "; ".join(messages)})
                    continue

                data = row_serializer.validated_data
                _, was_created = UnitPrice.objects.update_or_create(
                    code=data["code"],
                    defaults={
                        "description": data["description"],
                        "category": data["category"],
                        "unit": data["unit"],
                        "unit_cost": data["unit_cost"],
                        "keywords": data.get("keywords", ""),
                        "source": UnitPrice.CSV,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

        return Response({"created": created, "updated": updated, "errors": errors}, status=status.HTTP_200_OK)


class UnitPriceTemplateCsvView(APIView):
    def get(self, request):
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(UNIT_PRICE_CSV_FIELDS)
        writer.writerow(
            ["09250-1", '1/2" drywall, hung/taped/sanded, painted', "drywall", "SF", "3.25", "drywall gypsum board wall"]
        )
        writer.writerow(
            ["03300-1", "Cast-in-place concrete, footings", "concrete", "CY", "310.0000", "concrete footing foundation"]
        )
        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="unit_price_template.csv"'
        return response
