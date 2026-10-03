import { useEffect, useRef, useState } from "react";
import { renderSVG } from "uqr";
import { getBearerToken } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { b64urlToBytes, bytesToB64url } from "@/lib/passkey-crypto";

type Challenge = { challengeId: string; challenge: string; rpId: string };

async function postPasskey(body: Record<string, string>) {
  const token = getBearerToken();
  const res = await fetch("/api/passkey", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: string;
    token?: string;
    challengeId?: string;
    challenge?: string;
    rpId?: string;
    secret?: string;
  };
  if (!res.ok || data.error) throw new Error(data.error || "Passkey failed.");
  return data;
}

function bufferOf(value: string): ArrayBuffer {
  const bytes = b64urlToBytes(value);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function fromBuffer(value: ArrayBuffer) {
  return bytesToB64url(new Uint8Array(value));
}

async function challenge(): Promise<Challenge> {
  const data = await postPasskey({ action: "challenge" });
  if (!data.challengeId || !data.challenge || !data.rpId) throw new Error("Could not start a passkey.");
  return { challengeId: data.challengeId, challenge: data.challenge, rpId: data.rpId };
}

export async function registerPasskeyInBrowser(email: string, name: string) {
  const createdChallenge = await challenge();
  const created = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "CINEVO", id: createdChallenge.rpId },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: email.trim(),
        displayName: name.trim() || email.trim(),
      },
      challenge: bufferOf(createdChallenge.challenge),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!created) throw new Error("The passkey prompt was closed.");
  const attestation = created.response as AuthenticatorAttestationResponse;
  const publicKey = attestation.getPublicKey();
  if (!publicKey) throw new Error("This browser could not save a passkey. Use email instead.");
  const fresh = await challenge();
  const signed = (await navigator.credentials.get({
    publicKey: {
      challenge: bufferOf(fresh.challenge),
      rpId: fresh.rpId,
      allowCredentials: [{ type: "public-key", id: created.rawId }],
      userVerification: "preferred",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!signed) throw new Error("The passkey prompt was closed.");
  const signedBody = signed.response as AuthenticatorAssertionResponse;
  const data = await postPasskey({
    action: "register",
    challengeId: fresh.challengeId,
    email: email.trim(),
    name: name.trim(),
    credentialId: fromBuffer(created.rawId),
    publicKey: fromBuffer(publicKey),
    algorithm: String(attestation.getPublicKeyAlgorithm()),
    clientDataJSON: fromBuffer(signedBody.clientDataJSON),
    authenticatorData: fromBuffer(signedBody.authenticatorData),
    signature: fromBuffer(signedBody.signature),
  });
  if (!data.token) throw new Error("The account was created, but this browser did not keep the sign-in.");
  return data.token;
}

export function PasskeyLogin({
  mode,
  email,
  name,
  desk,
  onAuthed,
}: {
  mode: "in" | "up";
  email: string;
  name: string;
  desk?: string;
  onAuthed: (token: string) => Promise<void>;
}) {
  const onAuthedRef = useRef(onAuthed);
  onAuthedRef.current = onAuthed;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [supported, setSupported] = useState(true);
  const [framed, setFramed] = useState(false);
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "PublicKeyCredential" in window);
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
  }, []);

  useEffect(() => {
    if (desk) return;
    let stop = false;
    void postPasskey({ action: "desk" })
      .then((data) => {
        if (stop || !data.secret) return;
        setSecret(data.secret);
        const url = `${window.location.origin}/login?desk=${data.secret}`;
        setQr(renderSVG(url, { ecc: "M", border: 2, pixelSize: 4, blackColor: "#041018", whiteColor: "#f4fbff" }));
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [desk]);

  useEffect(() => {
    if (!secret) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/passkey?desk=${encodeURIComponent(secret)}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data: { status?: string; token?: string }) => {
          if (data.status === "approved" && data.token) {
            window.clearInterval(timer);
            void onAuthedRef.current(data.token);
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [secret]);

  const run = async () => {
    setError("");
    if (!supported) {
      setError("This browser cannot use a passkey. Use email instead.");
      return;
    }
    if (mode === "up" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter the email for this house, then create the passkey.");
      return;
    }
    setPending(true);
    try {
      if (mode === "up") {
        const token = await registerPasskeyInBrowser(email, name);
        await onAuthed(token);
      } else {
        const next = await challenge();
        const credential = (await navigator.credentials.get({
          publicKey: {
            challenge: bufferOf(next.challenge),
            rpId: next.rpId,
            userVerification: "preferred",
            timeout: 60_000,
          },
        })) as PublicKeyCredential | null;
        if (!credential) throw new Error("The passkey prompt was closed.");
        const assertion = credential.response as AuthenticatorAssertionResponse;
        const data = await postPasskey({
          action: "login",
          challengeId: next.challengeId,
          credentialId: fromBuffer(credential.rawId),
          clientDataJSON: fromBuffer(assertion.clientDataJSON),
          authenticatorData: fromBuffer(assertion.authenticatorData),
          signature: fromBuffer(assertion.signature),
        });
        if (!data.token) throw new Error("The passkey matched, but this browser did not keep the sign-in.");
        await onAuthed(data.token);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Passkey failed.";
      setError(
        message.includes("NotAllowed") || message.includes("not allowed") || message.includes("cross-origin")
          ? framed
            ? "Passkeys are blocked in this preview. Use a password, or sign this screen in with the QR code."
            : "The passkey prompt was closed."
          : message,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="passkey-block">
      {desk ? <p className="passkey-note">This phone will sign in the other screen.</p> : null}
      <button type="button" className="house-btn house-btn--play h-12 w-full" disabled={pending} onClick={() => void run()}>
        {pending ? "Waiting for the passkey…" : mode === "up" ? "Create a passkey" : "Sign in with a passkey"}
      </button>
      {mode === "up" && !desk ? <p className="passkey-note passkey-note--hint">Your browser asks twice: once to save the key, once to prove it.</p> : null}
      {error ? <p className="text-sm text-cine-danger">{error}</p> : null}
      {!supported ? <p className="passkey-note">This browser has no passkey. Use email below.</p> : null}
      {framed ? (
        <p className="passkey-note">
          This preview blocks the passkey prompt.{" "}
          <a href={typeof window === "undefined" ? "/login" : window.location.href} target="_blank" rel="noreferrer">
            Open sign-in in a new tab
          </a>
          , use a password, or sign this screen in with the QR code.
        </p>
      ) : null}
      {qr && !desk ? (
        <div className="passkey-qr">
          <button type="button" className="passkey-qr__toggle" onClick={() => setShowQr((open) => !open)}>
            {showQr ? "Hide QR code" : "Sign in with a QR code"}
          </button>
          {showQr ? (
            <div className="passkey-qr__sheet">
              <div dangerouslySetInnerHTML={{ __html: qr }} />
              <p>Scan with a phone that is already signed in to this house. Approve there, and this screen uses the same account.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AddPasskey() {
  const { user, isPending } = useCurrentUserState();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  if (isPending || !user || user.isDevFallback || !user.primaryEmail) return null;

  const add = async () => {
    setError("");
    setPending(true);
    try {
      await registerPasskeyInBrowser(user.primaryEmail || "", user.displayName || "");
      setDone(true);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not add a passkey.";
      setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="tool-card">
      <p className="font-ui text-xs font-semibold tracking-[0.12em] text-cine-cyan">ACCOUNT</p>
      <h2>Passkey</h2>
      <p>Add a passkey to this account. The next sign-in can use that key, or a phone QR code, instead of the password.</p>
      {done ? <p>This account now has a passkey.</p> : null}
      {error ? <p className="text-sm text-cine-danger">{error}</p> : null}
      <button type="button" className="house-btn" disabled={pending || done} onClick={() => void add()}>
        {pending ? "Waiting for the passkey…" : done ? "Passkey added" : "Add a passkey"}
      </button>
    </section>
  );
}
