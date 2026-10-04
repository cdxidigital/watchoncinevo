import { getSql } from "@/lib/db";
import {
  makeRemoteCode,
  normalizeCode,
  parseCommandList,
  sanitizeCommand,
  sanitizeNow,
  type RemoteCommand,
  type RemoteNow,
} from "@/lib/remote-protocol";


function asJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

export async function openRemote(userId: string, preferred?: string): Promise<{ code: string; expiresAt: string }> {
  const sql = await getSql();
  await sql`delete from cinevo_remotes where expires_at < now()`;
  const wanted = normalizeCode(preferred);
  if (wanted) {
    const existing = await sql<{ code: string; expires_at: string | Date }>`
      select code, expires_at from cinevo_remotes
      where code = ${wanted} and user_id = ${userId} and expires_at > now()
    `;
    const row = existing[0];
    if (row) return { code: row.code, expiresAt: new Date(row.expires_at).toISOString() };
  }
  await sql`delete from cinevo_remotes where user_id = ${userId}`;
  const code = makeRemoteCode();
  const rows = await sql<{ expires_at: string | Date }>`
    insert into cinevo_remotes (code, user_id, expires_at)
    values (${code}, ${userId}, now() + interval '12 hours')
    returning expires_at
  `;
  return { code, expiresAt: new Date(rows[0].expires_at).toISOString() };
}

export async function closeRemote(userId: string, code: string): Promise<void> {
  const sql = await getSql();
  const clean = normalizeCode(code);
  if (!clean) return;
  await sql`delete from cinevo_remotes where code = ${clean} and user_id = ${userId}`;
}

export async function syncRemote(
  userId: string,
  code: string,
  now: RemoteNow,
): Promise<RemoteCommand[]> {
  const sql = await getSql();
  const clean = normalizeCode(code);
  if (!clean) return [];
  const payload = JSON.stringify({ ...sanitizeNow(now), updatedAt: Date.now() });
  const rows = await sql<{ queue_json: unknown }>`
    with snap as (
      select queue_json from cinevo_remotes
      where code = ${clean} and user_id = ${userId} and expires_at > now()
    ),
    upd as (
      update cinevo_remotes
      set now_json = ${payload}::jsonb,
          queue_json = '[]'::jsonb,
          expires_at = now() + interval '12 hours'
      where code = ${clean} and user_id = ${userId} and expires_at > now()
      returning code
    )
    select queue_json from snap
  `;
  return parseCommandList(asJson(rows[0]?.queue_json));
}

export async function pushRemoteCommand(userId: string, code: string, command: unknown): Promise<boolean> {
  const clean = normalizeCode(code);
  const safe = sanitizeCommand(command);
  if (!clean || !safe) return false;
  const sql = await getSql();
  const rows = await sql<{ code: string }>`
    update cinevo_remotes
    set queue_json = queue_json || ${JSON.stringify(safe)}::jsonb
    where code = ${clean} and user_id = ${userId} and expires_at > now() and jsonb_array_length(queue_json) < 24
    returning code
  `;
  return Boolean(rows[0]);
}

export async function readRemote(userId: string, code: string): Promise<{ now: RemoteNow; ageMs: number } | null> {
  const clean = normalizeCode(code);
  if (!clean) return null;
  const sql = await getSql();
  const rows = await sql<{ now_json: unknown }>`
    select now_json from cinevo_remotes
    where code = ${clean} and user_id = ${userId} and expires_at > now()
  `;
  const row = rows[0];
  if (!row) return null;
  const raw = asJson(row.now_json);
  const stamped = raw && typeof raw === "object" ? (raw as { updatedAt?: number }) : {};
  const updatedAt = Number(stamped.updatedAt) || 0;
  return {
    now: sanitizeNow(raw),
    ageMs: updatedAt ? Math.max(0, Date.now() - updatedAt) : 86_400_000,
  };
}

