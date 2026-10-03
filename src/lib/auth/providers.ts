/**
 * Social sign-in providers exposed by Cinevo.
 *
 * Production uses Better Auth's native Google / Twitter (X) providers with
 * Cinevo-owned OAuth credentials. The legacy broker id is retained only for
 * sandbox/live-preview popup auth, where the shared preview broker is useful.
 */
export type CinevoProvider = {
  /** Better Auth native social provider id used in deployed Cinevo. */
  providerId: "google" | "twitter";
  /** Legacy broker provider id used by the sandbox popup flow only. */
  brokerProviderId: string;
  /** Upstream broker hint used in preview. */
  idp: string;
  /** Human label for the sign-in button. */
  label: string;
};

export const GROK_PROVIDERS: readonly CinevoProvider[] = [
  { providerId: "google", brokerProviderId: "grok-google", idp: "google", label: "Google" },
  { providerId: "twitter", brokerProviderId: "grok-x", idp: "twitter", label: "X" },
];
