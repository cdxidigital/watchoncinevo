import { getBearerToken } from "@/lib/auth/client";
import { formatCode, normalizeCode, type RemoteCommand, type RemoteCommandInput, type RemoteNow } from "@/lib/remote-protocol";

const HOUSE_CODE = "cinevo-house-code";

export function readHouseCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeCode(sessionStorage.getItem(HOUSE_CODE));
  } catch {
    return "";
  }
}

export function writeHouseCode(code: string) {
  const clean = normalizeCode(code);
  try {
    if (clean) sessionStorage.setItem(HOUSE_CODE, clean);
    else sessionStorage.removeItem(HOUSE_CODE);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent("cinevo-house-code", { detail: clean }));
}

export function formatHouseCode(code: string) {
  return formatCode(code);
}

function headers(): HeadersInit {
  const token = getBearerToken();
  return {
    "content-type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function post(body: unknown): Promise<{ ok: boolean; error?: string; code?: string; commands?: RemoteCommand[] }> {
  const res = await fetch("/api/remote", {
    method: "POST",
    headers: headers(),
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    code?: string;
    commands?: RemoteCommand[];
  };
  return { ok: Boolean(data.ok), error: data.error, code: data.code, commands: data.commands };
}

export function openHouseRemote(code = readHouseCode()) {
  return post({ action: "open", code });
}

export function rotateHouseRemote() {
  return post({ action: "rotate" });
}

export function closeHouseRemote(code: string) {
  return post({ action: "close", code });
}

export function syncHouseRemote(code: string, now: RemoteNow) {
  return post({ action: "sync", code, now });
}

export async function sendRemoteCommand(code: string, command: RemoteCommandInput) {
  const res = await fetch("/api/remote", {
    method: "POST",
    headers: headers(),
    credentials: "same-origin",
    body: JSON.stringify({ action: "command", code, command: { ...command, id: `p-${Date.now()}` } }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return { ok: Boolean(data.ok), error: data.error };
}

export async function readPhoneRemote(code: string): Promise<{
  ok: boolean;
  error?: string;
  now?: RemoteNow;
  ageMs?: number;
}> {
  const res = await fetch(`/api/remote?code=${encodeURIComponent(normalizeCode(code))}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; now?: RemoteNow; ageMs?: number };
  return { ok: Boolean(data.ok), error: data.error, now: data.now, ageMs: data.ageMs };
}
