import { createFileRoute } from "@tanstack/react-router";
import { loadTicket } from "@/lib/playback.server";
import { serverAddressError } from "@/lib/playback-urls";
import { getSessionUser } from "@/lib/auth/verify.server";

function isVideoResponse(status: number, type: string) {
  if (status !== 200 && status !== 206) return false;
  if (!type) return true;
  return !/xml|html|json|text\/plain/i.test(type);
}

function isLiveTranscode(url: string) {
  return /\/transcode\//i.test(url) || /[?&]Static=false(?:&|$)/i.test(url);
}

function upstreamHeaders(ticketHeaders: Record<string, string>, range: string, url: string) {
  const headers = new Headers(ticketHeaders);
  headers.set("Accept-Encoding", "identity");
  // Plex/Jellyfin live transcoders are sequential streams, not static byte-range
  // files. Forwarding the browser's Range request can make the transcoder return
  // 416/5xx or restart repeatedly before the <video> element can initialise.
  if (range && !isLiveTranscode(url)) headers.set("Range", range);
  else headers.delete("Range");
  return headers;
}

async function fetchMedia(url: string, init: RequestInit) {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (serverAddressError(current)) throw new Error("Blocked media address");
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new Error("Too many media redirects");
    current = new URL(location, current).toString();
  }
  throw new Error("Too many media redirects");
}

function passHeaders(upstream: Response, download: boolean, liveTranscode = false) {
  const out = new Headers();
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition"]) {
    const value = upstream.headers.get(key);
    if (value) out.set(key, value);
  }
  if (liveTranscode) out.delete("Accept-Ranges");
  else if (!out.has("Accept-Ranges")) out.set("Accept-Ranges", "bytes");
  if (!out.has("Content-Type")) out.set("Content-Type", "video/mp4");
  out.set("Cache-Control", "private, no-transform, max-age=7200");
  if (download) out.set("Content-Disposition", 'attachment; filename="cinevo-original.mp4"');
  return out;
}

export const Route = createFileRoute("/api/stream/$ticket")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await getSessionUser();
        if (!user) return new Response("Unauthorized", { status: 401 });
        const ticket = await loadTicket(params.ticket, user.id);
        if (!ticket) return new Response("Playback expired", { status: 410 });
        const download = new URL(request.url).searchParams.get("download") === "1";
        const range = request.headers.get("range") || "";
        let upstream: Response;
        try {
          upstream = await fetchMedia(ticket.url, {
            headers: upstreamHeaders(ticket.headers, range, ticket.url),
          });
        } catch {
          return new Response("CINEVO could not reach that media server.", { status: 502 });
        }
        const type = upstream.headers.get("content-type") || "";
        if (!isVideoResponse(upstream.status, type)) {
          return new Response("The media server did not return a video stream.", { status: 502 });
        }
        return new Response(upstream.body, {
          status: upstream.status,
          headers: passHeaders(upstream, download, isLiveTranscode(ticket.url)),
        });
      },
      HEAD: async ({ request, params }) => {
        const user = await getSessionUser();
        if (!user) return new Response(null, { status: 401 });
        const ticket = await loadTicket(params.ticket, user.id);
        if (!ticket) return new Response(null, { status: 410 });
        const range = request.headers.get("range") || "";
        try {
          let upstream = await fetchMedia(ticket.url, {
            method: "HEAD",
            headers: upstreamHeaders(ticket.headers, range, ticket.url),
          });
          if (upstream.status === 405 || upstream.status === 501) {
            upstream = await fetchMedia(ticket.url, {
              method: "GET",
              headers: upstreamHeaders(ticket.headers, range || "bytes=0-1", ticket.url),
            });
            await upstream.body?.cancel();
          }
          if (upstream.status !== 200 && upstream.status !== 206) {
            return new Response(null, { status: 502 });
          }
          return new Response(null, {
            status: upstream.status,
            headers: passHeaders(upstream, false, isLiveTranscode(ticket.url)),
          });
        } catch {
          return new Response(null, { status: 502 });
        }
      },
    },
  },
});
