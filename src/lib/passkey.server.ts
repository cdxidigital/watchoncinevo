import { auth, SESSION_TOKEN_COOKIE } from "@/lib/auth/server";
import { AuthNotConfiguredError } from "@/lib/auth/unavailable";
import { getSql } from "@/lib/db";
import { b64urlToBytes, bytesToB64url, pageOrigin, verifyAssertion } from "@/lib/passkey-crypto";

type PasskeyRow = {
  credential_id: string;
  user_id: string;
  public_key: string;
  algorithm: number;
  counter: number;
};

function configuredAuth() {
  if (!auth) throw new AuthNotConfiguredError();
  return auth;
}

function randomId() {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function signedToken(raw: string) {
  const ctx = await configuredAuth().$context;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ctx.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  let bin = "";
  for (const byte of sig) bin += String.fromCharCode(byte);
  return `${raw}.${btoa(bin)}`;
}

export async function issueSession(userId: string) {
  const ctx = await configuredAuth().$context;
  const session = await ctx.internalAdapter.createSession(userId);
  if (!session?.token) throw new Error("Could not start a session.");
  const token = await signedToken(session.token);
  const cookie = `${SESSION_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${60 * 60 * 24 * 7}`;
  return { token, cookie };
}

export async function userFromRequest(request: Request) {
  const session = await configuredAuth().api.getSession({ headers: request.headers });
  if (session?.user?.id) return session.user.id;
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  let decoded = header.slice(7).trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* already decoded */
  }
  const token = decoded.split(".")[0];
  if (!token) return null;
  const ctx = await configuredAuth().$context;
  const found = await ctx.internalAdapter.findSession(token);
  return found?.user?.id ?? null;
}

export async function newChallenge() {
  const sql = await getSql();
  const id = randomId();
  const challenge = randomId();
  await sql`delete from cinevo_webauthn_challenge where expires_at < now()`;
  await sql`insert into cinevo_webauthn_challenge (id, challenge, expires_at) values (${id}, ${challenge}, now() + interval '5 minutes')`;
  return { challengeId: id, challenge };
}

async function takeChallenge(id: string) {
  const sql = await getSql();
  const rows = await sql<{ challenge: string }>`
    delete from cinevo_webauthn_challenge
    where id = ${id} and expires_at > now()
    returning challenge
  `;
  return rows[0]?.challenge ?? null;
}

export async function registerPasskey(request: Request, body: {
  challengeId?: string;
  email?: string;
  name?: string;
  credentialId?: string;
  publicKey?: string;
  algorithm?: number;
  clientDataJSON?: string;
  authenticatorData?: string;
  signature?: string;
}) {
  const where = pageOrigin(request);
  if (!where) throw new Error("This page could not confirm its address. Reload and try again.");
  const email = (body.email || "").trim().toLowerCase();
  const name = (body.name || "").trim() || email.split("@")[0] || "Member";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter the email for this house.");
  if (!body.challengeId || !body.credentialId || !body.publicKey || !body.clientDataJSON || !body.authenticatorData || !body.signature) {
    throw new Error("Passkey response was incomplete.");
  }
  const challenge = await takeChallenge(body.challengeId);
  if (!challenge) throw new Error("That passkey prompt expired. Try again.");
  const algorithm = Number(body.algorithm) === -257 ? -257 : -7;
  await verifyAssertion({
    publicKeySpki: b64urlToBytes(body.publicKey),
    algorithm,
    authenticatorData: b64urlToBytes(body.authenticatorData),
    clientDataJSON: b64urlToBytes(body.clientDataJSON),
    signature: b64urlToBytes(body.signature),
    challenge,
    origin: where.origin,
    rpId: where.rpId,
  });
  const ctx = await configuredAuth().$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  const signedIn = await userFromRequest(request);
  let userId = "";
  if (existing?.user) {
    if (!signedIn || signedIn !== existing.user.id) {
      throw new Error("That email already has a house. Sign in, then add a passkey.");
    }
    userId = existing.user.id;
  } else {
    const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: false });
    if (!user?.id) throw new Error("Could not create that account.");
    userId = user.id;
  }
  const sql = await getSql();
  const taken = await sql<{ user_id: string }>`select user_id from cinevo_passkey where credential_id = ${body.credentialId}`;
  if (taken[0] && taken[0].user_id !== userId) throw new Error("That passkey is already on another house.");
  if (!taken[0]) {
    await sql`
      insert into cinevo_passkey (credential_id, user_id, public_key, algorithm, counter)
      values (${body.credentialId}, ${userId}, ${body.publicKey}, ${algorithm}, ${0})
    `;
  }
  return issueSession(userId);
}

export async function loginPasskey(request: Request, body: {
  challengeId?: string;
  credentialId?: string;
  clientDataJSON?: string;
  authenticatorData?: string;
  signature?: string;
}) {
  const where = pageOrigin(request);
  if (!where) throw new Error("This page could not confirm its address. Reload and try again.");
  if (!body.challengeId || !body.credentialId || !body.clientDataJSON || !body.authenticatorData || !body.signature) {
    throw new Error("Passkey response was incomplete.");
  }
  const challenge = await takeChallenge(body.challengeId);
  if (!challenge) throw new Error("That passkey prompt expired. Try again.");
  const sql = await getSql();
  const rows = await sql<PasskeyRow>`select credential_id, user_id, public_key, algorithm, counter from cinevo_passkey where credential_id = ${body.credentialId}`;
  const row = rows[0];
  if (!row) throw new Error("No passkey on this house matches that one. Create an account first.");
  const verified = await verifyAssertion({
    publicKeySpki: b64urlToBytes(row.public_key),
    algorithm: Number(row.algorithm) === -257 ? -257 : -7,
    authenticatorData: b64urlToBytes(body.authenticatorData),
    clientDataJSON: b64urlToBytes(body.clientDataJSON),
    signature: b64urlToBytes(body.signature),
    challenge,
    origin: where.origin,
    rpId: where.rpId,
  });
  const next = verified.signCount > Number(row.counter) ? verified.signCount : Number(row.counter);
  if (verified.signCount > 0 && Number(row.counter) > 0 && verified.signCount <= Number(row.counter)) {
    throw new Error("That passkey looks copied. Use the original device.");
  }
  await sql`update cinevo_passkey set counter = ${next} where credential_id = ${row.credential_id}`;
  return issueSession(row.user_id);
}

export async function openDesk() {
  const sql = await getSql();
  const secret = randomId();
  await sql`delete from cinevo_desk where expires_at < now()`;
  await sql`insert into cinevo_desk (secret, status, expires_at) values (${secret}, 'pending', now() + interval '3 minutes')`;
  return { secret };
}

export async function readDesk(secret: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return { status: "expired" as const };
  const sql = await getSql();
  const rows = await sql<{ token: string }>`
    update cinevo_desk
    set status = 'done'
    where secret = ${secret} and status = 'approved' and token is not null and expires_at > now()
    returning token
  `;
  if (rows[0]?.token) return { status: "approved" as const, token: rows[0].token };
  const pending = await sql<{ status: string }>`
    select status from cinevo_desk where secret = ${secret} and expires_at > now()
  `;
  return pending[0] ? { status: "pending" as const } : { status: "expired" as const };
}

export async function approveDesk(request: Request, secret: string) {
  const userId = await userFromRequest(request);
  if (!userId) throw new Error("Sign in on this phone first.");
  const sql = await getSql();
  const rows = await sql<{ status: string }>`select status from cinevo_desk where secret = ${secret} and expires_at > now()`;
  if (!rows[0] || rows[0].status === "done") throw new Error("That code expired. Scan a new one.");
  const session = await issueSession(userId);
  await sql`update cinevo_desk set status = 'approved', token = ${session.token} where secret = ${secret}`;
  return { ok: true as const };
}
