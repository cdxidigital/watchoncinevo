import { z } from "zod";

const boundedString = (max: number) => z.string().trim().max(max);

export const passkeyRequestSchema = z.object({
  action: z.enum(["challenge", "register", "login", "desk", "approve"]),
  challengeId: boundedString(128).optional(),
  email: boundedString(320).optional(),
  name: boundedString(80).optional(),
  credentialId: boundedString(512).optional(),
  publicKey: boundedString(4096).optional(),
  algorithm: z.union([z.number(), z.string().max(8)]).optional(),
  clientDataJSON: boundedString(16384).optional(),
  authenticatorData: boundedString(16384).optional(),
  signature: boundedString(16384).optional(),
  secret: boundedString(128).optional(),
});

const remoteNowSchema = z.object({
  title: boundedString(200),
  detail: boundedString(500),
  playing: z.boolean(),
  position: z.number().finite().min(0).max(86400000),
  volume: z.number().finite().min(0).max(1),
  titles: z.array(z.unknown()).max(300),
});

export const remoteRequestSchema = z.object({
  action: z.enum(["open", "rotate", "close", "sync", "command"]),
  code: boundedString(32).optional(),
  now: remoteNowSchema.optional(),
  command: z.unknown().optional(),
});
