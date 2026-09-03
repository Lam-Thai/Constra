from decimal import Decimal

from django.core.management.base import BaseCommand

from drawings.models import UnitPrice

# Placeholder Canadian/Toronto-market rates, approximate as of ~2025-2026.
# NOT verified against a live cost database — replace with real regional
# pricing (e.g. RSMeans, a local supplier quote sheet) before using this
# for an actual bid. Kept intentionally simple: one representative item
# per common category rather than a full CSI breakdown.
#
# Tuple shape: (code, description, category, unit, unit_cost, keywords)
SEED_UNIT_PRICES = [
    # --- Drywall ---
    ("09250-1", '1/2" drywall, hung/taped/sanded, painted', "drywall", "SF", "3.25",
     "drywall gypsum board wall gwb"),
    ("09250-2", '5/8" Type X fire-rated drywall, hung/taped', "drywall", "SF", "3.85",
     "drywall fire rated type x gwb"),
    ("09250-3", "Drywall patch/repair, small area", "drywall", "EA", "185.0000",
     "drywall patch repair hole"),
    ("09260-1", "Metal stud wall framing, 3-5/8\" studs 16\" o.c.", "drywall", "SF", "4.10",
     "metal stud framing partition wall"),

    # --- Framing ---
    ("06100-1", "Wood stud wall framing, 2x4 16\" o.c.", "framing", "SF", "6.50",
     "wood stud framing wall partition 2x4"),
    ("06100-2", "Wood stud wall framing, 2x6 16\" o.c.", "framing", "SF", "7.75",
     "wood stud framing wall partition 2x6 exterior"),
    ("06110-1", "Floor joists, engineered I-joist 16\" o.c.", "framing", "SF", "8.90",
     "floor joist i-joist framing"),
    ("06170-1", "Roof trusses, prefabricated, installed", "framing", "SF", "5.60",
     "roof truss framing prefabricated"),
    ("06200-1", "Rough carpentry, blocking/bracing, misc.", "framing", "HR", "68.0000",
     "rough carpentry blocking bracing misc labor"),

    # --- Concrete ---
    ("03300-1", "Cast-in-place concrete, footings", "concrete", "CY", "310.0000",
     "concrete footing foundation cast-in-place cip"),
    ("03300-2", "Cast-in-place concrete, foundation walls", "concrete", "CY", "365.0000",
     "concrete foundation wall cast-in-place cip"),
    ("03300-3", "Concrete slab-on-grade, 4in, incl. finish", "concrete", "SF", "8.25",
     "concrete slab on grade floor sog"),
    ("03200-1", "Reinforcing steel (rebar), incl. placement", "concrete", "CY", "185.0000",
     "rebar reinforcing steel concrete"),
    ("03310-1", "Concrete sidewalk/flatwork, 4in", "sitework", "SF", "9.50",
     "concrete sidewalk flatwork exterior"),

    # --- Doors & windows ---
    ("08110-1", "Interior hollow-core door, incl. frame/hardware", "doors-windows", "EA", "420.0000",
     "interior door hollow core frame hardware"),
    ("08110-2", "Interior solid-core door, incl. frame/hardware", "doors-windows", "EA", "610.0000",
     "interior door solid core frame hardware"),
    ("08210-1", "Exterior entry door, insulated steel, installed", "doors-windows", "EA", "1150.0000",
     "exterior entry door steel insulated"),
    ("08510-1", "Vinyl window, double-hung, standard size, installed", "doors-windows", "EA", "685.0000",
     "window vinyl double hung installed"),
    ("08520-1", "Aluminum window, fixed/casement, installed", "doors-windows", "EA", "790.0000",
     "window aluminum fixed casement installed"),

    # --- Electrical ---
    ("16140-1", "Duplex receptacle outlet, incl. wiring/device", "electrical", "EA", "145.0000",
     "electrical outlet receptacle duplex"),
    ("16140-2", "Light switch, single-pole, incl. wiring/device", "electrical", "EA", "125.0000",
     "electrical switch light single pole"),
    ("16500-1", "Recessed LED pot light, incl. fixture/install", "electrical", "EA", "165.0000",
     "electrical light fixture recessed led pot"),
    ("16050-1", "Panel upgrade, 200A residential service", "electrical", "EA", "3200.0000",
     "electrical panel service upgrade 200a"),
    ("16120-1", "Electrical wiring, general (per linear foot run)", "electrical", "LF", "6.75",
     "electrical wiring wire run"),

    # --- Plumbing ---
    ("15410-1", "Toilet, standard, supply/install", "plumbing", "EA", "620.0000",
     "plumbing toilet fixture install"),
    ("15410-2", "Bathroom sink/vanity, supply/install", "plumbing", "EA", "780.0000",
     "plumbing sink vanity bathroom install"),
    ("15410-3", "Kitchen sink, supply/install", "plumbing", "EA", "540.0000",
     "plumbing kitchen sink install"),
    ("15140-1", "Copper/PEX water supply line (per linear foot)", "plumbing", "LF", "14.50",
     "plumbing water supply line pipe pex copper"),
    ("15410-4", "Shower/tub unit, supply/install", "plumbing", "EA", "1450.0000",
     "plumbing shower tub install"),

    # --- Finishes ---
    ("09650-1", "Vinyl plank flooring, supply/install", "finishes", "SF", "5.90",
     "flooring vinyl plank lvp finish"),
    ("09680-1", "Carpet, supply/install incl. pad", "finishes", "SY", "42.0000",
     "flooring carpet finish pad"),
    ("09300-1", "Ceramic tile flooring, supply/install", "finishes", "SF", "11.25",
     "flooring tile ceramic finish"),
    ("09900-1", "Interior painting, walls, 2 coats", "finishes", "SF", "1.65",
     "paint painting interior wall finish"),
    ("06402-1", "Interior trim/casing, wood, supply/install", "finishes", "LF", "6.20",
     "trim casing baseboard interior finish"),

    # --- Sitework ---
    ("02300-1", "Excavation, general, machine", "sitework", "CY", "18.5000",
     "excavation sitework earthwork machine"),
    ("02510-1", "Asphalt paving, driveway, standard", "sitework", "SY", "48.0000",
     "asphalt paving driveway sitework"),
    ("02830-1", "Chain-link fence, 4ft, supply/install", "sitework", "LF", "32.0000",
     "fence chain link sitework"),
]


class Command(BaseCommand):
    help = (
        "Seed the UnitPrice catalog with ~30 realistic construction line "
        "items across common categories. Idempotent (upserts by `code`, "
        "marks rows source='seed'). Safe to re-run."
    )

    def handle(self, *args, **options):
        created = 0
        updated = 0
        for code, description, category, unit, unit_cost, keywords in SEED_UNIT_PRICES:
            _, was_created = UnitPrice.objects.update_or_create(
                code=code,
                defaults={
                    "description": description,
                    "category": category,
                    "unit": unit,
                    "unit_cost": Decimal(unit_cost),
                    "keywords": keywords,
                    "source": UnitPrice.SEED,
                },
            )
            created += was_created
            updated += not was_created

        self.stdout.write(self.style.SUCCESS(f"Seeded {created} new, updated {updated} existing unit prices."))
        self.stdout.write(
            self.style.WARNING(
                "NOTE: these are placeholder Canadian/Toronto-market rates for demo purposes only — "
                "replace with real, verified regional pricing before using this catalog for an actual bid."
            )
        )
