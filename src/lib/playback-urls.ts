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
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ADDRESS_ERROR = "That server address is not allowed.";

function isBlockedAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    return (
      octets[0] === 127 ||
      octets[0] === 169 && octets[1] === 254 ||
      octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
    );
  }
  return normalized === "::1" || normalized === "fd00:ec2::254" || normalized.startsWith("fe80:") || normalized.startsWith("fd");
}

/** Validate the resolved destination too, preventing DNS names from bypassing metadata protection. */
export async function serverAddressError(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return ADDRESS_ERROR;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return ADDRESS_ERROR;
  if (url.username || url.password) return "Credentials must not be embedded in the server address.";

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedAddress(host)) return ADDRESS_ERROR;
  try {
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map(({ address }) => address);
    if (addresses.some(isBlockedAddress)) return ADDRESS_ERROR;
  } catch {
    return "That server address could not be resolved.";
  }
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
    directPlay: "0",
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
