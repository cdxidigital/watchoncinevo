export function isLoopbackUrl(url?: string) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}

/** Reject schemes and cloud-metadata hosts. Private LAN addresses stay allowed. */
export function serverAddressError(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "That server address is not allowed.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "That server address is not allowed.";
  const host = url.hostname.toLowerCase();
  if (host === "169.254.169.254" || host === "metadata.google.internal") return "That server address is not allowed.";
  return null;
}

export type PlaybackFit = "original" | "compatible";

export function plexStreamTarget(
  uri: string,
  ratingKey: string,
  token: string,
  clientId: string,
  fit: PlaybackFit = "original",
) {
  const key = ratingKey.replace(/^plex-/, "").replace(/^\//, "");
  const client = clientId || "cinevo-web";
  const compatible = fit === "compatible";
  const params = new URLSearchParams({
    hasMDE: "1",
    path: `/library/metadata/${key}`,
    mediaIndex: "0",
    partIndex: "0",
    protocol: "http",
    fastSeek: "1",
    directPlay: compatible ? "0" : "1",
    directStream: compatible ? "0" : "1",
    directStreamAudio: compatible ? "0" : "1",
    videoQuality: compatible ? "80" : "99",
    maxVideoBitrate: compatible ? "20000" : "200000",
    location: "lan",
    mediaBufferSize: compatible ? "10240" : "20480",
    subtitleSize: "100",
    audioBoost: "100",
    autoAdjustQuality: "0",
    copyts: "1",
    offset: "0",
    session: `cinevo-${key}`.slice(0, 48),
    "X-Plex-Product": "CINEVO",
    "X-Plex-Client-Identifier": client,
    "X-Plex-Platform": "Chrome",
    "X-Plex-Version": "1.0.0",
    "X-Plex-Token": token,
  });
  if (compatible) {
    params.set("videoCodec", "h264");
    params.set("audioCodec", "aac");
    params.set("videoResolution", "1920x1080");
  }
  return {
    url: `${uri.replace(/\/$/, "")}/video/:/transcode/universal/start.mp4?${params.toString()}`,
    headers: {
      "X-Plex-Token": token,
      "X-Plex-Product": "CINEVO",
      "X-Plex-Client-Identifier": client,
      "X-Plex-Platform": "Chrome",
      Accept: "*/*",
    },
  };
}

export function jellyfinStreamTarget(
  base: string,
  itemId: string,
  token: string,
  clientId: string,
  fit: PlaybackFit = "original",
) {
  const id = itemId.replace(/^jellyfin-/, "").replace(/^jf-/, "");
  const client = clientId || "cinevo-web";
  const compatible = fit === "compatible";
  const params = new URLSearchParams({
    static: compatible ? "false" : "true",
    mediaSourceId: id,
    MaxStreamingBitrate: compatible ? "20000000" : "200000000",
    api_key: token,
  });
  if (compatible) {
    params.set("VideoCodec", "h264");
    params.set("AudioCodec", "aac");
    params.set("Container", "mp4");
  }
  return {
    url: `${base.replace(/\/$/, "")}/Videos/${encodeURIComponent(id)}/stream.mp4?${params.toString()}`,
    headers: {
      "X-Emby-Token": token,
      Authorization: `MediaBrowser Client="CINEVO", Device="Web", DeviceId="${client}", Version="1.0.0", Token="${token}"`,
      Accept: "*/*",
    },
  };
}

/** Token stays on the Authorization header so it is not written into the stream URL. */
export function nodeStreamTarget(base: string, token: string, filePath: string, id?: string) {
  const params = new URLSearchParams({ path: filePath });
  if (id) params.set("id", id);
  return {
    url: `${base.replace(/\/$/, "")}/v1/play?${params.toString()}`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "*/*",
    },
  };
}
