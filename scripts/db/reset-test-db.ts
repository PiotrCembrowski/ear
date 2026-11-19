/**
 * CLI: rebuild the local test database from scratch.
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/soundmatch_test npm run db:test:reset
 */
import { resetTestDatabase } from "./test-database";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error("Set TEST_DATABASE_URL (see .env.example).");
  process.exit(1);
}

resetTestDatabase(databaseUrl)
  .then(() => {
    console.log("Test database rebuilt: shim + migrations + seed applied.");
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
