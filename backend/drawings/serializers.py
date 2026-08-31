from rest_framework import serializers

from .models import Annotation, Drawing, Page


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
