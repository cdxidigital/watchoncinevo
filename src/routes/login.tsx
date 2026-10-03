import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, getBearerToken, rememberSessionToken, sessionTokenFromAuthResponse, signIn } from "@/lib/auth/client";
import { Logo } from "@/components/cinevo/logo";
import { PasskeyLogin } from "@/components/cinevo/passkey-login";
import { claimUsername } from "@/lib/sharing";
import { appDestination } from "@/lib/app-destination";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "up" ? ("up" as const) : ("in" as const),
    ...(typeof search.desk === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(search.desk) ? { desk: search.desk } : {}),
    ...(typeof search.error === "string" && search.error ? { error: search.error } : {}),
    ...appDestination(search),
  }),
  component: Login,
});

function readableAuthError(message: string | undefined, signingUp: boolean) {
  const text = (message || "").toLowerCase();
  if (text.includes("already") || text.includes("exist")) return "That email already has a house. Sign in instead.";
  if (text.includes("password") && text.includes("invalid")) return "Email or password did not match.";
  if (text.includes("password")) return "Use a password of at least 8 characters.";
  if (text.includes("origin")) return "This page could not confirm its address. Reload and try again.";
  return message || (signingUp ? "Could not create that account." : "Email or password did not match.");
}

function deskFromLocation() {
  if (typeof window === "undefined") return "";
  const raw = new URLSearchParams(window.location.search).get("desk") || "";
  return /^[A-Za-z0-9_-]{20,80}$/.test(raw) ? raw : "";
}

function Login() {
  const { mode: initial, room, core, desk, error: oauthError } = Route.useSearch();
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up">(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setMode(initial);
  }, [initial]);

  useEffect(() => {
    if (!oauthError) return;
    setError("Google or X did not finish signing in. Try again, or use a passkey.");
  }, [oauthError]);

  const goHouse = () => {
    const params = new URLSearchParams();
    if (room) params.set("room", room);
    if (core) params.set("core", core);
    window.location.assign(`/app${params.size ? `?${params}` : ""}`);
  };

  const signedIn = Boolean(user && !user.isDevFallback);

  useEffect(() => {
    if (isPending || !signedIn) return;
    let cancel = false;
    const secret = desk || deskFromLocation();
    void (async () => {
      if (secret) {
        const token = getBearerToken();
        try {
          const approved = await fetch("/api/passkey", {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ action: "approve", secret }),
          });
          if (!approved.ok && !cancel) {
            const failed = (await approved.json().catch(() => null)) as { error?: string } | null;
            setError(failed?.error || "Could not sign in the other screen.");
          }
        } catch {
          if (!cancel) setError("Could not sign in the other screen.");
        }
      }
      if (cancel) return;
      const params = new URLSearchParams();
      if (room) params.set("room", room);
      if (core) params.set("core", core);
      window.location.replace(`/app${params.size ? `?${params}` : ""}`);
    })();
    return () => {
      cancel = true;
    };
  }, [isPending, signedIn, desk, room, core]);

  const afterEmail = async (name: string) => {
    if (name.trim()) {
      try {
        await claimUsername({ data: { username: name.trim(), display: name.trim() } });
      } catch {
        /* UsernameGate will retry on /app */
      }
    }
    goHouse();
  };

  const enterHouse = async (token: string | null, name: string) => {
    if (token) rememberSessionToken(sessionTokenFromAuthResponse(token));
    const session = await authClient.getSession();
    if (!session.data?.user) return false;
    const secret = desk || deskFromLocation();
    if (secret) {
      const bearer = getBearerToken() || token;
      try {
        const approved = await fetch("/api/passkey", {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify({ action: "approve", secret }),
        });
        if (!approved.ok) {
          const failed = (await approved.json().catch(() => null)) as { error?: string } | null;
          setError(failed?.error || "Could not sign in the other screen.");
        }
      } catch {
        setError("Could not sign in the other screen.");
      }
    }
    await afterEmail(name);
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const cleanEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Enter a valid email.");
      return;
    }
    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }
    if (mode === "up" && username.trim() && !/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username.trim())) {
      setError("Username: 3–20 characters, starting with a letter. Letters, numbers, and underscores only.");
      return;
    }
    setPending(true);
    let captured: string | null = null;
    const fetchOptions = {
      onSuccess(context: { response: Response }) {
        captured = sessionTokenFromAuthResponse(context.response.headers.get("set-auth-token"));
      },
    };
    try {
      if (mode === "up") {
        const { data, error: err } = await authClient.signUp.email({
          email: cleanEmail,
          password,
          name: username.trim() || cleanEmail.split("@")[0] || "Member",
          fetchOptions,
        });
        if (err) {
          setError(readableAuthError(err.message, true));
          if ((err.message || "").toLowerCase().includes("exist")) setMode("in");
          return;
        }
        rememberSessionToken(captured || (data && "token" in data ? String(data.token ?? "") : null) || null);
        const kept = await enterHouse(captured, username);
        if (!kept) {
          setError("The account was created, but this browser did not keep the sign-in. Try signing in.");
          setMode("in");
        }
      } else {
        const { data, error: err } = await authClient.signIn.email({
          email: cleanEmail,
          password,
          fetchOptions,
        });
        if (err) {
          setError(readableAuthError(err.message, false));
          return;
        }
        rememberSessionToken(captured || (data && "token" in data ? String(data.token ?? "") : null) || null);
        const kept = await enterHouse(captured, "");
        if (!kept) setError("The password matched, but this browser did not keep the sign-in. Reload and try again.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  };

  if (isPending || signedIn) {
    return (
      <main className="login-stage">
        <div className="login-card" aria-busy="true">
          <div className="h-8 w-28 animate-pulse rounded bg-cine-surface" />
          <div className="mt-6 h-10 w-56 animate-pulse rounded bg-cine-surface" />
          <div className="mt-3 h-4 w-full animate-pulse rounded bg-cine-surface" />
          <div className="mt-8 h-12 w-full animate-pulse rounded-xl bg-cine-surface" />
          <div className="mt-2 h-12 w-full animate-pulse rounded-xl bg-cine-surface" />
        </div>
      </main>
    );
  }

  return (
    <main className="login-stage">
      <div className="login-card">
        <Link to="/" className="login-brand">
          <Logo size="lg" layout="stacked" />
        </Link>
        <p className="font-ui text-xs font-semibold tracking-[0.12em] text-cine-cyan">CINEVO · PRIVATE CINEMA</p>
        <h1 className="mt-3 font-ui text-4xl font-semibold leading-tight tracking-tight">
          {mode === "up" ? "Create your house." : "Take your seat."}
        </h1>
        <p className="mt-3 text-sm text-cine-muted">
          {desk
            ? "Sign in on this phone. The other screen follows you in."
            : mode === "up"
              ? "Add an email, then a passkey or a password. A phone QR code signs another screen into that same account."
              : "A passkey or a phone QR code signs in this account. A password works too."}
        </p>

        {authEnabled ? (
          <>
            <form onSubmit={(e) => void submit(e)} className="grid gap-3">
              {mode === "up" ? (
                <>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username (optional)"
                    autoComplete="username"
                    aria-label="Username"
                    maxLength={20}
                    title="3–20 letters, numbers, or underscores, starting with a letter"
                    className="mt-6 h-12 rounded-xl border border-cine-border bg-cine-well px-4 font-ui"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    autoComplete="email"
                    required
                    aria-label="Email"
                    className="h-12 rounded-xl border border-cine-border bg-cine-well px-4 font-ui"
                  />
                </>
              ) : null}
              <PasskeyLogin
                mode={mode}
                email={email}
                name={username || email.split("@")[0] || ""}
                desk={desk}
                onAuthed={async (token) => {
                  const kept = await enterHouse(token, username);
                  if (!kept) setError("The passkey matched, but this browser did not keep the sign-in. Reload and try again.");
                }}
              />
              {error ? <p className="text-sm text-cine-danger">{error}</p> : null}
              <p className="login-split">or password</p>
              {mode === "in" ? (
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  required
                  aria-label="Email"
                  className="h-12 rounded-xl border border-cine-border bg-cine-well px-4 font-ui"
                />
              ) : null}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={mode === "up" ? "new-password" : "current-password"}
                required
                minLength={8}
                aria-label="Password"
                className="h-12 rounded-xl border border-cine-border bg-cine-well px-4 font-ui"
              />
              <p className="text-xs text-cine-faint">Password at least 8 characters.{mode === "up" ? " Username is optional." : ""}</p>
              <button type="submit" disabled={pending} className="house-btn house-btn--ghost h-12 w-full">
                {pending ? "Working…" : mode === "up" ? "Create account with password" : "Sign in with password"}
              </button>
            </form>
            <button
              type="button"
              className="login-switch"
              onClick={() => {
                setMode(mode === "up" ? "in" : "up");
                setError("");
              }}
            >
              {mode === "up" ? "Already have a house? Sign in" : "New here? Create an account"}
            </button>
            <div className="mt-4 grid gap-2">
              {GROK_PROVIDERS.map((p) => (
                <button
                  key={p.providerId}
                  type="button"
                  onClick={() => {
                    void signIn(p.providerId, {
                      callbackURL: `/app${room || core ? `?${new URLSearchParams({ ...(room ? { room } : {}), ...(core ? { core } : {}) }).toString()}` : ""}`,
                    }).catch((err: unknown) => {
                      setError(err instanceof Error ? err.message : "Could not start that sign-in.");
                    });
                  }}
                  className="h-11 rounded-xl border border-cine-border bg-cine-elevated font-ui text-sm font-semibold hover:border-cine-cyan"
                >
                  Continue with {p.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-8 text-sm text-cine-muted">Sign-in is disabled.</p>
        )}
      </div>
    </main>
  );
}
