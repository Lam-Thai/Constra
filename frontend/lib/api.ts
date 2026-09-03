import type {
  Annotation,
  DrawingDetail,
  EstimateRun,
  OcrRunResult,
  UnitPrice,
  UnitPriceImportResult,
} from "./types";

// Base URL of the separate Django backend (see backend/), not a Next.js API
// route — the frontend has no server-side data layer of its own. Read from
// NEXT_PUBLIC_API_BASE_URL (set in .env.local), never hardcode the origin.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// Builds a full URL to a Django/DRF endpoint. `path` must start with "/api/"
// and, per DRF convention, end with a trailing slash (e.g.
// "/api/drawings/") — a missing slash 404s against this backend.
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

// Uploads a PDF or image as a new (or replacement) drawing. `name` is
// optional — the backend derives one from the filename when omitted.
// Uploading under a name that already exists replaces that drawing's pages
// in place (idempotent upsert), which is not an error case.
//
// No `credentials: "include"` — the backend has no auth/session concept for
// this project, and sending credentials would only force it to allow
// credentialed CORS unnecessarily.
export async function uploadDrawing(file: File, name?: string): Promise<DrawingDetail> {
  const formData = new FormData();
  formData.append("file", file);
  if (name) formData.append("name", name);

  const res = await fetch(apiUrl("/api/drawings/"), {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(await extractErrorMessage(res));
  }

  return res.json() as Promise<DrawingDetail>;
}

// DRF validation errors come back as `{ "<field>": ["message", ...] }`
// (or occasionally `{ "detail": "message" }`). Flatten whatever shape shows
// up into one human-readable string rather than surfacing raw JSON.
async function extractErrorMessage(res: Response): Promise<string> {
  const fallback = `Request failed (${res.status})`;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fallback;
  }
  if (body && typeof body === "object") {
    const messages: string[] = [];
    for (const value of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        messages.push(...value.map(String));
      } else if (typeof value === "string") {
        messages.push(value);
      }
    }
    if (messages.length > 0) return messages.join(" ");
  }
  return fallback;
}

// Thrown by the helpers below instead of a plain Error so callers that need
// to branch on the HTTP status (e.g. the estimate endpoint's 503/400/502
// meaning three different things to a user) don't have to re-parse a
// message string to recover it.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
  // Some endpoints (e.g. DELETE) have no body; guard against a JSON parse
  // failure on an empty 204 response.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// --- OCR ---

export async function runOcr(
  drawingId: string,
  options: { page?: number | null; force?: boolean } = {}
): Promise<OcrRunResult> {
  return requestJson<OcrRunResult>(`/api/drawings/${drawingId}/ocr/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: options.page ?? null, force: options.force ?? false }),
  });
}

export async function patchAnnotationOcrText(id: string, ocrText: string): Promise<Annotation> {
  return requestJson<Annotation>(`/api/annotations/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ocr_text: ocrText }),
  });
}

// --- Estimate ---

export async function generateEstimate(
  drawingId: string,
  wastePct: number,
  markupPct: number
): Promise<EstimateRun> {
  return requestJson<EstimateRun>(`/api/drawings/${drawingId}/estimate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ waste_pct: wastePct, markup_pct: markupPct }),
  });
}

// List response omits `line_items` (see API-CONTRACT.md) — use
// `getEstimate` for the full detail.
export async function listEstimates(drawingId: string): Promise<EstimateRun[]> {
  return requestJson<EstimateRun[]>(`/api/drawings/${drawingId}/estimates/`);
}

export async function getEstimate(id: string): Promise<EstimateRun> {
  return requestJson<EstimateRun>(`/api/estimates/${id}/`);
}

export function estimateExportCsvUrl(id: string): string {
  return apiUrl(`/api/estimates/${id}/export.csv`);
}

export function estimateReportUrl(id: string): string {
  return apiUrl(`/api/estimates/${id}/report/`);
}

// --- Unit price catalog ---

export async function listUnitPrices(): Promise<UnitPrice[]> {
  return requestJson<UnitPrice[]>(`/api/unit-prices/`);
}

export async function patchUnitPrice(
  id: string,
  patch: Partial<Pick<UnitPrice, "code" | "description" | "category" | "unit" | "unit_cost" | "keywords">>
): Promise<UnitPrice> {
  return requestJson<UnitPrice>(`/api/unit-prices/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function importUnitPriceCsv(file: File): Promise<UnitPriceImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  return requestJson<UnitPriceImportResult>(`/api/unit-prices/import/`, {
    method: "POST",
    body: formData,
  });
}

export function unitPriceTemplateCsvUrl(): string {
  return apiUrl(`/api/unit-prices/template.csv`);
}
