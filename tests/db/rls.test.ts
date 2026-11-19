/**
 * Migration + Row Level Security tests against a local Postgres.
 *
 * Runs only when TEST_DATABASE_URL is set (see .env.example); otherwise the
 * suite is skipped. The database is rebuilt from the migrations before the run.
 *
 * Phase 9 adds a second script that runs the same kind of checks against a
 * real Supabase project through its HTTP API.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { resetTestDatabase } from "../../scripts/db/test-database";
import { createAuthUser, createTestClient, errorCodeOf, PG_ERRORS, queryAs } from "./db-helpers";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("database: migrations, grants and RLS", () => {
  let db: pg.Client;
  let alice: string; // normal user
  let bob: string; // normal user
  let admin: string; // admin user
  let pianoId: string;
  let pianoCategoryId: string;
  let publicRefId: string;
  let privateRefId: string; // owned by alice

  const asAlice = () => ({ role: "authenticated", userId: alice }) as const;
  const asBob = () => ({ role: "authenticated", userId: bob }) as const;
  const asAdmin = () => ({ role: "authenticated", userId: admin }) as const;
  const anon = { role: "anon" } as const;
  const service = { role: "service_role" } as const;

  beforeAll(async () => {
    await resetTestDatabase(databaseUrl!);
    db = createTestClient(databaseUrl!);
    await db.connect();

    alice = await createAuthUser(db, "alice@example.test", "Alice");
    bob = await createAuthUser(db, "bob@example.test");
    admin = await createAuthUser(db, "admin@example.test");
    // Promoting the first admin: exactly the SQL documented in the README.
    await db.query("update public.profiles set role = 'admin' where id = $1", [admin]);

    const piano = await db.query<{ id: string; category_id: string }>(
      "select id, category_id from public.instruments where slug = 'piano'",
    );
    pianoId = piano.rows[0]!.id;
    pianoCategoryId = piano.rows[0]!.category_id;

    const insertRef = `insert into public.reference_sounds
        (name, category_id, storage_path, duration_ms, sample_rate, visibility, owner_id, license, attribution, is_synthetic)
      values ($1, $2, $3, 2000, 44100, $4, $5, 'CC0-1.0', 'Test fixture', true) returning id`;
    publicRefId = (await db.query<{ id: string }>(insertRef, ["Public tone", pianoCategoryId, "test/public.wav", "public", admin]))
      .rows[0]!.id;
    privateRefId = (
      await db.query<{ id: string }>(insertRef, ["Private tone", pianoCategoryId, "test/private.wav", "private", alice])
    ).rows[0]!.id;

    await db.query(
      `insert into storage.objects (bucket_id, name) values
         ('references', 'test/public.wav'), ('references', 'test/private.wav'), ('references', 'test/unlinked.wav')`,
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  describe("seed", () => {
    it("is readable by signed-out visitors (categories and instruments only)", async () => {
      const categories = await queryAs(db, anon, "select slug from public.reference_categories");
      expect(categories.rows.map((r) => r.slug)).toEqual(
        expect.arrayContaining(["piano", "guitar", "drums", "human-voice", "animals", "nature", "mechanical", "everyday-objects"]),
      );
      const piano = await queryAs(db, anon, "select midi_min, midi_max, expected_note_count from public.instruments where slug = 'piano'");
      expect(piano.rows[0]).toEqual({ midi_min: 21, midi_max: 108, expected_note_count: 88 });
    });
  });

  describe("profiles", () => {
    it("are created on sign-up with the display name from metadata", async () => {
      const result = await queryAs(db, asAlice(), "select display_name, role from public.profiles where id = $1", [alice]);
      expect(result.rows[0]).toEqual({ display_name: "Alice", role: "user" });
    });

    it("a user cannot make themselves admin", async () => {
      const code = await errorCodeOf(queryAs(db, asAlice(), "update public.profiles set role = 'admin' where id = $1", [alice]));
      expect(code).toBe(PG_ERRORS.insufficientPrivilege);
      const check = await db.query("select role from public.profiles where id = $1", [alice]);
      expect(check.rows[0]!.role).toBe("user");
    });

    it("the role trigger blocks escalation even if the column grant were missing", async () => {
      // Simulate a future mistake that grants UPDATE on every column, inside a
      // transaction that is rolled back afterwards.
      await db.query("begin");
      try {
        await db.query("grant update on public.profiles to authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: alice, role: "authenticated" })]);
        await db.query("set local role authenticated");
        await expect(db.query("update public.profiles set role = 'admin' where id = $1", [alice])).rejects.toThrow(
          /Changing a profile role is not allowed/,
        );
      } finally {
        await db.query("rollback");
      }
    });

    it("server code (service_role) can change roles", async () => {
      await queryAs(db, service, "update public.profiles set role = 'admin' where id = $1", [bob]);
      await queryAs(db, service, "update public.profiles set role = 'user' where id = $1", [bob]);
      const check = await db.query("select role from public.profiles where id = $1", [bob]);
      expect(check.rows[0]!.role).toBe("user");
    });

    it("users can edit their own display name and settings", async () => {
      await queryAs(db, asAlice(), "update public.profiles set display_name = 'Alice B', settings = $2 where id = $1", [
        alice,
        JSON.stringify({ a4Hz: 442, sensitivityDb: 12, saveHistory: true }),
      ]);
      const check = await db.query("select display_name, settings from public.profiles where id = $1", [alice]);
      expect(check.rows[0]).toEqual({ display_name: "Alice B", settings: { a4Hz: 442, sensitivityDb: 12, saveHistory: true } });
    });

    it("rejects out-of-range or mistyped settings", async () => {
      for (const settings of [{ a4Hz: 500 }, { a4Hz: "440" }, { sensitivityDb: 2 }, { saveHistory: "yes" }]) {
        const code = await errorCodeOf(
          queryAs(db, asAlice(), "update public.profiles set settings = $2 where id = $1", [alice, JSON.stringify(settings)]),
        );
        expect(code, JSON.stringify(settings)).toBe(PG_ERRORS.checkViolation);
      }
    });

    it("users cannot read or modify other users' profiles", async () => {
      const read = await queryAs(db, asBob(), "select id from public.profiles where id = $1", [alice]);
      expect(read.rowCount).toBe(0);
      const write = await queryAs(db, asBob(), "update public.profiles set display_name = 'hacked' where id = $1", [alice]);
      expect(write.rowCount).toBe(0);
    });

    it("admins can read all profiles", async () => {
      const result = await queryAs(db, asAdmin(), "select count(*)::int as n from public.profiles");
      expect(result.rows[0]!.n).toBe(3);
    });

    it("is_admin() reflects the caller", async () => {
      expect((await queryAs(db, asAdmin(), "select public.is_admin() as v")).rows[0]!.v).toBe(true);
      expect((await queryAs(db, asAlice(), "select public.is_admin() as v")).rows[0]!.v).toBe(false);
      expect((await queryAs(db, anon, "select public.is_admin() as v")).rows[0]!.v).toBe(false);
    });
  });

  describe("reference sounds", () => {
    it("signed-out visitors cannot read references", async () => {
      const code = await errorCodeOf(queryAs(db, anon, "select id from public.reference_sounds"));
      expect(code).toBe(PG_ERRORS.insufficientPrivilege);
    });

    it("public references are visible to any signed-in user; private only to owner and admins", async () => {
      const ids = async (actor: ReturnType<typeof asAlice>) =>
        (await queryAs<{ id: string }>(db, actor, "select id from public.reference_sounds")).rows.map((r) => r.id).sort();
      expect(await ids(asBob())).toEqual([publicRefId]);
      expect(await ids(asAlice())).toEqual([publicRefId, privateRefId].sort());
      expect(await ids(asAdmin())).toEqual([publicRefId, privateRefId].sort());
    });

    it("only admins can create, edit or delete references", async () => {
      const insert = `insert into public.reference_sounds (name, category_id, storage_path, duration_ms, sample_rate, license, source_url)
                      values ('X', $1, $2, 1000, 44100, 'CC0-1.0', 'https://example.org/x') returning id`;
      expect(await errorCodeOf(queryAs(db, asAlice(), insert, [pianoCategoryId, "test/x.wav"]))).toBe(PG_ERRORS.insufficientPrivilege);
      const created = await queryAs<{ id: string }>(db, asAdmin(), insert, [pianoCategoryId, "test/y.wav"]);
      const newId = created.rows[0]!.id;

      const edit = await queryAs(db, asAlice(), "update public.reference_sounds set name = 'hacked' where id = $1", [newId]);
      expect(edit.rowCount).toBe(0);
      const del = await queryAs(db, asAlice(), "delete from public.reference_sounds where id = $1", [newId]);
      expect(del.rowCount).toBe(0);
      const adminDel = await queryAs(db, asAdmin(), "delete from public.reference_sounds where id = $1", [newId]);
      expect(adminDel.rowCount).toBe(1);
    });

    it("requires a license and a source, and rejects '#' in storage paths", async () => {
      const insert = (path: string, license: string | null, sourceUrl: string | null, attribution: string | null) =>
        errorCodeOf(
          db.query(
            `insert into public.reference_sounds (name, category_id, storage_path, duration_ms, sample_rate, license, source_url, attribution)
             values ('X', $1, $2, 1000, 44100, $3, $4, $5)`,
            [pianoCategoryId, path, license, sourceUrl, attribution],
          ),
        );
      expect(await insert("piano/a/070_A#4_v80.wav", "CC0-1.0", "https://example.org", null)).toBe(PG_ERRORS.checkViolation);
      expect(await insert("piano/a/070_As4_v80.wav", "CC0-1.0", null, null)).toBe(PG_ERRORS.checkViolation);
      expect(await insert("piano/a/070_As4_v80.wav", null, "https://example.org", null)).toBe("23502"); // not-null violation
      expect(await insert("piano/a/070_As4_v80.wav", "CC0-1.0", null, "Jane Doe")).toBeUndefined();
    });
  });

  describe("instrument samples", () => {
    const insertSample = (refId: string, midi: number, velocity: number | null, variant = "grand-test") =>
      db.query<{ note_name: string; nominal_hz: number }>(
        `insert into public.instrument_samples (reference_sound_id, instrument_id, variant, midi_note, velocity)
         values ($1, $2, $3, $4, $5) returning note_name, nominal_hz`,
        [refId, pianoId, variant, midi, velocity],
      );

    const newRef = async (path: string) =>
      (
        await db.query<{ id: string }>(
          `insert into public.reference_sounds (name, category_id, storage_path, duration_ms, sample_rate, license, attribution, is_synthetic)
           values ('Sample', $1, $2, 1000, 44100, 'CC0-1.0', 'Test fixture', true) returning id`,
          [pianoCategoryId, path],
        )
      ).rows[0]!.id;

    it("derives the note name and equal-tempered frequency from the MIDI number", async () => {
      const a4 = await insertSample(await newRef("piano/grand-test/069_A4.wav"), 69, null);
      expect(a4.rows[0]!.note_name).toBe("A4");
      expect(a4.rows[0]!.nominal_hz).toBeCloseTo(440, 6);
      const as4 = await insertSample(await newRef("piano/grand-test/070_As4_v80.wav"), 70, 80);
      expect(as4.rows[0]!.note_name).toBe("A#4");
      const c4 = await insertSample(await newRef("piano/grand-test/060_C4_v80.wav"), 60, 80);
      expect(c4.rows[0]!.nominal_hz).toBeCloseTo(261.6256, 3);
    });

    it("rejects notes outside the instrument's range (piano 21..108)", async () => {
      expect(await errorCodeOf(insertSample(await newRef("piano/grand-test/020.wav"), 20, null))).toBe(PG_ERRORS.checkViolation);
      expect(await errorCodeOf(insertSample(await newRef("piano/grand-test/109.wav"), 109, null))).toBe(PG_ERRORS.checkViolation);
      expect(await errorCodeOf(insertSample(await newRef("piano/grand-test/021.wav"), 21, null))).toBeUndefined();
      expect(await errorCodeOf(insertSample(await newRef("piano/grand-test/108.wav"), 108, null))).toBeUndefined();
    });

    it("treats a repeated note with no velocity layer as a duplicate", async () => {
      expect(await errorCodeOf(insertSample(await newRef("piano/grand-test/069_A4_dup.wav"), 69, null))).toBe(
        PG_ERRORS.uniqueViolation,
      );
      expect(await errorCodeOf(insertSample(await newRef("piano/grand-test/069_A4_v40.wav"), 69, 40))).toBeUndefined();
    });

    it("hides samples and features of private references from other users", async () => {
      await db.query(
        `insert into public.instrument_samples (reference_sound_id, instrument_id, variant, midi_note) values ($1, $2, 'private-test', 60)`,
        [privateRefId, pianoId],
      );
      await db.query(
        `insert into public.reference_features (reference_sound_id, strategy_id, algorithm_version, features)
         values ($1, 'pitch', '1.0.0', '{"f0Hz": 261.6}'), ($2, 'pitch', '1.0.0', '{"f0Hz": 440}')`,
        [privateRefId, publicRefId],
      );
      const bobSamples = await queryAs(db, asBob(), "select 1 from public.instrument_samples where reference_sound_id = $1", [privateRefId]);
      expect(bobSamples.rowCount).toBe(0);
      const bobFeatures = await queryAs<{ reference_sound_id: string }>(db, asBob(), "select reference_sound_id from public.reference_features");
      expect(bobFeatures.rows.map((r) => r.reference_sound_id)).toEqual([publicRefId]);
      const aliceFeatures = await queryAs(db, asAlice(), "select 1 from public.reference_features where reference_sound_id = $1", [
        privateRefId,
      ]);
      expect(aliceFeatures.rowCount).toBe(1);
    });
  });

  describe("comparisons (history)", () => {
    const insertSql = `insert into public.comparisons (user_id, mode, reference_sound_id, strategy_id, algorithm_version, score, title, result)
                       values ($1, $2, $3, 'pitch', '1.0.0', $4, $5, $6) returning id`;

    it("users cannot insert history rows directly (only the server can)", async () => {
      const code = await errorCodeOf(queryAs(db, asAlice(), insertSql, [alice, "compare", publicRefId, 95, "A4 vs A4", "{}"]));
      expect(code).toBe(PG_ERRORS.insufficientPrivilege);
    });

    it("users can read and delete only their own rows", async () => {
      const aliceRow = (await queryAs<{ id: string }>(db, service, insertSql, [alice, "compare", publicRefId, 95, "Alice A4", "{}"])).rows[0]!.id;
      const bobRow = (await queryAs<{ id: string }>(db, service, insertSql, [bob, "identify", null, null, "Bob C4", "{}"])).rows[0]!.id;

      const aliceSees = await queryAs<{ id: string }>(db, asAlice(), "select id from public.comparisons");
      expect(aliceSees.rows.map((r) => r.id)).toEqual([aliceRow]);

      const bobDeletesAlice = await queryAs(db, asBob(), "delete from public.comparisons where id = $1", [aliceRow]);
      expect(bobDeletesAlice.rowCount).toBe(0);
      const bobEditsAlice = await errorCodeOf(queryAs(db, asBob(), "update public.comparisons set score = 1 where id = $1", [aliceRow]));
      expect(bobEditsAlice).toBe(PG_ERRORS.insufficientPrivilege);

      const bobDeletesOwn = await queryAs(db, asBob(), "delete from public.comparisons where id = $1", [bobRow]);
      expect(bobDeletesOwn.rowCount).toBe(1);
    });

    it("admins cannot read other users' history either", async () => {
      const rows = await queryAs(db, asAdmin(), "select 1 from public.comparisons");
      expect(rows.rowCount).toBe(0);
    });

    it("enforces score ranges, identify-has-no-score and the 16 KB result limit", async () => {
      const attempt = (mode: string, score: number | null, result: unknown) =>
        errorCodeOf(queryAs(db, service, insertSql, [alice, mode, null, score, "t", JSON.stringify(result)]));
      expect(await attempt("compare", 101, {})).toBe(PG_ERRORS.checkViolation);
      expect(await attempt("identify", 50, {})).toBe(PG_ERRORS.checkViolation);
      expect(await attempt("compare", null, {})).toBe(PG_ERRORS.checkViolation);
      // Random hex does not compress, so this really exceeds 16 KB on disk.
      const big = { blob: Array.from({ length: 1200 }, (_, i) => (i * 2654435761).toString(16).padStart(16, "0")).join("") };
      expect(await attempt("compare", 50, big)).toBe(PG_ERRORS.checkViolation);
      expect(await attempt("identify", null, { note: "A4" })).toBeUndefined();
    });

    it("deleting a user removes their profile and history", async () => {
      const temp = await createAuthUser(db, "temp@example.test");
      await queryAs(db, service, insertSql, [temp, "identify", null, null, "temp", "{}"]);
      await db.query("delete from auth.users where id = $1", [temp]);
      const left = await db.query(
        "select (select count(*) from public.profiles where id = $1)::int + (select count(*) from public.comparisons where user_id = $1)::int as n",
        [temp],
      );
      expect(left.rows[0]!.n).toBe(0);
    });
  });

  describe("rate limiting", () => {
    it("allows up to the limit per window, then refuses", async () => {
      const call = () => queryAs<{ ok: boolean }>(db, asAlice(), "select public.consume_rate_limit('test-bucket', 3, 600) as ok");
      const results = [];
      for (let i = 0; i < 4; i++) results.push((await call()).rows[0]!.ok);
      expect(results).toEqual([true, true, true, false]);
      // Bob has his own quota.
      const bob1 = await queryAs<{ ok: boolean }>(db, asBob(), "select public.consume_rate_limit('test-bucket', 3, 600) as ok");
      expect(bob1.rows[0]!.ok).toBe(true);
    });

    it("is not callable signed out, and the counter table is not directly accessible", async () => {
      expect(await errorCodeOf(queryAs(db, anon, "select public.consume_rate_limit('x', 3, 600)"))).toBe(
        PG_ERRORS.insufficientPrivilege,
      );
      expect(await errorCodeOf(queryAs(db, asAlice(), "select * from public.rate_limit_counters"))).toBe(
        PG_ERRORS.insufficientPrivilege,
      );
    });
  });

  describe("storage: references bucket", () => {
    const objectNames = async (actor: ReturnType<typeof asAlice>) =>
      (await queryAs<{ name: string }>(db, actor, "select name from storage.objects where bucket_id = 'references' order by name")).rows.map(
        (r) => r.name,
      );

    it("files follow the visibility of their reference row", async () => {
      expect(await objectNames(asBob())).toEqual(["test/public.wav"]);
      expect(await objectNames(asAlice())).toEqual(["test/private.wav", "test/public.wav"]);
      // Admins also see files not yet linked to a reference row.
      expect(await objectNames(asAdmin())).toEqual(["test/private.wav", "test/public.wav", "test/unlinked.wav"]);
    });

    it("only admins can upload or delete reference files", async () => {
      const upload = "insert into storage.objects (bucket_id, name) values ('references', $1)";
      expect(await errorCodeOf(queryAs(db, asAlice(), upload, ["test/evil.wav"]))).toBe(PG_ERRORS.insufficientPrivilege);
      expect(await errorCodeOf(queryAs(db, asAdmin(), upload, ["test/new.wav"]))).toBeUndefined();
      const del = await queryAs(db, asBob(), "delete from storage.objects where name = 'test/public.wav'");
      expect(del.rowCount).toBe(0);
    });

    it("the bucket is private with a size and type limit", async () => {
      const bucket = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'references'");
      expect(bucket.rows[0]).toEqual({
        public: false,
        file_size_limit: "5242880",
        allowed_mime_types: ["audio/wav", "audio/x-wav", "audio/wave"],
      });
      const buckets = await db.query("select id from storage.buckets");
      expect(buckets.rows.map((r) => r.id)).toEqual(["references"]); // no bucket for user audio
    });
  });
});
