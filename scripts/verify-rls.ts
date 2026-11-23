/**
 * Security check against a REAL Supabase project, through the same public API
 * the browser uses (PostgREST, Auth, Storage). It proves:
 *
 *   - user A cannot read, change or delete user B's profile or history;
 *   - a normal user cannot make themselves admin (column grant, trigger, metadata);
 *   - users cannot write history directly, or create/edit/delete references,
 *     categories, instruments, samples or features;
 *   - private references and their files stay private; the bucket refuses user uploads;
 *   - the rate-limit table is not directly readable;
 *   - signed-out visitors see only categories and instruments.
 *
 * It creates two temporary users plus two temporary reference rows and files
 * (tiny silent WAVs marked is_synthetic, under `rls-check/`), and deletes all of
 * them at the end, even if a check fails.
 *
 * Use a development or staging project, not production:
 *
 *   npm run verify:rls -- --yes
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY (read from .env.local by the npm script).
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encodeWav16 } from "../src/lib/audio-engine/wav";
import type { Database } from "../src/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

const BUCKET = "references";
const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

interface Outcome {
  name: string;
  ok: boolean;
  detail?: string;
}

const outcomes: Outcome[] = [];

async function check(name: string, run: () => Promise<true | string>): Promise<void> {
  try {
    const result = await run();
    outcomes.push(result === true ? { name, ok: true } : { name, ok: false, detail: result });
  } catch (error) {
    outcomes.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

/** A read or write was refused: either an error, or no rows came back. */
function refused(response: { error: unknown; data: unknown }): true | string {
  if (response.error) return true;
  if (Array.isArray(response.data) && response.data.length === 0) return true;
  if (response.data === null) return true;
  return `expected to be refused, got ${JSON.stringify(response.data).slice(0, 200)}`;
}

/**
 * A write must be refused with "insufficient privilege" (SQLSTATE 42501): a
 * missing grant or an RLS policy. Any other error (e.g. a NOT NULL violation)
 * would not prove anything, so it counts as a failure.
 */
function errored(response: { error: { code?: string; message: string } | null; data: unknown }): true | string {
  if (!response.error) return `expected permission denied, got ${JSON.stringify(response.data).slice(0, 200)}`;
  return response.error.code === "42501" ? true : `expected permission denied (42501), got ${response.error.code}: ${response.error.message}`;
}

function rows<T>(response: { error: { message: string } | null; data: T[] | null }, label: string): T[] {
  if (response.error) throw new Error(`${label}: ${response.error.message}`);
  return response.data ?? [];
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  return value;
}

async function main(): Promise<number> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const secretKey = env("SUPABASE_SECRET_KEY");

  if (!process.argv.includes("--yes")) {
    console.log(
      `This creates two temporary users and two temporary reference sounds in\n  ${url}\n` +
        "runs the checks, then deletes everything it created.\n" +
        "Use a development or staging project. Re-run with --yes to continue:\n\n  npm run verify:rls -- --yes\n",
    );
    return 2;
  }

  const admin: Client = createClient<Database>(url, secretKey, CLIENT_OPTIONS);
  const run = randomBytes(4).toString("hex");
  const created = { users: [] as string[], references: [] as string[], files: [] as string[] };

  try {
    // ---------------------------------------------------------------- setup
    const password = randomBytes(18).toString("base64url");
    const makeUser = async (label: string) => {
      const email = `soundmatch-rls-${run}-${label}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `RLS check ${label.toUpperCase()}` },
      });
      if (error || !data.user) throw new Error(`Could not create test user ${label}: ${error?.message}`);
      created.users.push(data.user.id);
      return { id: data.user.id, email };
    };
    const userA = await makeUser("a");
    const userB = await makeUser("b");

    const signIn = async (email: string): Promise<Client> => {
      const client = createClient<Database>(url, publishableKey, CLIENT_OPTIONS);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Could not sign in ${email}: ${error.message}`);
      return client;
    };
    const asA = await signIn(userA.email);
    const asB = await signIn(userB.email);
    const anon: Client = createClient<Database>(url, publishableKey, CLIENT_OPTIONS);

    const categories = rows(await admin.from("reference_categories").select("id").limit(1), "read categories");
    const categoryId = categories[0]?.id;
    if (!categoryId) throw new Error("No reference categories found. Apply supabase/seed.sql first.");

    // Tiny silent test files: never shown as real recordings (is_synthetic = true).
    const wav = encodeWav16({ samples: new Float32Array(2205), sampleRate: 22050 });
    const makeReference = async (visibility: "public" | "private") => {
      const path = `rls-check/${run}/${visibility}.wav`;
      const upload = await admin.storage.from(BUCKET).upload(path, wav, { contentType: "audio/wav" });
      if (upload.error) throw new Error(`Upload ${path}: ${upload.error.message}`);
      created.files.push(path);
      const { data, error } = await admin
        .from("reference_sounds")
        .insert({
          name: `RLS check ${visibility} ${run}`,
          category_id: categoryId,
          storage_path: path,
          duration_ms: 100,
          sample_rate: 22050,
          visibility,
          owner_id: visibility === "private" ? userB.id : null,
          license: "Test file",
          attribution: "SoundMatch RLS check (temporary)",
          is_synthetic: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Insert reference: ${error?.message}`);
      created.references.push(data.id);
      return { id: data.id, path };
    };
    const publicRef = await makeReference("public");
    const privateRef = await makeReference("private");

    const makeComparison = async (userId: string) => {
      const { data, error } = await admin
        .from("comparisons")
        .insert({
          user_id: userId,
          mode: "compare",
          reference_sound_id: publicRef.id,
          strategy_id: "pitch",
          algorithm_version: "1.0.0",
          score: 50,
          title: `RLS check ${run}`,
          result: { check: true },
          computed_on: "client",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Insert comparison: ${error?.message}`);
      return data.id;
    };
    const comparisonA = await makeComparison(userA.id);
    const comparisonB = await makeComparison(userB.id);

    const profileOf = async (id: string) =>
      (await admin.from("profiles").select("role, display_name").eq("id", id).single()).data;

    // ------------------------------------------------------------- profiles
    await check("A reads only their own profile", async () => {
      const data = rows(await asA.from("profiles").select("id"), "select profiles");
      return data.length === 1 && data[0]!.id === userA.id ? true : `got ${data.length} row(s)`;
    });
    await check("A cannot read B's profile", async () => refused(await asA.from("profiles").select("id").eq("id", userB.id)));
    await check("A cannot change B's display name", async () => {
      const r = refused(await asA.from("profiles").update({ display_name: "hacked" }).eq("id", userB.id).select("id"));
      if (r !== true) return r;
      return (await profileOf(userB.id))?.display_name === "RLS check B" ? true : "B's name changed";
    });
    await check("A can change their own display name (control)", async () => {
      const data = rows(await asA.from("profiles").update({ display_name: "RLS check A2" }).eq("id", userA.id).select("id"), "update own");
      return data.length === 1 ? true : "own update affected no rows";
    });
    await check("A cannot make themselves admin via the profile", async () => {
      // `role` is not in the update grant; the cast lets us send it anyway.
      const r = errored(await asA.from("profiles").update({ role: "admin" } as never).eq("id", userA.id).select("id"));
      if (r !== true) return r;
      return (await profileOf(userA.id))?.role === "user" ? true : "role changed";
    });
    await check("A cannot make themselves admin via user metadata", async () => {
      await asA.auth.updateUser({ data: { role: "admin" } });
      const isAdmin = await asA.rpc("is_admin");
      if (isAdmin.error) return isAdmin.error.message;
      if (isAdmin.data !== false) return "is_admin() returned true";
      return (await profileOf(userA.id))?.role === "user" ? true : "role changed";
    });

    // ---------------------------------------------------------- comparisons
    await check("A sees only their own history", async () => {
      const data = rows(await asA.from("comparisons").select("id, user_id"), "select comparisons");
      return data.length === 1 && data[0]!.id === comparisonA ? true : `got ${data.length} row(s)`;
    });
    await check("A cannot read B's history row", async () => refused(await asA.from("comparisons").select("id").eq("id", comparisonB)));
    await check("A cannot delete B's history row", async () => {
      const r = refused(await asA.from("comparisons").delete().eq("id", comparisonB).select("id"));
      if (r !== true) return r;
      const still = await admin.from("comparisons").select("id").eq("id", comparisonB);
      return still.data?.length === 1 ? true : "B's row was deleted";
    });
    await check("A cannot edit their own history score", async () =>
      errored(await asA.from("comparisons").update({ score: 100 } as never).eq("id", comparisonA).select("id")),
    );
    await check("A cannot insert history rows directly (only the server can)", async () =>
      errored(
        await asA.from("comparisons").insert({
          user_id: userA.id,
          mode: "compare",
          strategy_id: "pitch",
          algorithm_version: "1.0.0",
          score: 100,
          title: "forged",
          result: {},
        } as never),
      ),
    );
    await check("A can delete their own history row (control)", async () => {
      const data = rows(await asA.from("comparisons").delete().eq("id", comparisonA).select("id"), "delete own");
      return data.length === 1 ? true : "own delete affected no rows";
    });

    // ----------------------------------------------------------- references
    await check("A can read a public reference (control)", async () => {
      const data = rows(await asA.from("reference_sounds").select("id").eq("id", publicRef.id), "select public");
      return data.length === 1 ? true : "public reference not visible";
    });
    await check("A cannot read B's private reference", async () =>
      refused(await asA.from("reference_sounds").select("id").eq("id", privateRef.id)),
    );
    await check("B (owner) can read their private reference (control)", async () => {
      const data = rows(await asB.from("reference_sounds").select("id").eq("id", privateRef.id), "select private");
      return data.length === 1 ? true : "owner cannot see own private reference";
    });
    await check("A cannot create a reference", async () =>
      errored(
        await asA.from("reference_sounds").insert({
          name: "forged",
          category_id: categoryId,
          storage_path: `rls-check/${run}/forged.wav`,
          duration_ms: 100,
          sample_rate: 22050,
          license: "x",
          attribution: "x",
        }),
      ),
    );
    await check("A cannot rename a public reference", async () => {
      const r = refused(await asA.from("reference_sounds").update({ name: "hacked" }).eq("id", publicRef.id).select("id"));
      if (r !== true) return r;
      const row = await admin.from("reference_sounds").select("name").eq("id", publicRef.id).single();
      return row.data?.name === `RLS check public ${run}` ? true : "name changed";
    });
    await check("A cannot delete a public reference", async () => {
      const r = refused(await asA.from("reference_sounds").delete().eq("id", publicRef.id).select("id"));
      if (r !== true) return r;
      const row = await admin.from("reference_sounds").select("id").eq("id", publicRef.id);
      return row.data?.length === 1 ? true : "reference deleted";
    });
    await check("A cannot create categories or instruments", async () => {
      const category = errored(await asA.from("reference_categories").insert({ slug: `rls-${run}`, name: "forged" }));
      if (category !== true) return `category: ${category}`;
      const instrument = errored(
        await asA.from("instruments").insert({
          slug: `rls-${run}`,
          name: "forged",
          category_id: categoryId,
          midi_min: 60,
          midi_max: 72,
          expected_note_count: 13,
        }),
      );
      return instrument === true ? true : `instrument: ${instrument}`;
    });
    await check("A cannot write samples or features", async () => {
      const instruments = rows(await admin.from("instruments").select("id, midi_min").limit(1), "read instruments");
      const instrument = instruments[0];
      if (!instrument) return "no instruments found (apply supabase/seed.sql)";
      const sample = errored(
        await asA.from("instrument_samples").insert({
          reference_sound_id: publicRef.id,
          instrument_id: instrument.id,
          variant: "rls-check",
          midi_note: instrument.midi_min,
        }),
      );
      if (sample !== true) return `sample: ${sample}`;
      const feature = errored(
        await asA.from("reference_features").insert({
          reference_sound_id: publicRef.id,
          strategy_id: "pitch",
          algorithm_version: "1.0.0",
          features: {},
        }),
      );
      return feature === true ? true : `feature: ${feature}`;
    });

    // -------------------------------------------------------------- storage
    await check("A can download a public reference file (control)", async () => {
      const { error } = await asA.storage.from(BUCKET).download(publicRef.path);
      return error ? error.message : true;
    });
    await check("A cannot download or sign B's private reference file", async () => {
      const download = await asA.storage.from(BUCKET).download(privateRef.path);
      if (!download.error) return "download succeeded";
      const signed = await asA.storage.from(BUCKET).createSignedUrl(privateRef.path, 60);
      return signed.error ? true : "signed URL created";
    });
    await check("A cannot upload to the references bucket", async () => {
      const { error } = await asA.storage.from(BUCKET).upload(`rls-check/${run}/forged.wav`, wav, { contentType: "audio/wav" });
      if (!error) created.files.push(`rls-check/${run}/forged.wav`);
      return error ? true : "upload succeeded";
    });
    await check("A cannot delete a reference file", async () => {
      await asA.storage.from(BUCKET).remove([publicRef.path]);
      const { error } = await admin.storage.from(BUCKET).download(publicRef.path);
      return error ? "file was deleted" : true;
    });
    await check("Signed-out visitors cannot download reference files", async () => {
      const { error } = await anon.storage.from(BUCKET).download(publicRef.path);
      return error ? true : "download succeeded";
    });

    // ------------------------------------------------------- rate limiting
    await check("A can use their own rate-limit quota (control)", async () => {
      const { data, error } = await asA.rpc("consume_rate_limit", { p_bucket: "rls-check", p_max: 5, p_window_seconds: 60 });
      return error ? error.message : data === true ? true : "unexpected false";
    });
    await check("Users cannot read the rate-limit table", async () => refused(await asB.from("rate_limit_counters" as never).select("*")));

    // ----------------------------------------------------------- signed out
    await check("Signed-out visitors can read instruments (control)", async () => {
      const { error } = await anon.from("instruments").select("id").limit(1);
      return error ? error.message : true;
    });
    await check("Signed-out visitors cannot read profiles, history or references", async () => {
      for (const table of ["profiles", "comparisons", "reference_sounds"] as const) {
        const r = refused(await anon.from(table).select("id").limit(1));
        if (r !== true) return `${table}: ${r}`;
      }
      return true;
    });
  } finally {
    // -------------------------------------------------------------- cleanup
    const problems: string[] = [];
    if (created.files.length > 0) {
      const { error } = await admin.storage.from(BUCKET).remove(created.files);
      if (error) problems.push(`files: ${error.message}`);
    }
    for (const id of created.references) {
      const { error } = await admin.from("reference_sounds").delete().eq("id", id);
      if (error) problems.push(`reference ${id}: ${error.message}`);
    }
    for (const id of created.users) {
      // Deleting the auth user cascades to the profile, history and rate-limit rows.
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) problems.push(`user ${id}: ${error.message}`);
    }
    if (problems.length > 0) {
      console.error(`Cleanup incomplete (remove these by hand, run id ${run}):\n  ${problems.join("\n  ")}`);
    }
  }

  // --------------------------------------------------------------- report
  for (const { name, ok, detail } of outcomes) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
  const failed = outcomes.filter((o) => !o.ok).length;
  console.log(`\n${outcomes.length - failed} passed, ${failed} failed.`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
