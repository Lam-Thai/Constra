import os
from decimal import Decimal, InvalidOperation

from django.utils import timezone
from rest_framework import serializers

from .models import Annotation, Drawing, EstimateLineItem, EstimateRun, Page, UnitPrice

ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
ALLOWED_UPLOAD_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
}


class PageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Page
        fields = ["page_number", "image_url", "width", "height"]


class DrawingListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Drawing
        fields = ["id", "name", "page_count"]


class DrawingDetailSerializer(serializers.ModelSerializer):
    pages = PageSerializer(many=True, read_only=True)

    class Meta:
        model = Drawing
        fields = ["id", "name", "page_count", "created_at", "pages"]


class DrawingUploadSerializer(serializers.Serializer):
    """Not a ModelSerializer — `file` isn't a Drawing field, it's the
    source the Drawing + Page row(s) get derived from (see services.py)."""

    name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    file = serializers.FileField()

    def validate_file(self, value):
        ext = os.path.splitext(value.name or "")[1].lower()
        if ext not in ALLOWED_UPLOAD_EXTENSIONS:
            allowed = ", ".join(sorted(ALLOWED_UPLOAD_EXTENSIONS))
            raise serializers.ValidationError(
                f"Unsupported file extension '{ext or '(none)'}'. Allowed: {allowed}"
            )
        content_type = getattr(value, "content_type", None)
        if content_type and content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
            allowed = ", ".join(sorted(ALLOWED_UPLOAD_CONTENT_TYPES))
            raise serializers.ValidationError(
                f"Unsupported content type '{content_type}'. Allowed: {allowed}"
            )
        return value

    def validate(self, data):
        name = (data.get("name") or "").strip()
        if not name:
            base = os.path.splitext(data["file"].name or "")[0].strip()
            name = base or "untitled-drawing"
        data["name"] = name[:255]
        return data


class AnnotationSerializer(serializers.ModelSerializer):
    # FK columns expose "<field>_id" on the model instance automatically;
    # reading it directly gives us the plain UUID without a nested object.
    drawing_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Annotation
        fields = [
            "id",
            "drawing_id",
            "page_number",
            "type",
            "x",
            "y",
            "width",
            "height",
            "ocr_text",
            "ocr_status",
            "ocr_confidence",
            "ocr_ran_at",
            "ocr_engine",
            "created_at",
            "updated_at",
        ]
        # ocr_text stays writable — a hand correction via PATCH must be
        # possible (SPEC.md). The rest of the ocr_* fields are provenance
        # written only by the OCR orchestration view, never client input.
        read_only_fields = [
            "id",
            "drawing_id",
            "page_number",
            "ocr_status",
            "ocr_confidence",
            "ocr_ran_at",
            "ocr_engine",
            "created_at",
            "updated_at",
        ]

    def validate(self, data):
        x = data.get("x", getattr(self.instance, "x", None))
        y = data.get("y", getattr(self.instance, "y", None))
        w = data.get("width", getattr(self.instance, "width", None))
        h = data.get("height", getattr(self.instance, "height", None))
        if x is not None and w is not None and x + w > 1:
            raise serializers.ValidationError("x + width must be <= 1")
        if y is not None and h is not None and y + h > 1:
            raise serializers.ValidationError("y + height must be <= 1")
        return data

    _GEOMETRY_FIELDS = ("x", "y", "width", "height")

    def create(self, validated_data):
        instance = super().create(validated_data)
        # New annotation: its geometry was "last changed" at creation, so a
        # subsequent OCR run has something to compare against.
        instance.geometry_updated_at = instance.created_at
        instance.save(update_fields=["geometry_updated_at"])
        return instance

    def update(self, instance, validated_data):
        geometry_changed = any(
            field in validated_data and validated_data[field] != getattr(instance, field)
            for field in self._GEOMETRY_FIELDS
        )
        instance = super().update(instance, validated_data)
        if geometry_changed:
            # Only a real move/resize invalidates a prior OCR result — a
            # hand-corrected `ocr_text` PATCH must not trip this, otherwise
            # the next non-forced OCR run would silently overwrite the
            # user's correction (SPEC.md).
            instance.geometry_updated_at = timezone.now()
            instance.save(update_fields=["geometry_updated_at"])
        return instance


class DrawingOcrRequestSerializer(serializers.Serializer):
    """Body for POST /api/drawings/<id>/ocr/."""

    page = serializers.IntegerField(required=False, allow_null=True, min_value=1, default=None)
    force = serializers.BooleanField(required=False, default=False)


class DrawingEstimateRequestSerializer(serializers.Serializer):
    """Body for POST /api/drawings/<id>/estimate/. Percent inputs, not
    fractions — e.g. 10 means 10%."""

    waste_pct = serializers.DecimalField(max_digits=6, decimal_places=3, required=False, default=Decimal("0"))
    markup_pct = serializers.DecimalField(max_digits=6, decimal_places=3, required=False, default=Decimal("0"))

    def validate_waste_pct(self, value):
        if value < 0 or value > 100:
            raise serializers.ValidationError("waste_pct must be between 0 and 100")
        return value

    def validate_markup_pct(self, value):
        if value < 0 or value > 100:
            raise serializers.ValidationError("markup_pct must be between 0 and 100")
        return value


class UnitPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = UnitPrice
        fields = [
            "id",
            "code",
            "description",
            "category",
            "unit",
            "unit_cost",
            "keywords",
            "source",
            "updated_at",
        ]
        # `source` is provenance ("seed" vs "csv"), set by the seed command
        # / CSV import respectively — not something a PATCH should be able
        # to spoof.
        read_only_fields = ["id", "source", "updated_at"]

    def validate_unit_cost(self, value):
        if value < 0:
            raise serializers.ValidationError("unit_cost must be >= 0")
        return value

    def validate_code(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("code is required")
        return value


class EstimateLineItemSerializer(serializers.ModelSerializer):
    # `default=None` (not just allow_null) is required here: these fields
    # are read-only with a dotted `source`, so when `annotation`/`unit_price`
    # is None, DRF's attribute lookup raises AttributeError; without an
    # explicit default it treats that as SkipField and omits the key
    # entirely instead of emitting `null`, which would make "no match"
    # indistinguishable from "field missing" to a client.
    annotation_id = serializers.UUIDField(source="annotation.id", read_only=True, allow_null=True, default=None)
    unit_price_id = serializers.UUIDField(source="unit_price.id", read_only=True, allow_null=True, default=None)
    unit_price_code = serializers.CharField(source="unit_price.code", read_only=True, allow_null=True, default=None)

    class Meta:
        model = EstimateLineItem
        fields = [
            "id",
            "annotation_id",
            "page_number",
            "description",
            "category",
            "quantity",
            "unit",
            "unit_price_id",
            "unit_price_code",
            "unit_cost",
            "line_total",
            "confidence",
            "match_confidence",
            "needs_review",
            "match_method",
            "raw_text",
        ]
        read_only_fields = fields


class EstimateRunSerializer(serializers.ModelSerializer):
    line_items = EstimateLineItemSerializer(many=True, read_only=True)
    drawing_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = EstimateRun
        fields = [
            "id",
            "drawing_id",
            "status",
            "model_name",
            "summary",
            "currency",
            "waste_pct",
            "markup_pct",
            "subtotal",
            "waste_amount",
            "markup_amount",
            "total",
            "prompt_tokens",
            "output_tokens",
            "error_message",
            "created_at",
            "completed_at",
            "line_items",
        ]
        read_only_fields = fields


class EstimateRunListSerializer(serializers.ModelSerializer):
    """Lighter-weight shape for the list endpoint — omits nested
    line_items so listing a drawing's estimate history stays cheap."""

    drawing_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = EstimateRun
        fields = [
            "id",
            "drawing_id",
            "status",
            "model_name",
            "currency",
            "waste_pct",
            "markup_pct",
            "subtotal",
            "waste_amount",
            "markup_amount",
            "total",
            "created_at",
            "completed_at",
        ]
        read_only_fields = fields


UNIT_PRICE_CSV_FIELDS = ["code", "description", "category", "unit", "unit_cost", "keywords"]
VALID_UNITS = {choice[0] for choice in UnitPrice.UNIT_CHOICES}


class UnitPriceCsvRowSerializer(serializers.Serializer):
    """Validates a single parsed CSV row for the unit-price import
    endpoint. Kept separate from UnitPriceSerializer because CSV rows are
    all-strings and need their own coercion/error messages per SPEC.md's
    'row-level error reporting' requirement."""

    code = serializers.CharField(max_length=64)
    description = serializers.CharField(max_length=500)
    category = serializers.CharField(max_length=100)
    unit = serializers.ChoiceField(choices=sorted(VALID_UNITS))
    # DecimalField (not CharField + a hand-rolled Decimal() parse) so the
    # digit/precision bounds of UnitPrice.unit_cost are enforced during row
    # validation. The hand-rolled version only checked "parses and >= 0", so
    # an out-of-range value passed validation and then raised an uncaught
    # DataError inside the import view's atomic block — rolling back the
    # WHOLE import with a 500, which contradicts this endpoint's documented
    # promise that one bad row is reported, not fatal.
    unit_cost = serializers.DecimalField(
        max_digits=12,
        decimal_places=4,
        min_value=Decimal("0"),
        error_messages={
            "max_digits": "unit_cost has too many digits (max 12 total).",
            "max_decimal_places": "unit_cost has too many decimal places (max 4).",
            "max_whole_digits": "unit_cost is too large (max 8 digits before the decimal point).",
            "min_value": "unit_cost must be >= 0",
            "invalid": "unit_cost is not a valid number",
        },
    )
    keywords = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_code(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("code is required")
        return value


