import { z } from "zod";

export const passkeyRequestSchema = z.object({
  action: z.enum(["challenge", "register", "login", "desk", "approve"]),
  challengeId: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  credentialId: z.string().optional(),
  publicKey: z.string().optional(),
  algorithm: z.union([z.number(), z.string()]).optional(),
  clientDataJSON: z.string().optional(),
  authenticatorData: z.string().optional(),
  signature: z.string().optional(),
  secret: z.string().optional(),
});

export const remoteRequestSchema = z.object({
  action: z.enum(["open", "rotate", "close", "sync", "command"]),
  code: z.string().optional(),
  now: z.union([z.number(), z.string()]).optional(),
  command: z.unknown().optional(),
});
