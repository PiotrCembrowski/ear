import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Origin of the Supabase project (API, Auth and Storage signed URLs). It is the
 * ONLY outside host the browser may talk to; see `connect-src` below.
 */
function supabaseOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

/**
 * Content Security Policy.
 *
 * Privacy: `connect-src` limits fetch/XHR/WebSocket traffic to this site and
 * the Supabase project, so even a bug could not send data anywhere else.
 * User audio is never sent at all (it stays in the browser's memory); this is
 * defense in depth.
 *
 * `'unsafe-inline'` for scripts is what Next.js documents for apps without
 * per-request nonces (nonces would force every page to render dynamically).
 */
function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin();
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${supabase}`.trim(),
    // Reference previews play from Supabase signed URLs.
    `media-src 'self' blob: ${supabase}`.trim(),
    // The analysis Web Worker and AudioWorklet are served from this origin.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          // Only this site may ask for the microphone; camera and location are never used.
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
