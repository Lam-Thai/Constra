export type AnnotationType = "ignore" | "capture";

export const ANNOTATION_TYPES: readonly AnnotationType[] = ["ignore", "capture"];

export function isAnnotationType(value: unknown): value is AnnotationType {
  return value === "ignore" || value === "capture";
}

/** Finite number within [0, 1] (inclusive). */
export function isUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Validates a normalized (0..1) annotation rectangle. Mirrors the DB check
 * constraints in db/migrations/001_init.sql, but at the API boundary so we
 * return a clean 400 instead of a raw Postgres constraint-violation error.
 * Returns an error message, or null if the rect is valid.
 */
export function validateRect(rect: Partial<Rect>): string | null {
  const { x, y, width, height } = rect;

  if (!isUnitNumber(x)) return "x must be a finite number between 0 and 1";
  if (!isUnitNumber(y)) return "y must be a finite number between 0 and 1";
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 1) {
    return "width must be a finite number greater than 0 and at most 1";
  }
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0 || height > 1) {
    return "height must be a finite number greater than 0 and at most 1";
  }
  if (x + width > 1) return "x + width must be <= 1";
  if (y + height > 1) return "y + height must be <= 1";

  return null;
}

export function parsePositiveIntParam(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True if `value` is a syntactically valid UUID. Used to validate `id` /
 * `drawingId` path params before they reach a query, so a malformed id
 * (typo, bot scan, stale bookmark) returns a clean 400 instead of
 * Postgres's raw "invalid input syntax for type uuid" surfacing as a 500.
 */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}
