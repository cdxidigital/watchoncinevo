import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, authEnabled, signIn, signOut } from "./client";
import { hasGateSessionMarker } from "./gate-session-marker";
import { resolveSignInGateState } from "./sign-in-gate";
import { useCurrentUser, useCurrentUserState } from "./use-current-user";

const subscribeToNothing = () => () => {};
const noGateSessionOnServer = () => false;

/**
 * Auth state components — plain wrappers around `useCurrentUserState()`.
 *
 * With auth on, visitors are signed out until they authenticate — in the sandbox
 * live preview too, which does real sign-in. The shared dev user appears only
 * when auth is disabled (`VITE_AUTH_ENABLED=false`, the shipped default).
 * While the session is still resolving, gates that care about signed-out state
 * render nothing so there's no signed-out flash on hard reload.
 */

/** Where `RedirectToSignIn` sends signed-out visitors. Create this route. */
export const SIGN_IN_PATH = "/login";

/** Render children only when a user is present (real session, or the disabled-auth dev user). */
export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? <>{children}</> : null;
}

/**
 * Render children only once we KNOW the visitor is signed out (`isPending` has
 * cleared and there is no user). Hidden while the session is still loading.
 */
export function SignedOut({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending || user) return null;
  return <>{children}</>;
}

/**
 * Client-side redirect to the sign-in route (TanStack `<Navigate>` — NOT a full
 * `window.location` reload). A hard navigation re-bootstraps the SPA and re-runs
 * session loading, which feels like a second "Loading…" on /login.
 *
 * Guard routes by waiting out `isPending` first (see `use-current-user`), then
 * render this.
 */
export function RedirectToSignIn({ to = SIGN_IN_PATH }: { to?: string }) {
  return <Navigate to={to} />;
}

export function SignInGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const state = resolveSignInGateState({ isPending, hasUser: user !== null });
  if (state === "pending") return null;
  if (state === "signed_in") return <>{children}</>;
  return <>{fallback ?? <SignInButtons />}</>;
}

export function SignInButtons() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      {GROK_PROVIDERS.map((p) => (
        <button
          key={p.providerId}
          type="button"
          onClick={() => signIn(p.providerId, { callbackURL: "/" })}
          className="w-full cursor-pointer rounded-md border border-neutral-300 px-4 py-2 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Continue with {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Minimal signed-in identity chip + sign-out. Restyle freely (see the
 * `design-ui` skill). Sign-out is only shown when auth is enabled (the
 * disabled-auth dev user has nothing to sign out of) and the session is not
 * gate-materialized — behind the gate the next request signs the viewer
 * straight back in, so a sign-out control there is a broken loop.
 */
export function UserButton() {
  const user = useCurrentUser();
  // Sign-out can take a moment (and can fail when deployed), so the control
  // shows it is working and cannot be fired twice.
  const [signingOut, setSigningOut] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user?.displayName ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    noGateSessionOnServer,
  );
  if (!user) return null;
  const label = user.displayName ?? user.primaryEmail ?? "Account";
  const saveProfile = async () => {
    setBusy(true);
    setMessage("");
    const result = await authClient.updateUser({ name: name.trim() });
    setBusy(false);
    setMessage(result.error ? "Could not save your profile." : "Profile saved.");
  };
  const resetPassword = async () => {
    if (!user.primaryEmail) return;
    setBusy(true);
    setMessage("");
    const result = await authClient.requestPasswordReset({ email: user.primaryEmail, redirectTo: "/reset-password" });
    setBusy(false);
    setMessage(result.error ? "Could not send a reset email." : "Check your email for a reset link.");
  };
  const deleteAccount = async () => {
    if (!window.confirm("Delete your account and all account data? This cannot be undone.")) return;
    setBusy(true);
    const result = await authClient.deleteUser();
    if (result.error) {
      setBusy(false);
      setMessage("Could not delete your account.");
      return;
    }
    await signOut();
  };

  return (
    <div className="relative flex items-center gap-2">
      <button type="button" className="flex items-center gap-2" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {user.profileImageUrl ? <img src={user.profileImageUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/20">{label.charAt(0).toUpperCase()}</span>}
        <span className="text-sm font-medium">{label}</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-cine-line bg-cine-bg p-4 shadow-2xl">
          <p className="text-xs uppercase tracking-wider text-cine-faint">Account</p>
          <label className="mt-3 block text-xs font-semibold text-cine-muted" htmlFor="account-name">Display name</label>
          <input id="account-name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-cine-line bg-cine-well px-3 text-sm" />
          <button type="button" disabled={busy} onClick={() => void saveProfile()} className="house-btn house-btn--play mt-3 w-full">Save profile</button>
          {authEnabled && user.primaryEmail ? <button type="button" disabled={busy} onClick={() => void resetPassword()} className="mt-3 w-full text-left text-sm text-cine-muted hover:text-cine-text">Reset password</button> : null}
          {message ? <p className="mt-2 text-xs text-cine-muted" role="status">{message}</p> : null}
          {authEnabled && !gateSession ? <button type="button" disabled={busy || signingOut} onClick={() => { setSigningOut(true); void signOut().catch(() => setSigningOut(false)); }} className="mt-3 w-full text-left text-sm text-cine-muted">{signingOut ? "Signing out…" : "Sign out"}</button> : null}
          {authEnabled && !gateSession ? <button type="button" disabled={busy} onClick={() => void deleteAccount()} className="mt-3 w-full text-left text-sm text-cine-danger">Delete account</button> : null}
        </div>
      ) : null}
    </div>
  );
}
