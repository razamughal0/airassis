import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSignedSession(secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const nonce = randomBytes(8).toString("hex");
  const payload = `admin.${expiresAt}.${nonce}`;
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifySignedSession(token: string | undefined | null, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [role, expiresAt, nonce, signature] = parts;
  if (role !== "admin") return false;
  const expires = Number(expiresAt);
  if (!Number.isFinite(expires) || expires * 1000 < now) return false;
  const expected = signPayload(`${role}.${expiresAt}.${nonce}`, secret);
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length) return false;
  return timingSafeEqual(provided, expectedBuffer);
}
