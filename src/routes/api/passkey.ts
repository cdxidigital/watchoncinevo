import { createFileRoute } from "@tanstack/react-router";
import { approveDesk, loginPasskey, newChallenge, openDesk, readDesk, registerPasskey } from "@/lib/passkey.server";
import { pageOrigin, passkeyHostError } from "@/lib/passkey-crypto";
import { AUTH_NOT_CONFIGURED_CODE, AUTH_NOT_CONFIGURED_MESSAGE } from "@/lib/auth/unavailable";
import { isAuthNotConfiguredError } from "@/lib/auth/verify.server";
import { passkeyRequestSchema } from "@/lib/validators";

function json(body: unknown, status = 200, cookie?: string) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export const Route = createFileRoute("/api/passkey")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = new URL(request.url).searchParams.get("desk") || "";
        if (!secret) return json({ error: "Missing code." }, 400);
        return json(await readDesk(secret));
      },
      POST: async ({ request }) => {
        const where = pageOrigin(request);
        const origin = request.headers.get("origin");
        if (!where || (origin && origin !== where.origin)) {
          return json({ error: "This page could not confirm its address. Reload and try again." }, 400);
        }
        let rawBody: unknown;
        try {
          rawBody = await request.json();
        } catch {
          return json({ error: "Missing request." }, 400);
        }
        const parsed = passkeyRequestSchema.safeParse(rawBody);
        if (!parsed.success) return json({ error: "Invalid request." }, 400);
        const body = parsed.data;
        const normalizedBody = { ...body, algorithm: body.algorithm === undefined ? undefined : Number(body.algorithm) };
        const webauthn = body.action === "challenge" || body.action === "register" || body.action === "login";
        if (webauthn) {
          const hostError = passkeyHostError(where.rpId);
          if (hostError) return json({ error: hostError }, 400);
        }
        try {
          if (body.action === "challenge") {
            const challenge = await newChallenge();
            return json({ ...challenge, rpId: where.rpId });
          }
          if (body.action === "register") {
            const session = await registerPasskey(request, normalizedBody);
            return json({ token: session.token }, 200, session.cookie);
          }
          if (body.action === "login") {
            const session = await loginPasskey(request, normalizedBody);
            return json({ token: session.token }, 200, session.cookie);
          }
          if (body.action === "desk") {
            return json(await openDesk());
          }
          if (body.action === "approve") {
            await approveDesk(request, body.secret || "");
            return json({ ok: true });
          }
          return json({ error: "Unknown request." }, 400);
        } catch (error) {
          if (isAuthNotConfiguredError(error)) {
            return json(
              {
                code: AUTH_NOT_CONFIGURED_CODE,
                message: AUTH_NOT_CONFIGURED_MESSAGE,
                error: AUTH_NOT_CONFIGURED_MESSAGE,
              },
              503,
            );
          }
          console.error("[passkey] request failed", error);
          return json({ error: "Passkey verification failed. Try again." }, 400);
        }
      },
    },
  },
});

