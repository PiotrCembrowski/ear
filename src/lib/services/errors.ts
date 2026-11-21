/**
 * Thrown by services when a database/storage/auth call fails unexpectedly.
 * The original error is kept in `cause` for server logs; `message` is safe
 * to log but is NOT shown to users (pages show their own friendly text).
 */
export class ServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ServiceError";
  }
}
