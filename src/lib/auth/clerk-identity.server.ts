import { auth as clerkAuth, clerkClient } from "@clerk/tanstack-react-start/server";
import { getSql } from "@/lib/db";

export type ClerkIdentity = { clerkUserId: string; internalUserId: string; email: string | null };

const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
);

export async function resolveClerkIdentity(): Promise<ClerkIdentity | null> {
  if (!clerkConfigured) return null;

  const { userId } = await clerkAuth();
  if (!userId) return null;

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const primaryEmail = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
  const email = primaryEmail?.emailAddress?.trim().toLowerCase() ?? null;
  if (!email || !primaryEmail?.verification?.status || primaryEmail.verification.status !== "verified") {
    return null;
  }

  const sql = await getSql();
  const existing = await sql.query<{ clerk_user_id: string; internal_user_id: string; email: string }>(
    "select clerk_user_id, internal_user_id, email from cinevo_clerk_identity where clerk_user_id = $1 and status = 'active' limit 1",
    [userId],
  );
  if (existing[0]) return { clerkUserId: userId, internalUserId: existing[0].internal_user_id, email };

  const matched = await sql.query<{ id: string; email: string }>(
    'select "id", "email" from "user" where lower("email") = $1 limit 2',
    [email],
  );
  if (matched.length !== 1) {
    await sql.query(
      "insert into cinevo_clerk_identity (clerk_user_id, internal_user_id, email, status) values ($1, $2, $3, 'conflict') on conflict (clerk_user_id) do update set status = 'conflict', updated_at = current_timestamp",
      [userId, `clerk:${userId}`, email],
    );
    return null;
  }

  await sql.query(
    "insert into cinevo_clerk_identity (clerk_user_id, internal_user_id, email) values ($1, $2, $3) on conflict (clerk_user_id) do update set email = excluded.email, status = 'active', updated_at = current_timestamp",
    [userId, matched[0].id, email],
  );
  return { clerkUserId: userId, internalUserId: matched[0].id, email };
}
