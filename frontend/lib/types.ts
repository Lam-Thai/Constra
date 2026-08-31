export type AnnotationType = "ignore" | "capture";

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
