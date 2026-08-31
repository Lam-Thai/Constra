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
