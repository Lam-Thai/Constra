import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Drawing(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    page_count = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Page(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    drawing = models.ForeignKey(Drawing, on_delete=models.CASCADE, related_name="pages")
    page_number = models.PositiveIntegerField()
    image_url = models.CharField(max_length=500)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()

    class Meta:
        unique_together = ("drawing", "page_number")
        ordering = ["page_number"]

    def __str__(self):
        return f"{self.drawing.name} p{self.page_number}"


class Annotation(models.Model):
    IGNORE, CAPTURE = "ignore", "capture"
    TYPE_CHOICES = [(IGNORE, "Ignore"), (CAPTURE, "Capture")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    drawing = models.ForeignKey(Drawing, on_delete=models.CASCADE, related_name="annotations")
    page_number = models.PositiveIntegerField()
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    # normalized 0..1 relative to page width/height — resolution independent,
    # see canvas-annotation-overlay skill for why this matters on the frontend
    x = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    y = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    width = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    height = models.FloatField(validators=[MinValueValidator(0), MaxValueValidator(1)])
    ocr_text = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["drawing", "page_number"])]

    def __str__(self):
        return f"{self.type} on {self.drawing.name} p{self.page_number}"
