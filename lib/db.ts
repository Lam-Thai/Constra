import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

const PLACEHOLDER =
  "postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require";

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url || url.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in " +
        "your real Neon connection string (get it from the Neon project " +
        "dashboard) before running the app, migrations, or the import script."
    );
  }

  if (url.trim() === PLACEHOLDER) {
    throw new Error(
      "DATABASE_URL in .env.local is still the placeholder value. Replace it " +
        "with your real Neon connection string from the Neon project " +
        "dashboard, e.g. postgresql://user:pass@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require"
    );
  }

  return url;
}

type Sql = NeonQueryFunction<false, false>;

// Built lazily (on first actual query), not at module load time. Next.js
// imports every route handler module during `next build` (to collect route
// metadata) even though the handler never runs — validating DATABASE_URL
// eagerly here would fail the build itself whenever a real credential isn't
// configured yet. Deferring to first use means `next build`/`next dev`
// boot fine, and the clear, actionable error below only surfaces once a
// request actually needs the database.
let cached: Sql | undefined;

function client(): Sql {
  if (!cached) {
    cached = neon(resolveDatabaseUrl());
  }
  return cached;
}

// Proxy so call sites can keep using `sql\`select ...\`` exactly like the
// raw neon() client (per the neon-postgres-setup skill), while the
// DATABASE_URL check above still only runs on first actual use.
export const sql: Sql = new Proxy(function sql() {} as unknown as Sql, {
  apply(_target, _thisArg, args) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    const c = client() as unknown as Record<PropertyKey, unknown>;
    const value = c[prop];
    return typeof value === "function" ? value.bind(c) : value;
  },
});
