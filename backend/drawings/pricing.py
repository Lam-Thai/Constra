"""Pricing/matching engine: turns `ExtractedLineItem`s (from
estimating.py) into priced `EstimateLineItem` field-dicts against the
`UnitPrice` catalog, and computes run-level totals.

Decimal math only, ROUND_HALF_UP, never float for money (SPEC.md).

SAFETY-CRITICAL RULES (added after a real bug: "ENTRY 30.6 SF" was
keyword-matched to an "EA" exterior-door catalog row and priced as
$35,190 of pure fiction):

  1. UNIT COMPATIBILITY IS A HARD PRECONDITION. A catalog row whose `unit`
     differs from the extracted item's `unit` is never a valid match --
     not for exact-code, not for keyword, no exception. SF and EA are not
     "close enough"; no description similarity makes an incompatible unit
     pairing valid. The candidate pool is filtered to unit-compatible rows
     BEFORE any text matching happens, so an exact-code hit against the
     wrong unit is architecturally impossible, not just discouraged.
  2. A single common/generic token is NEVER sufficient for a trusted
     match. Generic construction-report boilerplate (see _GENERIC_TERMS)
     is stripped before scoring, and a real match additionally requires
     both a minimum token-overlap count AND a minimum coverage ratio.
     Anything weaker than that bar is still applied (never silently
     dropped) but flagged WEAK + needs_review=True.
  3. Extraction confidence (how well the OCR text was read) and match
     confidence (how sure the pricing engine is about the catalog row) are
     two different numbers, tracked separately -- see `match_confidence`
     on EstimateLineItem. `needs_review` is True whenever EITHER is not
     high, and in particular whenever the match is anything less than an
     exact, unit-compatible hit.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from .estimating import ExtractedLineItem
from .models import EstimateLineItem, UnitPrice

logger = logging.getLogger(__name__)

TWO_PLACES = Decimal("0.01")

# Common filler words stripped before keyword-overlap scoring so they don't
# inflate matches between unrelated line items (e.g. every description
# contains "and"/"of").
_STOPWORDS = {
    "a", "an", "and", "the", "of", "for", "with", "to", "in", "on", "per",
    "each", "at",
}

# Construction-report boilerplate that appears across MANY catalog rows and
# therefore carries almost no discriminating signal on its own. Real bug
# report: "ENTRY" (a floor-plan area-table label meaning "entryway floor
# area", unit SF) keyword-matched an "Exterior entry door" catalog row
# (unit EA) on the single word "entry" alone. These words must never be
# allowed to carry a match by themselves -- they are filtered out of BOTH
# sides before scoring, same as stopwords, just domain-specific ones.
_GENERIC_TERMS = {
    "entry", "new", "existing", "total", "area", "wall", "walls",
    "general", "misc", "miscellaneous", "item", "items", "work",
    "material", "materials", "other", "additional", "typical", "standard",
    "supply", "install", "installed", "installation", "provide",
    "furnish", "furnished", "room", "unit", "units",
}

# A match at or above this confidence is trusted enough not to demand a
# human look. Deliberately NOT "only EXACT clears review": an EXACT match
# requires a catalog code (e.g. "09250-1") to appear verbatim in the OCR
# text, and real drawings never cite a contractor's private price-book
# codes -- so gating on EXACT alone would flag 100% of real line items and
# the flag would carry no information at all. A high-coverage keyword match
# is genuinely trustworthy; a low-coverage one is not. That distinction is
# the whole value of the flag.
_AUTO_CLEAR_MATCH_CONFIDENCE = Decimal("0.800")
# Extraction confidence below this means the model wasn't sure it read the
# drawing correctly, which warrants review no matter how good the match is.
_MIN_EXTRACTION_CONFIDENCE = Decimal("0.500")

# A keyword match needs at least this many overlapping *meaningful* tokens
_STRONG_MIN_OVERLAP_TOKENS = 2
# ...AND the overlap must cover at least this fraction of the smaller
# side's meaningful tokens, so a big bag of words matching on 2-out-of-40
# tokens by chance does not count as strong either.
_STRONG_MIN_COVERAGE = 0.5


# EstimateLineItem.quantity is NUMERIC(12,3) and line_total is
# NUMERIC(14,2). OCR text is untrusted, frequently garbled input -- a
# misread dimension string can plausibly produce an absurd number. Left
# unbounded it reaches Postgres and raises DataError mid-write, which
# (inside the estimate run's atomic block) would roll back every other
# correctly-priced line item and surface as a raw 500. Bound it here so a
# single bad quantity costs one flagged line, never the whole estimate.
MAX_QUANTITY = Decimal("999999999.999")
MAX_LINE_TOTAL = Decimal("999999999999.99")


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def _quantity_is_representable(quantity: Decimal) -> bool:
    """True if `quantity` fits the DB column and isn't NaN/Infinity."""
    if not quantity.is_finite():
        return False
    return abs(quantity) <= MAX_QUANTITY


def _quantize_confidence(value: float) -> Decimal:
    clamped = max(0.0, min(1.0, value))
    return Decimal(str(round(clamped, 3)))


def normalize_text(text: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace."""
    text = (text or "").lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_unit(unit: str) -> str:
    return (unit or "").strip().upper()


def tokenize(text: str, *, strip_generic: bool = False) -> set[str]:
    """Tokenize `text`, always dropping stopwords. When `strip_generic` is
    set, also drop `_GENERIC_TERMS` -- used for match-strength scoring
    (never for the exact-code substring check, which does not use this)."""
    normalized = normalize_text(text)
    excluded = _STOPWORDS | _GENERIC_TERMS if strip_generic else _STOPWORDS
    return {word for word in normalized.split(" ") if word and word not in excluded}


@dataclass
class MatchResult:
    unit_price: UnitPrice | None
    match_method: str  # EstimateLineItem.EXACT / .KEYWORD / .WEAK / .UNMATCHED
    match_confidence: Decimal  # separate from extraction confidence -- see module docstring


_NO_MATCH = MatchResult(None, EstimateLineItem.UNMATCHED, Decimal("0.000"))


def match_unit_price(description: str, raw_text: str = "", category: str = "", unit: str = "") -> MatchResult:
    """Match an extracted line item's text against the `UnitPrice` catalog.

    Strategy, in order, ALL operating only within the unit-compatible
    subset of the catalog:
      0. Unit compatibility (hard precondition). The candidate pool is
         `UnitPrice` rows whose `unit` equals the item's `unit`
         (case-insensitive). A code or keyword hit against a
         unit-incompatible row is not considered at all -- it cannot ever
         surface as a match, exact or otherwise.
      1. Exact code match -- the item's own description/raw text contains
         a unit-compatible catalog `code` as a whole token.
      2. Strong keyword match -- after stripping stopwords AND generic
         boilerplate terms from both sides, score every remaining
         unit-compatible row by token overlap; a match counts as "strong"
         only with >= 2 overlapping meaningful tokens AND >= 50% coverage
         of the smaller side. `match_confidence` is set from the coverage
         ratio (capped below 1.0, which is reserved for EXACT).
      3. Weak keyword match -- any nonzero overlap that does not clear the
         strong bar. Still applied (never dropped), lower
         `match_confidence`, and the caller must flag `needs_review`.
      4. Unmatched -- no unit-compatible row has any meaningful overlap, or
         no unit-compatible row exists at all.
    """
    unit_normalized = normalize_unit(unit)
    catalog = (
        [unit_price for unit_price in UnitPrice.objects.all() if normalize_unit(unit_price.unit) == unit_normalized]
        if unit_normalized
        else []
    )

    if not catalog:
        # No unit-compatible candidate exists at all (either the item had
        # no usable unit, or nothing in the catalog shares it) -- there is
        # nothing safe to match against, full stop.
        return _NO_MATCH

    combined_text = normalize_text(f"{description} {raw_text} {category}")

    # 1. Exact code match, restricted to the unit-compatible pool. A code
    # like "09250-1" normalizes to the multi-word "09250 1", so this can't
    # be a token-set membership check (the set holds single tokens); pad
    # both sides with spaces and do a substring search so it still only
    # matches on a word boundary (e.g. "09250" should not match inside
    # "109250").
    padded_combined_text = f" {combined_text} "
    for unit_price in catalog:
        code_normalized = normalize_text(unit_price.code)
        if code_normalized and f" {code_normalized} " in padded_combined_text:
            return MatchResult(unit_price, EstimateLineItem.EXACT, Decimal("1.000"))

    # 2/3. Keyword match, restricted to the unit-compatible pool, scored
    # only on non-generic, non-stopword tokens.
    combined_tokens = tokenize(f"{description} {raw_text} {category}", strip_generic=True)
    if not combined_tokens:
        return _NO_MATCH

    best_match: UnitPrice | None = None
    best_score = 0
    best_coverage = 0.0
    for unit_price in catalog:
        catalog_tokens = tokenize(
            f"{unit_price.keywords} {unit_price.description} {unit_price.category}", strip_generic=True
        )
        if not catalog_tokens:
            continue
        overlap = catalog_tokens & combined_tokens
        score = len(overlap)
        if score == 0:
            continue
        coverage = score / min(len(catalog_tokens), len(combined_tokens))
        # Prefer higher score first, then higher coverage, to pick the
        # single best candidate deterministically.
        if score > best_score or (score == best_score and coverage > best_coverage):
            best_score = score
            best_coverage = coverage
            best_match = unit_price

    if best_match is None:
        return _NO_MATCH

    if best_score >= _STRONG_MIN_OVERLAP_TOKENS and best_coverage >= _STRONG_MIN_COVERAGE:
        # Strong keyword match. Confidence tracks coverage but is capped
        # below 1.0 -- that is reserved for an actual exact code match.
        return MatchResult(best_match, EstimateLineItem.KEYWORD, _quantize_confidence(min(best_coverage, 0.95)))

    # Weak: some real (non-generic) overlap, but not enough of it to trust
    # without a human looking at it. Still returned -- never dropped.
    weak_confidence = _quantize_confidence(min(0.15 + 0.1 * best_score, 0.45))
    return MatchResult(best_match, EstimateLineItem.WEAK, weak_confidence)


def price_extracted_item(item: ExtractedLineItem) -> dict:
    """Price a single `ExtractedLineItem` against the catalog. Returns a
    dict of the fields needed to construct an `EstimateLineItem` (minus
    `run`, `page_number`, `annotation`, which the caller already has).

    Unmatched items get `unit_cost = 0`, `needs_review = True`, and are
    still returned (never dropped) so they stay visible in the report.
    """
    try:
        quantity = item.quantity if isinstance(item.quantity, Decimal) else Decimal(str(item.quantity))
    except (InvalidOperation, ValueError, TypeError):
        quantity = Decimal("0")

    match = match_unit_price(item.description, item.raw_text, item.category, item.unit)

    if not _quantity_is_representable(quantity):
        # Garbled/absurd quantity. Keep the item VISIBLE (dropping it would
        # hide that the drawing said something we couldn't interpret) but
        # refuse to price it: zero quantity, zero cost, flagged, and the
        # original text preserved in raw_text as the evidence.
        logger.warning(
            "Unrepresentable extracted quantity %r for %r — item flagged, not priced.",
            item.quantity,
            item.description,
        )
        return {
            "description": item.description,
            "category": item.category or "uncategorized",
            "quantity": Decimal("0"),
            "unit": item.unit,
            "unit_price": None,
            "unit_cost": Decimal("0"),
            "line_total": Decimal("0"),
            "confidence": _quantize_confidence(item.confidence),
            "match_confidence": Decimal("0"),
            "needs_review": True,
            "match_method": EstimateLineItem.UNMATCHED,
            "raw_text": item.raw_text,
        }

    # A WEAK match is a SUGGESTION, not a price. The `unit_price` FK is kept
    # so the UI can offer "did you mean <row>?", but no cost is applied and
    # the line contributes 0 to the total.
    #
    # Why: on the real sample drawing, "TOTAL LIVABLE AREA 2,960.7 SF" (a
    # floor area) weak-matched a drywall row and priced at $9,622. Flagging
    # it was not enough -- it still summed into the headline total, making
    # the estimate's single most prominent number fiction. An estimate must
    # only total lines it can actually stand behind; everything else stays
    # visible at 0 with needs_review set, for a human to price.
    if match.match_method == EstimateLineItem.WEAK:
        unit_cost = Decimal("0")
    else:
        unit_cost = match.unit_price.unit_cost if match.unit_price is not None else Decimal("0")
    line_total = _quantize_money(quantity * unit_cost)
    if abs(line_total) > MAX_LINE_TOTAL:
        # Quantity was individually plausible but the product overflows the
        # money column. Same treatment: visible, flagged, not priced.
        logger.warning(
            "Line total overflow for %r (qty=%s cost=%s) — item flagged, not priced.",
            item.description,
            quantity,
            unit_cost,
        )
        unit_cost = Decimal("0")
        line_total = Decimal("0")
        match = MatchResult(None, EstimateLineItem.UNMATCHED, Decimal("0"))

    extraction_confidence = _quantize_confidence(item.confidence)

    # needs_review is True if EITHER signal is weak: the model was not
    # confident it read the drawing correctly, OR the catalog match is not
    # strong enough to price without a human checking it.
    #
    # An unmatched item is ALWAYS flagged -- it is priced at 0, and a $0
    # line silently presented as real is exactly the failure this feature
    # must never produce.
    needs_review = (
        match.match_method == EstimateLineItem.UNMATCHED
        or match.match_confidence < _AUTO_CLEAR_MATCH_CONFIDENCE
        or extraction_confidence < _MIN_EXTRACTION_CONFIDENCE
    )

    return {
        "description": item.description,
        "category": item.category or "uncategorized",
        "quantity": quantity,
        "unit": item.unit,
        "unit_price": match.unit_price,
        "unit_cost": unit_cost,
        "line_total": line_total,
        "confidence": extraction_confidence,
        "match_confidence": match.match_confidence,
        "needs_review": needs_review,
        "match_method": match.match_method,
        "raw_text": item.raw_text,
    }


@dataclass
class EstimateTotals:
    subtotal: Decimal
    waste_amount: Decimal
    markup_amount: Decimal
    total: Decimal


def compute_totals(line_totals: list[Decimal], waste_pct: Decimal, markup_pct: Decimal) -> EstimateTotals:
    """Roll up per-line totals into run-level totals.

    subtotal = sum(line_total)
    waste    = subtotal * waste_pct / 100
    markup   = (subtotal + waste) * markup_pct / 100
    total    = subtotal + waste + markup

    All Decimal, rounded to cents with ROUND_HALF_UP at each stage.
    """
    subtotal = _quantize_money(sum(line_totals, Decimal("0")))
    waste_amount = _quantize_money(subtotal * waste_pct / Decimal("100"))
    markup_amount = _quantize_money((subtotal + waste_amount) * markup_pct / Decimal("100"))
    total = _quantize_money(subtotal + waste_amount + markup_amount)
    return EstimateTotals(
        subtotal=subtotal,
        waste_amount=waste_amount,
        markup_amount=markup_amount,
        total=total,
    )
