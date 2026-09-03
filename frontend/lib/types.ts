export type AnnotationType = "ignore" | "capture";

export type OcrStatus = "pending" | "done" | "empty" | "failed";

export interface Annotation {
  id: string;
  drawing_id: string;
  page_number: number;
  type: AnnotationType;
  x: number;
  y: number;
  width: number;
  height: number;
  ocr_text: string | null;
  // Server-set OCR provenance fields (see canvas-annotation-overlay /
  // API-CONTRACT.md). Only ever populated for `capture` annotations —
  // `ignore` rectangles are never OCR'd and these stay null on them.
  ocr_status: OcrStatus | null;
  ocr_confidence: number | null;
  ocr_ran_at: string | null;
  ocr_engine: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Client-only, transient UI state — never present on data returned by the
   * API. Set on an optimistic annotation while its create POST is still in
   * flight (id is a temporary `temp-...` string, not a real UUID yet), and
   * cleared once the server confirms the real row. Lets delete/move/resize
   * on a not-yet-saved rectangle wait for the real id instead of firing a
   * request against the temp id (which 404s at the URL-routing layer).
   */
  status?: "saving";
}

export interface PageInfo {
  page_number: number;
  image_url: string;
  width: number;
  height: number;
}

export interface DrawingDetail {
  id: string;
  name: string;
  page_count: number;
  created_at: string;
  pages: PageInfo[];
}

export interface DrawingSummary {
  id: string;
  name: string;
  page_count: number;
}

// --- AI Takeoff -> Estimate (see API-CONTRACT.md / SPEC.md) ---

export interface OcrRunResult {
  processed: number;
  skipped: number;
  empty: number;
  failed: number;
  annotations: Annotation[];
}

export type EstimateStatus = "running" | "complete" | "failed";

// "weak" = the matcher found a plausible catalog row but not enough
// evidence to trust it, so the row is offered as a SUGGESTION and no cost
// is applied (unit_cost/line_total are 0). Weak and unmatched lines are
// always needs_review and never contribute to the run total.
export type MatchMethod = "exact" | "keyword" | "weak" | "unmatched";

// Money/quantity fields arrive as strings (DRF Decimal) — never parsed to
// float for anything authoritative, only ever displayed as given.
export interface EstimateLineItem {
  id: string;
  annotation_id: string | null;
  page_number: number;
  description: string;
  category: string;
  quantity: string;
  unit: string;
  unit_price_id: string | null;
  unit_price_code: string | null;
  unit_cost: string;
  line_total: string;
  // How confident the model was that it READ the drawing correctly.
  confidence: string;
  // How confident the matcher is that the CATALOG ROW is the right one.
  // Deliberately separate: conflating the two is what once let a floor
  // area get priced as a door at full confidence.
  match_confidence: string;
  needs_review: boolean;
  match_method: MatchMethod;
  raw_text: string;
}

export interface EstimateRun {
  id: string;
  drawing_id: string;
  status: EstimateStatus;
  model_name: string;
  summary: string;
  currency: string;
  waste_pct: string;
  markup_pct: string;
  subtotal: string;
  waste_amount: string;
  markup_amount: string;
  total: string;
  prompt_tokens: number | null;
  output_tokens: number | null;
  error_message: string;
  created_at: string;
  completed_at: string | null;
  // Present on the detail response (POST .../estimate/, GET
  // /api/estimates/<id>/); omitted on the list response
  // (GET /api/drawings/<id>/estimates/).
  line_items?: EstimateLineItem[];
}

export type UnitPriceUnit = "SF" | "LF" | "EA" | "CY" | "SY" | "HR";

export interface UnitPrice {
  id: string;
  code: string;
  description: string;
  category: string;
  unit: UnitPriceUnit;
  unit_cost: string;
  keywords: string;
  source: "seed" | "csv";
  updated_at: string;
}

export interface UnitPriceImportError {
  row: number;
  message: string;
}

export interface UnitPriceImportResult {
  created: number;
  updated: number;
  errors: UnitPriceImportError[];
}
