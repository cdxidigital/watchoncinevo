import type { Accent, Kind, Title } from "./catalog";

export const VIDEO_EXT = /\.(mp4|mkv|mov|avi|webm|m4v|wmv|ts|m2ts)$/i;

export type SourceKind = "cinevo" | "folder" | "plex" | "jellyfin" | "shared";

export type LibSource = {
  id: string;
  kind: Exclude<SourceKind, "cinevo">;
  name: string;
  path?: string;
  baseUrl?: string;
  accessToken?: string;
  userId?: string;
  selected: boolean;
  count: number;
};

export type LibraryTitle = Title & {
  source: SourceKind;
  sourceLabel: string;
  path?: string;
};

const blobs = new Map<string, string>();

export function mediaUrl(id: string) {
  return blobs.get(id);
}

export function playableCount() {
  return blobs.size;
}

export function rememberBlob(id: string, file: File) {
  const prev = blobs.get(id);
  if (prev) URL.revokeObjectURL(prev);
  const url = URL.createObjectURL(file);
  blobs.set(id, url);
  return url;
}

export function forgetBlob(id: string) {
  const prev = blobs.get(id);
  if (!prev) return;
  URL.revokeObjectURL(prev);
  blobs.delete(id);
}

export function forgetAllBlobs() {
  for (const url of blobs.values()) URL.revokeObjectURL(url);
  blobs.clear();
}

export function parseFilename(fileName: string) {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  let stem = base.replace(VIDEO_EXT, "");
  const yearHit = /\(?((?:19|20)\d{2})\)?/.exec(stem);
  const year = yearHit ? yearHit[1] : "";
  stem = stem
    .replace(/[._]+/g, " ")
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b(1080p|720p|2160p|480p|4k|uhd|hdr|bluray|webrip|web-dl|x264|x265|hevc|dts|aac|remux)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title: stem || base.replace(VIDEO_EXT, ""), year, fileName: base };
}

export function parseMediaFilename(fileName: string) {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  const parsed = parseFilename(base);
  const rawStem = base.replace(VIDEO_EXT, "");
  const clean = rawStem.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const episodeHit =
    /\bS(?<season>\d{1,2})\s*E(?<episode>\d{1,3})(?:\s*(?:-|–|—)\s*(?<name>.+))?/i.exec(clean) ||
    /\b(?<season>\d{1,2})x(?<episode>\d{1,3})(?:\s*(?:-|–|—)\s*(?<name>.+))?/i.exec(clean);
  if (!episodeHit?.groups) return { ...parsed, kind: "movie" as const };

  const season = Number(episodeHit.groups.season);
  const episode = Number(episodeHit.groups.episode);
  const before = clean.slice(0, episodeHit.index).trim();
  const after = (episodeHit.groups.name || clean.slice(episodeHit.index + episodeHit[0].length)).trim();
  const seriesTitle =
    tidyTitle(before.replace(/\b(?:season|series)\s*\d{1,2}\b/gi, "")) ||
    inferSeriesTitle(fileName) ||
    parsed.title;
  const episodeTitle = tidyTitle(
    after
      .replace(/\b(?:1080p|720p|2160p|480p|4k|uhd|hdr|bluray|webrip|web-dl|x264|x265|hevc|dts|aac|remux)\b/gi, "")
      .replace(/\b(?:19|20)\d{2}\b/g, ""),
  );
  const code = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  return {
    ...parsed,
    kind: "series" as const,
    title: episodeTitle ? `${seriesTitle} - ${code} - ${episodeTitle}` : `${seriesTitle} - ${code}`,
    seriesTitle,
    episodeTitle,
    season,
    episode,
  };
}

function tidyTitle(value: string) {
  return value
    .replace(/[._]+/g, " ")
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\s*(?:-|–|—)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSeriesTitle(fileName: string) {
  const parts = fileName.split(/[/\\]/).filter(Boolean);
  if (parts.length < 2) return "";
  const folders = parts.slice(0, -1).map(tidyTitle).filter(Boolean);
  for (let i = folders.length - 1; i >= 0; i -= 1) {
    const name = folders[i];
    if (/^(season|series)\s*\d{1,3}$/i.test(name) || /^s\d{1,3}$/i.test(name)) continue;
    return name;
  }
  return "";
}

export function fileRelativePath(file: File) {
  return (
    file.webkitRelativePath ||
    (file as File & { cinevoRelativePath?: string }).cinevoRelativePath ||
    file.name
  );
}

export function isVideoFile(name: string) {
  return VIDEO_EXT.test(name);
}

const ACCENTS: Accent[] = ["cyan", "magenta", "violet", "amber"];

export function titleFromFile(file: File, folderName: string, index: number): LibraryTitle {
  const relPath = fileRelativePath(file);
  const parsed = parseMediaFilename(relPath);
  const id = `folder-${hash(`${folderName}:${relPath}:${file.size}`)}`;
  rememberBlob(id, file);
  const accent = ACCENTS[index % ACCENTS.length];
  const seriesGenres =
    parsed.kind === "series"
      ? ["Home library", parsed.seriesTitle, `Season ${parsed.season}`]
      : ["Home library", folderName];
  return {
    id,
    title: parsed.title,
    kind: parsed.kind,
    year: parsed.year || "—",
    runtime: file.size > 2_000_000_000 ? "2h+" : file.size > 700_000_000 ? "~2h" : "~90m",
    genre: parsed.kind === "series" ? parsed.seriesTitle : "Home library",
    genres: seriesGenres,
    synopsis:
      parsed.kind === "series"
        ? `Episode ${parsed.episode} from season ${parsed.season} of ${parsed.seriesTitle}. Imported from ${folderName}.`
        : `Imported from ${folderName}. File stays on this device — CINEVO only indexes the name.`,
    cast: [],
    director: parsed.kind === "series" ? `Season ${parsed.season}` : folderName,
    rating: 0,
    addedAt: new Date().toISOString().slice(0, 10),
    poster: makePoster(parsed.title, accent),
    still: "/stills/theater.jpg",
    accent,
    source: "folder",
    sourceLabel: folderName,
    path: relPath,
  };
}

export function scanFileList(files: FileList | File[], folderName = "Home folder"): LibraryTitle[] {
  const list = Array.from(files).filter((f) => isVideoFile(f.name) || isVideoFile(fileRelativePath(f)));
  const name = folderName || guessFolder(list) || "Home folder";
  return list.slice(0, 1000).map((file, i) => titleFromFile(file, name, i));
}

function guessFolder(files: File[]) {
  const rel = files.map(fileRelativePath).find((path) => path.includes("/")) || "";
  return rel.split("/")[0] || "";
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function makePoster(title: string, accent: Accent) {
  if (typeof document === "undefined") return "/stills/theater.jpg";
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 600;
  const ctx = c.getContext("2d");
  if (!ctx) return "/stills/theater.jpg";
  const ink: Record<Accent, string> = {
    cyan: "#f5f5f5",
    magenta: "#3b7bff",
    violet: "#8aa0c4",
    amber: "#d6d0c4",
  };
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(0, 0, 400, 600);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(18, 18, 364, 564);
  ctx.fillStyle = ink[accent] || "#f5f5f5";
  ctx.font = "800 28px Inter, system-ui, sans-serif";
  wrapText(ctx, title, 36, 250, 328, 34);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  ctx.fillText("CINEVO", 36, 560);
  return c.toDataURL("image/jpeg", 0.85);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else line = next;
  }
  if (line) ctx.fillText(line, x, yy);
}

export function remoteTitle(input: {
  id: string;
  title: string;
  year?: string;
  kind?: Kind;
  synopsis?: string;
  source: "plex" | "jellyfin" | "shared";
  sourceLabel: string;
  genre?: string;
  genres?: string[];
  path?: string;
  runtime?: string;
  rating?: number;
  cast?: string[];
  director?: string;
  poster?: string;
  still?: string;
}): LibraryTitle {
  const accent: Accent = input.source === "plex" ? "amber" : input.source === "shared" ? "magenta" : "violet";
  const label = input.source === "plex" ? "Plex" : input.source === "jellyfin" ? "Jellyfin" : "Shared";
  const genres = input.genres?.length ? input.genres : [input.genre || label, input.sourceLabel];
  return {
    id: input.id,
    title: input.title,
    kind: input.kind ?? "movie",
    year: input.year || "—",
    runtime: input.runtime || "—",
    genre: input.genre || genres[0] || label,
    genres,
    synopsis:
      input.synopsis ||
      (input.source === "shared"
        ? `Indexed from ${input.sourceLabel}. Playback stays on the original server.`
        : `Indexed from ${input.sourceLabel}. CINEVO can proxy playback from this server.`),
    cast: input.cast || [],
    director: input.director || input.sourceLabel,
    rating: input.rating || 0,
    addedAt: new Date().toISOString().slice(0, 10),
    poster: input.poster || makePoster(input.title, accent),
    still: input.still || input.poster || "/stills/theater.jpg",
    accent,
    source: input.source,
    sourceLabel: input.sourceLabel,
    path: input.path,
  };
}

export function applySourceFilter(
  filter: "all" | "folder" | "plex" | "jellyfin" | "shared",
  local: LibraryTitle[],
  remote: LibraryTitle[],
) {
  const all = [...local, ...remote];
  if (filter === "all") return all;
  return all.filter((t) => t.source === filter);
}

export function sourceForTitle(title: { source?: string; sourceLabel?: string }, sources: LibSource[]) {
  const kind = title.source;
  const label = title.sourceLabel;
  if (!kind || !label) return undefined;
  return sources.find((s) => {
    if (s.kind !== kind) return false;
    if (s.name === label) return true;
    const handle = s.name.replace(/^@/, "");
    return label.startsWith(`${handle} ·`) || label.startsWith(`${s.name} ·`);
  });
}

export const THEMES = [
  { id: "ink", label: "Ink", feel: "Clear black glass", accent: "#f4f7fb" },
  { id: "harbor", label: "Harbor", feel: "Night glass, cyan edge", accent: "#7ad7ff" },
  { id: "lilac", label: "Lilac", feel: "Violet glass", accent: "#e4d6ff" },
  { id: "ember", label: "Ember", feel: "Warm lamp glass", accent: "#ffd0b4" },
  { id: "grove", label: "Grove", feel: "Quiet green glass", accent: "#b7f3d4" },
  { id: "rose", label: "Rose", feel: "Dusk rose glass", accent: "#ffc1cf" },
  { id: "gilt", label: "Gilt", feel: "Champagne on charcoal", accent: "#f0d7a4" },
  { id: "day", label: "Day", feel: "Frosted paper", accent: "#0c5f72" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function migrateTheme(id?: string): ThemeId {
  if (id === "noir") return "ink";
  if (id === "pulse" || id === "nova") return "harbor";
  if (id === "violet") return "lilac";
  if (id === "sage") return "grove";
  if (id === "iris" || id === "paper" || id === "day") return "day";
  if (id === "ember" || id === "rose" || id === "gilt" || id === "ink" || id === "harbor" || id === "lilac" || id === "grove") {
    return id;
  }
  return "harbor";
}
