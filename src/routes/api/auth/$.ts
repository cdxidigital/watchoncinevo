import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { authNotConfiguredResponse } from "@/lib/auth/unavailable";

// `auth` is null when production auth is not configured (no BETTER_AUTH_SECRET):
// answer a clear 503 instead of crashing or running auth without a real secret.
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => (auth ? auth.handler(request) : authNotConfiguredResponse()),
      POST: ({ request }) => (auth ? auth.handler(request) : authNotConfiguredResponse()),
    },
  },
});
