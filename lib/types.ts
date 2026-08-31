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
