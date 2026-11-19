/**
 * Builds a throwaway local Postgres database that looks enough like Supabase
 * for migration and Row Level Security tests:
 *
 *   1. drop + recreate the database named in TEST_DATABASE_URL
 *   2. apply scripts/db/supabase-shim.sql (auth/storage/roles stand-in)
 *   3. apply every file in supabase/migrations/ in filename order
 *   4. apply supabase/seed.sql
 *
 * Used by the DB tests (tests/db/*) and by `npm run db:test:reset`.
 * NEVER point TEST_DATABASE_URL at a real Supabase project: step 1 drops it.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Refuses anything that does not look like a local throwaway database. */
function assertSafeTestUrl(databaseUrl: string): URL {
  const url = new URL(databaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!localHosts.has(url.hostname)) {
    throw new Error(`TEST_DATABASE_URL must point to localhost (got ${url.hostname}); this script drops the database.`);
  }
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(dbName)) {
    throw new Error(`TEST_DATABASE_URL database name must contain "test" (got "${dbName}").`);
  }
  return url;
}

async function runSqlFile(client: pg.Client, filePath: string): Promise<void> {
  const sql = await readFile(filePath, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed applying ${path.relative(repoRoot, filePath)}: ${message}`);
  }
}

export async function resetTestDatabase(databaseUrl: string): Promise<void> {
  const url = assertSafeTestUrl(databaseUrl);
  const dbName = url.pathname.replace(/^\//, "");

  // Connect to the maintenance database to drop/create the test database.
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.query(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await runSqlFile(client, path.join(repoRoot, "scripts/db/supabase-shim.sql"));
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrations = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of migrations) {
      await runSqlFile(client, path.join(migrationsDir, file));
    }
    await runSqlFile(client, path.join(repoRoot, "supabase/seed.sql"));
  } finally {
    await client.end();
  }
}
