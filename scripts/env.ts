import path from "node:path";
import { config as loadEnv } from "dotenv";

const PLACEHOLDER =
  "postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require";

/**
 * Loads .env.local (Next.js's convention; standalone scripts run via `tsx`
 * don't get Next's automatic env loading) and returns a validated
 * DATABASE_URL, or prints a clear actionable message and exits the process
 * if it's missing or still the .env.example placeholder.
 */
export function requireDatabaseUrl(): string {
  loadEnv({ path: path.join(process.cwd(), ".env.local") });

  const url = process.env.DATABASE_URL;

  if (!url || url.trim() === "") {
    console.error(
      "DATABASE_URL is not set.\n" +
        "Copy .env.example to .env.local and fill in your real Neon " +
        "connection string (from the Neon project dashboard) before " +
        "running this script."
    );
    process.exit(1);
  }

  if (url.trim() === PLACEHOLDER) {
    console.error(
      "DATABASE_URL in .env.local is still the placeholder value.\n" +
        "Replace it with your real Neon connection string, e.g.\n" +
        "postgresql://user:pass@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require"
    );
    process.exit(1);
  }

  return url;
}
