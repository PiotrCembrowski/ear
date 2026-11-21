import { NextResponse, type NextRequest } from "next/server";
import { recordComparison } from "@/features/history/record-comparison";
import { getCurrentProfile, getSessionUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/config/server-env";
import { logServerError } from "@/lib/logging";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { MAX_COMPARISON_REQUEST_BYTES } from "@/lib/validation/comparisons";

/**
 * POST /api/comparisons: save a result summary (never audio) to the signed-in
 * user's history. All checks live in recordComparison(); this handler only
 * deals with HTTP: auth, same-origin, size, JSON, and status codes.
 */
export async function POST(request: NextRequest) {
  // Defense in depth against cross-site requests (session cookies are SameSite=Lax too).
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to save results." }, { status: 401 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_COMPARISON_REQUEST_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_COMPARISON_REQUEST_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const env = getServerEnv();
    const profile = await getCurrentProfile();
    const outcome = await recordComparison(
      {
        userClient: await createServerSupabase(),
        adminClient: createAdminSupabase(),
        userId: user.id,
        saveHistory: profile?.settings.saveHistory ?? true,
        rateLimit: { max: env.HISTORY_RATE_LIMIT_MAX, windowSeconds: env.HISTORY_RATE_LIMIT_WINDOW_SECONDS },
      },
      body,
    );
    switch (outcome.status) {
      case "saved":
        return NextResponse.json({ saved: true, id: outcome.id }, { status: 201 });
      case "skipped":
        return NextResponse.json({ saved: false, reason: outcome.reason });
      case "rejected": {
        const status = { invalid: 422, "not-found": 404, outdated: 409, "rate-limited": 429 }[outcome.reason];
        return NextResponse.json({ saved: false, reason: outcome.reason, error: outcome.message }, { status });
      }
    }
  } catch (error) {
    logServerError("POST /api/comparisons", error, { userId: user.id });
    return NextResponse.json({ saved: false, error: "Couldn't save to history. Please try again." }, { status: 500 });
  }
}
