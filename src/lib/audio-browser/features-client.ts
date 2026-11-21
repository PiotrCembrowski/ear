/**
 * Fetches reference features (never audio) from our API and keeps them for
 * the rest of the visit, so switching back and forth doesn't refetch.
 */
import type { InstrumentFeaturesResponse, ReferenceFeaturesResponse } from "./reference-data";

export class FeaturesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FeaturesError";
  }
}

const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(url: string): Promise<T> {
  const cached = cache.get(url);
  if (cached) return cached as Promise<T>;
  const request = (async () => {
    let response: Response;
    try {
      response = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
    } catch {
      throw new FeaturesError("Couldn't reach the server. Check your connection and try again.", 0);
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new FeaturesError(body.error ?? "Something went wrong loading the reference.", response.status);
    return body as T;
  })();
  cache.set(url, request);
  request.catch(() => cache.delete(url)); // don't keep failures
  return request;
}

export function fetchReferenceFeatures(referenceId: string): Promise<ReferenceFeaturesResponse> {
  return getJson(`/api/references/${encodeURIComponent(referenceId)}/features`);
}

export function fetchInstrumentFeatures(instrumentId: string, variant: string | null): Promise<InstrumentFeaturesResponse> {
  const query = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  return getJson(`/api/instruments/${encodeURIComponent(instrumentId)}/features${query}`);
}
