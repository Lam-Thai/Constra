import type { DrawingDetail } from "./types";

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
