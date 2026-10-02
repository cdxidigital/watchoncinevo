/** Shared remote contract. The phone never receives file paths or stream URLs. */

export const REMOTE_CODE_LENGTH = 6;

export type RemoteCommandInput =
  | { type: "toggle" | "play" | "pause" | "stop" }
  | { type: "seek"; to?: number; by?: number }
  | { type: "volume"; value: number }
  | { type: "playTitle"; titleId: string };

export type RemoteCommand = RemoteCommandInput & { id: string };

export type RemoteTitle = { id: string; name: string };

export type RemoteNow = {
  title: string;
  detail: string;
  playing: boolean;
  position: number;
  volume: number;
  titles: RemoteTitle[];
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f]/g;

export function normalizeCode(input: unknown): string {
  const raw = String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return raw.length === REMOTE_CODE_LENGTH ? raw : "";
}

export function formatCode(code: string): string {
  const clean = normalizeCode(code);
  if (!clean) return "";
  return `${clean.slice(0, 3)}-${clean.slice(3)}`;
}

export function makeRemoteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(REMOTE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function clip(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeNow(input: unknown): RemoteNow {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const titles: RemoteTitle[] = [];
  if (Array.isArray(row.titles)) {
    for (const item of row.titles) {
      if (titles.length >= 24) break;
      const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const id = clip(entry.id, 160);
      const name = clip(entry.name, 80);
      if (!id || !name) continue;
      titles.push({ id, name });
    }
  }
  return {
    title: clip(row.title, 120),
    detail: clip(row.detail, 80),
    playing: row.playing === true,
    position: clamp(row.position, 0, 100, 0),
    volume: clamp(row.volume, 0, 1, 1),
    titles,
  };
}

export function sanitizeCommand(input: unknown): RemoteCommand | null {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const type = clip(row.type, 20);
  const id = clip(row.id, 40) || "cmd";
  if (type === "toggle" || type === "play" || type === "pause" || type === "stop") {
    return { id, type };
  }
  if (type === "seek") {
    const command: RemoteCommand = { id, type: "seek" };
    if (row.to !== undefined) command.to = clamp(row.to, 0, 100, 0);
    if (row.by !== undefined) command.by = clamp(row.by, -60, 60, 0);
    if (command.to === undefined && command.by === undefined) return null;
    return command;
  }
  if (type === "volume") return { id, type: "volume", value: clamp(row.value, 0, 1, 1) };
  if (type === "playTitle") {
    const titleId = clip(row.titleId, 160);
    if (!titleId) return null;
    return { id, type: "playTitle", titleId };
  }
  return null;
}

export function parseCommandList(value: unknown): RemoteCommand[] {
  const list = Array.isArray(value) ? value : [];
  const out: RemoteCommand[] = [];
  for (const item of list) {
    const command = sanitizeCommand(item);
    if (command) out.push(command);
    if (out.length >= 24) break;
  }
  return out;
}
