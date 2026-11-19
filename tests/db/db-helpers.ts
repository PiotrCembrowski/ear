/**
 * Helpers for running SQL "as" a Supabase role against the local test database.
 *
 * Supabase decides who you are from the JWT: PostgREST switches to the role in
 * the token (anon / authenticated / service_role) and exposes the claims via
 * the `request.jwt.claims` setting, which auth.uid() reads. We do the same
 * inside a transaction so the role switch never leaks between queries.
 */
import pg from "pg";

export type Actor =
  | { role: "anon" }
  | { role: "authenticated"; userId: string }
  | { role: "service_role" };

export function createTestClient(databaseUrl: string): pg.Client {
  return new pg.Client({ connectionString: databaseUrl });
}

/** Runs one statement as `actor` in its own transaction, committing on success. */
export async function queryAs<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.Client,
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<Row>> {
  await client.query("begin");
  try {
    const claims =
      actor.role === "authenticated"
        ? { sub: actor.userId, role: "authenticated" }
        : { role: actor.role };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${actor.role}`);
    const result = await client.query<Row>(sql, params);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/** Postgres error code of a failed query, e.g. '42501' (insufficient privilege). */
export async function errorCodeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      return String((error as { code: unknown }).code);
    }
    throw error;
  }
  return undefined;
}

/** Creates an auth user as the superuser (like Supabase Auth would) and returns its id. */
export async function createAuthUser(client: pg.Client, email: string, displayName?: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(displayName ? { display_name: displayName } : {})],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Failed to create auth user");
  return row.id;
}

export const PG_ERRORS = {
  insufficientPrivilege: "42501",
  checkViolation: "23514",
  uniqueViolation: "23505",
} as const;
