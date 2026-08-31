export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Build a normalized, positive-size rect from two arbitrary corners, clamped to [0,1]. */
export function rectFromCorners(a: Point, b: Point): Rect {
  const x1 = clamp01(a.x);
  const y1 = clamp01(a.y);
  const x2 = clamp01(b.x);
  const y2 = clamp01(b.y);

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Translate a rect by (dx, dy), clamped so it stays fully inside [0,1] without changing size. */
export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return {
    x: clamp01(Math.min(rect.x + dx, 1 - rect.width)),
    y: clamp01(Math.min(rect.y + dy, 1 - rect.height)),
    width: rect.width,
    height: rect.height,
  };
}

export type Corner = "nw" | "ne" | "sw" | "se";

/** Resize a rect by dragging one corner to `point`, keeping the opposite corner fixed. */
export function resizeRectFromCorner(original: Rect, corner: Corner, point: Point): Rect {
  const fixed: Point =
    corner === "nw"
      ? { x: original.x + original.width, y: original.y + original.height }
      : corner === "ne"
      ? { x: original.x, y: original.y + original.height }
      : corner === "sw"
      ? { x: original.x + original.width, y: original.y }
      : { x: original.x, y: original.y };

  return rectFromCorners(fixed, point);
}

/** Pixel distance between two normalized points, given the reference box size in CSS pixels. */
export function normalizedDistancePx(
  a: Point,
  b: Point,
  boxWidthPx: number,
  boxHeightPx: number
): number {
  const dx = (a.x - b.x) * boxWidthPx;
  const dy = (a.y - b.y) * boxHeightPx;
  return Math.sqrt(dx * dx + dy * dy);
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
