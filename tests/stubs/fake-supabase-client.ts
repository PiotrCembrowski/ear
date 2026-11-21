/**
 * A tiny fake Supabase client for service/unit tests. Each `from(table)` call
 * records the chained calls and resolves with whatever the table handler
 * returns; `rpc` likewise. Not a database: no filtering is performed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type Call = { table: string; method: string; args: unknown[] };
type Result = { data: unknown; error?: unknown; count?: number };
type TableHandler = (calls: Call[]) => Result;

export function fakeSupabase(tables: Record<string, TableHandler>, rpc: (name: string, args: unknown) => Result = () => ({ data: null })) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const own: Call[] = [];
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, method: string) {
            if (method === "then") {
              const handler = tables[table];
              const result = handler ? handler(own) : { data: null, error: { message: `no fake for ${table}` } };
              return (resolve: (value: unknown) => void) => resolve({ data: result.data, error: result.error ?? null, count: result.count ?? null });
            }
            return (...args: unknown[]) => {
              const call = { table, method, args };
              own.push(call);
              calls.push(call);
              return chain;
            };
          },
        },
      );
      return chain;
    },
    async rpc(name: string, args: unknown) {
      calls.push({ table: "rpc", method: name, args: [args] });
      const result = rpc(name, args);
      return { data: result.data, error: result.error ?? null };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}
