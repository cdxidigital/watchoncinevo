import { auth as clerkAuth, clerkClient } from "@clerk/tanstack-react-start/server";
import { getSql } from "@/lib/db";

export type ClerkIdentity = { clerkUserId: string; internalUserId: string; email: string | null };

/**
 * Discriminated resolution result so callers can tell "nobody is signed in
 * with Clerk" (fine to fall back to Better Auth during the migration window)
 * apart from "a Clerk session exists but isn't a usable identity" (must fail
 * closed — never silently fall back to a different account's cookie).
 */
export type ClerkResolution =
  | { status: "none" }
  | { status: "ok"; identity: ClerkIdentity }
  | { status: "invalid" };

const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
);

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === UNIQUE_VIOLATION);
}

export async function resolveClerkIdentity(): Promise<ClerkResolution> {
  if (!clerkConfigured) return { status: "none" };

  let userId: string | null;
  try {
    ({ userId } = await clerkAuth());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("without configuring the middleware")) return { status: "none" };
    throw error;
  }
  if (!userId) return { status: "none" };

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const primaryEmail = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
  const email = primaryEmail?.emailAddress?.trim().toLowerCase() ?? null;
  if (!email || !primaryEmail?.verification?.status || primaryEmail.verification.status !== "verified") {
    // A real Clerk session that we can't trust an email for. This must NOT
    // fall through to Better Auth — that would let an unverified Clerk
    // identity ride on whatever Better Auth cookie happens to be present.
    return { status: "invalid" };
  }

  const sql = await getSql();
  const existing = await sql.query<{ clerk_user_id: string; internal_user_id: string | null; email: string }>(
    "select clerk_user_id, internal_user_id, email from cinevo_clerk_identity where clerk_user_id = $1 and status = 'active' limit 1",
    [userId],
  );
  if (existing[0]?.internal_user_id) {
    // Keep the mapping's cached email current (Clerk emails can change).
    if (existing[0].email !== email) {
      await sql.query(
        "update cinevo_clerk_identity set email = $1, updated_at = current_timestamp where clerk_user_id = $2",
        [email, userId],
      );
    }
    return {
      status: "ok",
      identity: { clerkUserId: userId, internalUserId: existing[0].internal_user_id, email },
    };
  }

  // Only match Better Auth accounts that themselves have a verified email —
  // a passkey- or password-created account with an unverified, attacker-claimed
  // email must never be silently linked to a Clerk identity for that address.
  const matched = await sql.query<{ id: string; email: string }>(
    'select "id", "email" from "user" where lower("email") = $1 and "emailVerified" = true limit 2',
    [email],
  );
  if (matched.length !== 1) {
    await sql.query(
      "insert into cinevo_clerk_identity (clerk_user_id, internal_user_id, email, status) values ($1, $2, $3, 'conflict') on conflict (clerk_user_id) do update set status = 'conflict', internal_user_id = excluded.internal_user_id, email = excluded.email, updated_at = current_timestamp",
      [userId, null, email],
    );
    return { status: "invalid" };
  }

  try {
    await sql.query(
      "insert into cinevo_clerk_identity (clerk_user_id, internal_user_id, email) values ($1, $2, $3) on conflict (clerk_user_id) do update set email = excluded.email, status = 'active', updated_at = current_timestamp",
      [userId, matched[0].id, email],
    );
  } catch (error) {
    // `internal_user_id` is unique: a second Clerk identity racing to claim the
    // SAME Better Auth account loses this constraint, not the one targeted by
    // ON CONFLICT above. Treat that as a genuine conflict (two Clerk users
    // cannot share one internal account), not a 500.
    if (isUniqueViolation(error)) {
      await sql.query(
        "insert into cinevo_clerk_identity (clerk_user_id, internal_user_id, email, status) values ($1, $2, $3, 'conflict') on conflict (clerk_user_id) do update set status = 'conflict', internal_user_id = null, email = excluded.email, updated_at = current_timestamp",
        [userId, null, email],
      );
      return { status: "invalid" };
    }
    throw error;
  }
  return { status: "ok", identity: { clerkUserId: userId, internalUserId: matched[0].id, email } };
}
