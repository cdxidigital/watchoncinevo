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
  if (url.username || url.password) return "Credentials must not be embedded in the server address.";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blockedHosts = new Set([
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.google",
    "100.100.100.200",
    "fd00:ec2::254",
  ]);
  if (blockedHosts.has(host)) return "That server address is not allowed.";
  return null;
}

export type PlaybackFit = "original" | "compatible" | "safe";

function playbackLocation(uri: string) {
  try {
    const host = new URL(uri).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return "lan";
    }
  } catch {
    /* fall through to wan */
  }
  return "wan";
}

export function plexStreamTarget(
  uri: string,
  ratingKey: string,
  token: string,
  clientId: string,
  fit: PlaybackFit = "original",
) {
  const key = ratingKey.replace(/^plex-/, "").replace(/^\//, "");
  const client = clientId || "cinevo-web";
  const compatible = fit !== "original";
  const safe = fit === "safe";
  const location = playbackLocation(uri);
  const params = new URLSearchParams({
    hasMDE: "1",
    path: `/library/metadata/${key}`,
    mediaIndex: "0",
    partIndex: "0",
    protocol: "http",
    fastSeek: "1",
    directPlay: "0",
    directStream: compatible ? "0" : "1",
    directStreamAudio: compatible ? "0" : "1",
    videoQuality: safe ? "60" : compatible ? "80" : "99",
    maxVideoBitrate: safe ? "8000" : compatible ? "20000" : "200000",
    location,
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
    params.set("videoProfile", safe ? "baseline" : "main");
    params.set("audioCodec", "aac");
    params.set("audioChannels", "2");
    params.set("container", "mp4");
    params.set("videoResolution", safe ? "1280x720" : "1920x1080");
    params.set("subtitleStreamID", "-1");
    params.set("copyts", "0");
    params.set("directStreamAudio", "0");
    params.set("protocol", "http");
    params.set("X-Plex-Device", "Chrome");
    params.set("X-Plex-Device-Name", "CINEVO Web");
    params.set("X-Plex-Provides", "player");
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
  const compatible = fit !== "original";
  const safe = fit === "safe";
  const params = new URLSearchParams({
    Static: compatible ? "false" : "true",
    MaxStreamingBitrate: safe ? "8000000" : compatible ? "20000000" : "200000000",
    api_key: token,
  });
  if (compatible) {
    params.set("VideoCodec", "h264");
    params.set("AudioCodec", "aac");
    params.set("Container", "mp4");
    params.set("SubtitleMethod", "Drop");
    params.set("TranscodingMaxAudioChannels", "2");
    params.set("AudioBitRate", "192000");
    params.set("VideoBitRate", safe ? "8000000" : "20000000");
    params.set("MaxWidth", safe ? "1280" : "1920");
    params.set("MaxHeight", safe ? "720" : "1080");
    params.set("RequireAvc", "false");
    params.set("EnableAutoStreamCopy", "false");
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
