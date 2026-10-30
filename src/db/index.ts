import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Load .env / .env.local explicitly.
 *
 * Next.js normally loads these itself, but doing it here too means the database
 * module works the same way in `next dev`, `next start`, `drizzle-kit`, scripts
 * and on Windows where the working directory can differ.
 */
try {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath, override: false });
    }
  }
} catch {
  /* env loading is best-effort; process.env may already be populated */
}

export const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();

/** True when a DATABASE_URL is present (it does not guarantee the DB is reachable). */
export function isDatabaseConfigured(): boolean {
  return DATABASE_URL.length > 0;
}

/**
 * Actionable, copy-pasteable guidance instead of a bare "DATABASE_URL is required".
 * Thrown only when a query is actually attempted, so a missing variable can never
 * crash the whole app at import time.
 */
export function databaseSetupError(): Error {
  const example = 'DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/air_university_kb';
  const lines = [
    "Database is not configured.",
    "",
    "The DATABASE_URL environment variable is missing or empty.",
    "",
    "Fix it in 3 steps (Windows PowerShell):",
    "  1) Copy the template if you do not have a .env file yet:",
    "       Copy-Item .env.example .env",
    `  2) Open .env and set:  ${example}`,
    "       Replace YOUR_PASSWORD with your PostgreSQL password",
    "       (the default PostgreSQL password you chose during installation).",
    "  3) Create the database and tables, then restart the dev server:",
    "       createdb -U postgres air_university_kb",
    "       npx drizzle-kit push",
    "       npm run dev",
    "",
    "Full connection-string format:",
    "  postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME",
    "",
    "Tip: visit /setup in the browser for a live configuration check.",
  ];
  return new Error(lines.join("\n"));
}

type Database = NodePgDatabase<Record<string, never>>;

const globalForDb = globalThis as typeof globalThis & {
  __auKbPool?: Pool;
  __auKbDb?: Database;
};

function createClient(): { pool: Pool; db: Database } {
  if (!DATABASE_URL) throw databaseSetupError();

  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5, // keep memory small on laptop-class hardware
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // An idle-client error must not take the Node process down.
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });

  return { pool, db: drizzle(pool) as Database };
}

/** Shared pg Pool (created lazily on first use). */
export function getPool(): Pool {
  if (!globalForDb.__auKbPool) globalForDb.__auKbPool = createClient().pool;
  return globalForDb.__auKbPool;
}

if (process.env.NODE_ENV !== "production") {
  globalForDb.__auKbPool = getPool();
}

/**
 * Drizzle client.
 *
 * This is a lazy proxy: importing `db` never connects and never throws, so a
 * missing .env shows a helpful message on the page that needs the database
 * instead of a build/import-time crash.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    if (!globalForDb.__auKbDb) globalForDb.__auKbDb = createClient().db;
    const client = globalForDb.__auKbDb as unknown as Record<string | symbol, unknown>;
    const value = client[property];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
}) as Database;
