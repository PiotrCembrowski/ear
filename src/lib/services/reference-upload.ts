/**
 * Browser side of reference uploads: sends a normalized WAV to the signed
 * upload URL our server created (the file never passes through our server,
 * which avoids serverless request-size limits). Admin-only in practice: only
 * admins can obtain an upload token.
 */
import { REFERENCES_BUCKET } from "@/lib/config/app-config";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export async function uploadReferenceWav(target: { path: string; token: string }, wav: Uint8Array): Promise<void> {
  const body = new Blob([wav as BlobPart], { type: "audio/wav" });
  const { error } = await getBrowserSupabase().storage.from(REFERENCES_BUCKET).uploadToSignedUrl(target.path, target.token, body, { contentType: "audio/wav" });
  if (error) throw new Error(error.message);
}
