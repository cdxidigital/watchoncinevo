import { createStart } from "@tanstack/react-start";
import { clerkMiddleware } from "@clerk/tanstack-react-start/server";

// Clerk's own env lookup only checks VITE_CLERK_PUBLISHABLE_KEY /
// CLERK_PUBLISHABLE_KEY. This project's keys are provisioned under the
// Next.js-style names (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY),
// so they must be passed explicitly or the middleware throws "Publishable
// key is missing" on every request.
const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
const clerkSecretKey = process.env.CLERK_SECRET_KEY?.trim();

export const startInstance = createStart(() => ({
  requestMiddleware:
    clerkPublishableKey && clerkSecretKey
      ? [clerkMiddleware({ publishableKey: clerkPublishableKey, secretKey: clerkSecretKey })]
      : [],
}));
