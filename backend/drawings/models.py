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

    # --- OCR provenance (Increment 1) ---
    PENDING, DONE, EMPTY, FAILED = "pending", "done", "empty", "failed"
    OCR_STATUS_CHOICES = [
        (PENDING, "Pending"),
        (DONE, "Done"),
        (EMPTY, "Empty"),
        (FAILED, "Failed"),
    ]
    ocr_status = models.CharField(max_length=16, choices=OCR_STATUS_CHOICES, null=True, blank=True)
    ocr_confidence = models.FloatField(null=True, blank=True)
    ocr_ran_at = models.DateTimeField(null=True, blank=True)
    ocr_engine = models.CharField(max_length=64, null=True, blank=True)
    # Bumped only when x/y/width/height actually change (see
    # AnnotationSerializer.update) — deliberately NOT the same as
    # `updated_at`, which also bumps on a hand-corrected `ocr_text` PATCH.
    # The OCR idempotency check needs to tell "geometry moved, re-OCR" apart
    # from "user corrected the text, don't silently re-OCR over it" — see
    # SPEC.md Increment 1's idempotency + hand-correction rules, which are
    # only both satisfiable with a geometry-specific timestamp.
    geometry_updated_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["drawing", "page_number"])]

    def __str__(self):
        return f"{self.type} on {self.drawing.name} p{self.page_number}"


class UnitPrice(models.Model):
    """Catalog rate used to price extracted line items. Seeded via the
    `seed_unit_prices` management command, editable in place, or upserted
    in bulk via the CSV import endpoint."""

    SEED, CSV = "seed", "csv"
    SOURCE_CHOICES = [(SEED, "Seed"), (CSV, "CSV")]

    UNIT_CHOICES = [
        ("SF", "Square Foot"),
        ("LF", "Linear Foot"),
        ("EA", "Each"),
        ("CY", "Cubic Yard"),
        ("SY", "Square Yard"),
        ("HR", "Hour"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=64, unique=True)
    description = models.CharField(max_length=500)
    category = models.CharField(max_length=100)
    unit = models.CharField(max_length=8, choices=UNIT_CHOICES)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    # Comma/space separated keywords used by the keyword-match fallback in
    # the pricing engine (see pricing.py) — kept as free text, not FK/M2M,
    # since it's just a matching aid, not a normalized relationship.
    keywords = models.TextField(blank=True, default="")
    source = models.CharField(max_length=8, choices=SOURCE_CHOICES, default=CSV)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "code"]

    def __str__(self):
        return f"{self.code} — {self.description}"


class EstimateRun(models.Model):
    """One AI-assisted takeoff → estimate pass over a whole drawing."""

    RUNNING, COMPLETE, FAILED = "running", "complete", "failed"
    STATUS_CHOICES = [(RUNNING, "Running"), (COMPLETE, "Complete"), (FAILED, "Failed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    drawing = models.ForeignKey(Drawing, on_delete=models.CASCADE, related_name="estimate_runs")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=RUNNING)
    model_name = models.CharField(max_length=128, blank=True, default="")
    summary = models.TextField(blank=True, default="")
    currency = models.CharField(max_length=8, default="CAD")

    # Inputs, snapshotted at run time so a later change to defaults doesn't
    # retroactively alter a past run's totals.
    waste_pct = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    markup_pct = models.DecimalField(max_digits=6, decimal_places=3, default=0)

    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    waste_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    markup_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    prompt_tokens = models.PositiveIntegerField(null=True, blank=True)
    output_tokens = models.PositiveIntegerField(null=True, blank=True)
    error_message = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Estimate {self.id} for {self.drawing.name} ({self.status})"


class EstimateLineItem(models.Model):
    # WEAK: a keyword match found *some* overlap but not enough to trust
    # without a human looking at it -- still priced and shown (never
    # silently dropped), just flagged. See pricing.py for the exact bar
    # that separates KEYWORD (high-confidence) from WEAK.
    EXACT, KEYWORD, WEAK, UNMATCHED = "exact", "keyword", "weak", "unmatched"
    MATCH_METHOD_CHOICES = [
        (EXACT, "Exact"),
        (KEYWORD, "Keyword"),
        (WEAK, "Weak"),
        (UNMATCHED, "Unmatched"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(EstimateRun, on_delete=models.CASCADE, related_name="line_items")
    # SET_NULL (not CASCADE): a line item is a durable estimate record: it
    # must survive its source annotation being deleted later — only the
    # provenance link is lost, not the priced line itself.
    annotation = models.ForeignKey(
        Annotation, on_delete=models.SET_NULL, null=True, blank=True, related_name="estimate_line_items"
    )
    # Denormalized so the report keeps meaning even if `annotation` is null.
    page_number = models.PositiveIntegerField()

    description = models.CharField(max_length=500)
    category = models.CharField(max_length=100)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit = models.CharField(max_length=8)

    unit_price = models.ForeignKey(
        UnitPrice, on_delete=models.SET_NULL, null=True, blank=True, related_name="line_items"
    )
    # Snapshot, copied at run time — see money rules in SPEC.md. Editing the
    # catalog later must never silently rewrite a past estimate's cost.
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)

    # Extraction confidence: how confident Gemini was that it *read the
    # source text correctly* -- says nothing about whether the catalog
    # match is right. Kept as `confidence` for backward compatibility with
    # the original field name.
    confidence = models.DecimalField(max_digits=4, decimal_places=3, default=0)
    # Match confidence: a SEPARATE value for how confident the pricing
    # engine is that the matched UnitPrice row (if any) is actually the
    # right one. These two numbers answer different questions ("did I
    # misread the drawing?" vs "do I know what this costs?") and must
    # never be conflated -- see pricing.py.
    match_confidence = models.DecimalField(max_digits=4, decimal_places=3, default=0)
    needs_review = models.BooleanField(default=False)
    match_method = models.CharField(max_length=16, choices=MATCH_METHOD_CHOICES)
    raw_text = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["page_number", "category", "description"]

    def __str__(self):
        return f"{self.description} x{self.quantity}{self.unit}"
