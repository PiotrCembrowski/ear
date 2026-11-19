/**
 * Compile-time checks (run by `npm run typecheck`, never executed) that the
 * hand-written Database type plugs into supabase-js correctly. If supabase-js
 * stops understanding our types, this file stops compiling.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Expect<T extends true> = T;
type Equal<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

export async function typecheckDatabaseTypes(client: SupabaseClient<Database>) {
  const profiles = await client.from("profiles").select("id, role, settings").single();
  if (profiles.data) {
    type _role = Expect<Equal<typeof profiles.data.role, "user" | "admin">>;
  }

  const samples = await client.from("instrument_samples").select("midi_note, note_name, reference_sounds(name, is_synthetic)");
  if (samples.data?.[0]) {
    type _midi = Expect<Equal<typeof samples.data[0]["midi_note"], number>>;
    type _embedded = Expect<Equal<typeof samples.data[0]["reference_sounds"], { name: string; is_synthetic: boolean }>>;
  }

  const allowed = await client.rpc("consume_rate_limit", { p_bucket: "history", p_max: 10, p_window_seconds: 60 });
  if (allowed.data !== null) {
    type _rpc = Expect<Equal<typeof allowed.data, boolean>>;
  }

  // Users may update only display_name and settings.
  await client.from("profiles").update({ display_name: "New name" }).eq("id", "x");
  // @ts-expect-error role is not updatable through the typed client
  await client.from("profiles").update({ role: "admin" }).eq("id", "x");
}
