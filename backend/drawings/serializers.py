import os

from rest_framework import serializers

from .models import Annotation, Drawing, Page

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
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "drawing_id", "page_number", "created_at", "updated_at"]

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
