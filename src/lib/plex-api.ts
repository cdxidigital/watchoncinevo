import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  parsePlexMetadata,
  parsePlexResources,
  parsePlexSections,
  rankConnections,
  type PlexServer,
} from "./plex";

function plexHeaders(clientId: string, token?: string) {
  return {
    Accept: "application/json",
    "X-Plex-Product": "CINEVO",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Version": "1.0.0",
    "X-Plex-Platform": "Web",
    "X-Plex-Device": "Web",
    "X-Plex-Device-Name": "CINEVO",
    ...(token ? { "X-Plex-Token": token } : {}),
  };
}

async function plexJson(url: string, headers: Record<string, string>, ms = 8000, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(ms),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> | unknown[];
  if (!res.ok) {
    const row = Array.isArray(data) ? {} : data;
    throw new Error(String(row.error || row.message || `Plex returned ${res.status}`));
  }
  return data;
}

export const plexStartPin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { clientId: string }) => input)
  .handler(async ({ data }) => {
    const clientId = data.clientId.trim();
    if (!clientId) return { ok: false as const, error: "Missing Plex client id." };
    try {
      const body = (await plexJson(
        "https://plex.tv/api/v2/pins?strong=true",
        plexHeaders(clientId),
        8000,
        { method: "POST" },
      )) as Record<string, unknown>;
      const id = Number(body.id);
      const code = String(body.code || "");
      if (!id || !code) return { ok: false as const, error: "Plex did not issue a sign-in pin." };
      return { ok: true as const, id, code };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Could not start Plex sign-in." };
    }
  });

export const plexPollPin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { clientId: string; pinId: number }) => input)
  .handler(async ({ data }) => {
    try {
      const body = (await plexJson(
        `https://plex.tv/api/v2/pins/${data.pinId}`,
        plexHeaders(data.clientId),
        6000,
      )) as Record<string, unknown>;
      const token = typeof body.authToken === "string" ? body.authToken : "";
      return { ok: true as const, token: token || null };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Plex sign-in timed out." };
    }
  });

export const plexListServers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { clientId: string; token: string }) => input)
  .handler(async ({ data }) => {
    const headers = plexHeaders(data.clientId, data.token);
    try {
      const [userRaw, resources] = await Promise.all([
        plexJson("https://plex.tv/api/v2/user", headers),
        plexJson("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1", headers),
      ]);
      const user = userRaw as Record<string, unknown>;
      const servers = parsePlexResources(resources);
      return {
        ok: true as const,
        username: String(user.username || user.title || user.email || "Plex"),
        servers,
      };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Could not list Plex servers." };
    }
  });

export const plexOpenServer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { clientId: string; token: string; server: PlexServer }) => input)
  .handler(async ({ data }) => {
    const token = data.server.accessToken || data.token;
    const ranked = rankConnections(data.server.connections);
    if (!ranked.length) return { ok: false as const, error: "That server has no reachable connections." };
    let last = "Could not reach that Plex server from here.";
    for (const conn of ranked) {
      try {
        const body = await plexJson(
          `${conn.uri}/library/sections`,
          { ...plexHeaders(data.clientId, token), "X-Plex-Token": token },
          conn.local ? 2500 : 6000,
        );
        const sections = parsePlexSections(body);
        return {
          ok: true as const,
          uri: conn.uri,
          kind: conn.relay ? "relay" : conn.local ? "local" : "remote",
          sections,
        };
      } catch (err) {
        last = err instanceof Error ? err.message : last;
      }
    }
    return { ok: false as const, error: last };
  });

async function plexLibraryItems(
  uri: string,
  sectionKey: string,
  headers: Record<string, string>,
  sourceLabel: string,
) {
  const titles: ReturnType<typeof parsePlexMetadata> = [];
  const queue: Array<{ url: string; depth: number }> = [
    { url: `${uri}/library/sections/${encodeURIComponent(sectionKey)}/all`, depth: 0 },
  ];
  const visited = new Set<string>();
  let pages = 0;

  while (queue.length && pages < 500) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) continue;
    visited.add(current.url);
    const pageSize = 200;
    const body = await plexJson(
      `${current.url}${current.url.includes("?") ? "&" : "?"}X-Plex-Container-Start=0&X-Plex-Container-Size=${pageSize}`,
      headers,
      20000,
    );
    const parsed = parsePlexMetadata(body, sourceLabel);
    titles.push(...parsed);
    pages += 1;

    const container = (body as { MediaContainer?: Record<string, unknown> })?.MediaContainer;
    const total = Number(container?.totalSize || container?.size || parsed.length);
    if (total > pageSize) {
      for (let start = pageSize; start < total && start < 10000; start += pageSize) {
        queue.push({
          url: `${current.url}${current.url.includes("?") ? "&" : "?"}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
          depth: current.depth,
        });
      }
    }

    const metadata = Array.isArray(container?.Metadata) ? container.Metadata : [];
    if (current.depth < 3) {
      for (const item of metadata) {
        const row = item as Record<string, unknown>;
        const type = String(row.type || "");
        const ratingKey = String(row.ratingKey || "");
        if (!ratingKey || (type !== "show" && type !== "season")) continue;
        queue.push({ url: `${uri}/library/metadata/${encodeURIComponent(ratingKey)}/children`, depth: current.depth + 1 });
      }
    }
  }
  return titles;
}

export const plexImportSections = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { clientId: string; token: string; uri: string; sourceLabel: string; sectionKeys: string[] }) => input)
  .handler(async ({ data }) => {
    const headers = { ...plexHeaders(data.clientId, data.token), "X-Plex-Token": data.token };
    try {
      const titles: ReturnType<typeof parsePlexMetadata> = [];
      for (const key of data.sectionKeys.slice(0, 12)) {
        titles.push(...(await plexLibraryItems(data.uri, key, headers, data.sourceLabel)));
      }
      const seen = new Set<string>();
      const unique = titles.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
      return { ok: true as const, titles: unique };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Could not import that Plex library." };
    }
  });
