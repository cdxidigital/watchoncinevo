/**
 * "Auth not configured" contract (isomorphic, no server imports).
 *
 * In production, auth refuses to start without a real `BETTER_AUTH_SECRET`
 * (see `server.ts`). Instead of crashing the whole server or signing sessions
 * with a random fallback, auth is switched OFF: public pages keep rendering,
 * `/api/auth/*` answers 503 with this message, and anything that needs a
 * signed-in user fails closed with `AuthNotConfiguredError` (status 503)
 * rather than an unhandled 500.
 */
export const AUTH_NOT_CONFIGURED_CODE = "AUTH_NOT_CONFIGURED";

export const AUTH_NOT_CONFIGURED_MESSAGE =
  "Sign-in is unavailable: authentication is not configured on this server.";

/**
 * Production must never mint a signing secret. Empty or whitespace-only values
 * count as missing. Dev and live preview are allowed to use a process-stable
 * fallback (see `previewAuthSecret` in `server.ts`).
 */
export function authDisabledForMissingSecret(
  nodeEnv: string | undefined,
  secret: string | undefined,
): boolean {
  return nodeEnv === "production" && !secret?.trim();
}

/** Thrown when a request needs auth but the server has auth disabled for missing config. */
export class AuthNotConfiguredError extends Error {
  readonly status = 503;
  readonly code = AUTH_NOT_CONFIGURED_CODE;
  constructor() {
    super(AUTH_NOT_CONFIGURED_MESSAGE);
    this.name = "AuthNotConfiguredError";
  }
}

/** Narrowing helper that also works across module/bundle boundaries. */
export function isAuthNotConfiguredError(error: unknown): error is AuthNotConfiguredError {
  return (
    error instanceof AuthNotConfiguredError ||
    (error instanceof Error && error.name === "AuthNotConfiguredError")
  );
}

/** The 503 response auth endpoints return while auth is not configured. */
export function authNotConfiguredResponse(): Response {
  return new Response(
    JSON.stringify({ code: AUTH_NOT_CONFIGURED_CODE, message: AUTH_NOT_CONFIGURED_MESSAGE }),
    {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": "300",
      },
    },
  );
}
