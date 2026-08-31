/**
 * Applies every SQL file in db/migrations/, in filename order, against
 * DATABASE_URL. Idempotent: migration files use `create table if not
 * exists` / `create index if not exists`, so re-running this is safe and
 * just re-applies already-applied statements as no-ops.
 *
 * Usage:
 *   npx tsx scripts/migrate.ts
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { requireDatabaseUrl } from "./env";

async function main() {
  const sql = neon(requireDatabaseUrl());

  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found in db/migrations/.");
    return;
  }

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const contents = await readFile(filePath, "utf8");
    console.log(`Applying ${file}...`);
    // neon's HTTP driver doesn't support multiple statements in a single
    // query call, so split on statement-terminating semicolons and run
    // each non-empty statement individually.
    const statements = splitStatements(contents);
    for (const statement of statements) {
      await sql.query(statement);
    }
    console.log(`  done (${statements.length} statement(s)).`);
  }

  console.log("Migrations complete.");
}

/**
 * Naive SQL statement splitter: strips `--` line comments — both lines that
 * are entirely a comment and trailing comments after real SQL on the same
 * line (e.g. `id int -- some note`) — by cutting each line at the first
 * `--`, then splits what remains on `;`. Good enough for our plain DDL
 * migration files. Does NOT understand string literals, so a `--` or `;`
 * inside a quoted string (e.g. `'a -- b'` or `'a; b'`) will still be
 * misparsed; no stored procedures or dollar-quoted bodies either.
 */
function splitStatements(sqlText: string): string[] {
  const withoutComments = sqlText
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
