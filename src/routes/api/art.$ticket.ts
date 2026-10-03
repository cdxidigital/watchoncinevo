import { createFileRoute } from "@tanstack/react-router";
import { safeArtPath } from "@/lib/artwork-model";
import { loadTicket } from "@/lib/playback.server";
import { serverAddressError } from "@/lib/playback-urls";
import { getSessionUser } from "@/lib/auth/verify.server";

export const Route = createFileRoute("/api/art/$ticket")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await getSessionUser();
        if (!user) return new Response("Unauthorized", { status: 401 });
        const path = safeArtPath(new URL(request.url).searchParams.get("path") || "");
        if (!path) return new Response("No artwork", { status: 404 });
        const ticket = await loadTicket(params.ticket, user.id);
        if (!ticket) return new Response("Artwork expired", { status: 410 });
        const base = ticket.url.replace(/\/$/, "");
        let upstream: Response | null = null;
        try {
          let target = `${base}${path}`;
          for (let redirects = 0; redirects <= 3; redirects += 1) {
            if (serverAddressError(target)) throw new Error("Blocked artwork address");
            upstream = await fetch(target, {
              headers: ticket.headers,
              redirect: "manual",
              signal: AbortSignal.timeout(12000),
            });
            if (upstream.status < 300 || upstream.status >= 400) break;
            const location = upstream.headers.get("location");
            if (!location || redirects === 3) throw new Error("Too many artwork redirects");
            target = new URL(location, target).toString();
          }
        } catch {
          return new Response("Artwork unavailable", { status: 502 });
        }
        if (!upstream) return new Response("Artwork unavailable", { status: 502 });
        const type = upstream.headers.get("content-type") || "";
        if (!upstream.ok || (type && !type.startsWith("image/"))) {
          return new Response("Artwork unavailable", { status: 502 });
        }
        const out = new Headers();
        if (type) out.set("Content-Type", type);
        const length = upstream.headers.get("content-length");
        if (length) out.set("Content-Length", length);
        out.set("Cache-Control", "private, max-age=86400");
        return new Response(upstream.body, { status: 200, headers: out });
      },
    },
  },
});
