import { randomBytes } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createSignedSession, verifySignedSession, SESSION_TTL_SECONDS } from "./auth-token";

const COOKIE_NAME = "au_admin_session";

/**
 * The administrator password is NEVER hardcoded.
 *
 * When ADMIN_PASSWORD is not set, admin login is disabled entirely (the API
 * answers with a clear configuration message) instead of silently accepting a
 * well-known default that anyone could read from the source.
 */
function adminPassword(): string | null {
  const value = process.env.ADMIN_PASSWORD?.trim();
  return value ? value : null;
}

export function isAdminConfigured(): boolean {
  return adminPassword() !== null;
}

let ephemeralSecret: string | null = null;

function sessionSecret(): string {
  const fromEnv = process.env.ADMIN_SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  // No secret configured: generate one for this process only. Sessions then
  // expire on restart, which is safe for local use and never ships a guessable key.
  if (!ephemeralSecret) ephemeralSecret = randomBytes(32).toString("hex");
  return ephemeralSecret;
}

export function createSessionToken(now = Date.now()): string {
  return createSignedSession(sessionSecret(), now);
}

export function verifySessionToken(token: string | undefined | null): boolean {
  return verifySignedSession(token, sessionSecret());
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(COOKIE_NAME)?.value);
}

export async function setAdminSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearAdminSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export function checkPassword(input: string): boolean {
  const expected = adminPassword();
  if (!expected) return false; // admin disabled until ADMIN_PASSWORD is set
  const a = Buffer.from(input ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Small in-memory rate limiter for login and chat abuse mitigation. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  bucket.count += 1;
  if (bucket.count > limit) return { ok: false, remaining: 0 };
  return { ok: true, remaining: limit - bucket.count };
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
