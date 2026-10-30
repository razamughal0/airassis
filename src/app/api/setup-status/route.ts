import { DATABASE_URL, isDatabaseConfigured } from "@/db";
import { isAdminConfigured } from "@/lib/auth";
import { getPool } from "@/db";

export const dynamic = "force-dynamic";

function maskUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    // Build the string manually so the mask is not percent-encoded.
    const auth = parsed.username ? `${parsed.username}:${parsed.password ? "••••••" : ""}@` : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${auth}${parsed.hostname}${port}${parsed.pathname}${parsed.search}`;
  } catch {
    return "(DATABASE_URL is set but is not a valid URL — check the format)";
  }
}

function urlProblem(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      return "Protocol must be postgresql://";
    }
    if (!parsed.hostname) return "Host is missing";
    if (!parsed.pathname || parsed.pathname === "/") return "Database name is missing (e.g. /air_university_kb)";
    if (!parsed.username) return "User is missing";
    if (parsed.password === "") return "Password is empty — add it after the colon";
    if (/(YOUR_PASSWORD|CHANGEME|password)/i.test(parsed.password)) {
      return "Password is still a placeholder — replace YOUR_PASSWORD with your real PostgreSQL password";
    }
    return null;
  } catch {
    return "Not a valid URL — expected postgresql://USER:PASSWORD@HOST:PORT/DBNAME";
  }
}

export async function GET() {
  const problem = urlProblem(DATABASE_URL);

  let databaseOnline = false;
  let databaseError: string | null = isDatabaseConfigured() ? null : "DATABASE_URL is not set";
  let databaseVersion: string | null = null;
  let tablesFound: number | null = null;

  if (isDatabaseConfigured() && !problem) {
    try {
      const pool = getPool();
      const result = await pool.query<{ version: string }>("select version() as version");
      databaseVersion = (result.rows[0]?.version ?? "").split(",")[0] || null;
      databaseOnline = true;
      const tables = await pool.query<{ count: string }>(
        "select count(*)::text as count from information_schema.tables where table_schema = 'public'",
      );
      tablesFound = Number(tables.rows[0]?.count ?? 0);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (/does not exist/i.test(raw) && /database/i.test(raw)) {
        const dbName = (() => {
          try {
            return new URL(DATABASE_URL).pathname.replace(/^\//, "");
          } catch {
            return "air_university_kb";
          }
        })();
        databaseError = `Database "${dbName}" does not exist yet. Create it with:  createdb -U postgres ${dbName}   (or in pgAdmin / psql: CREATE DATABASE ${dbName};)`;
      } else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw)) {
        databaseError =
          "PostgreSQL is not reachable. Start the service:  Windows:  net start postgresql-x64-16   (or start it from Services.msc / pgAdmin). Also confirm the port (default 5432).";
      } else if (/password authentication failed/i.test(raw)) {
        databaseError =
          "Password authentication failed for this user. Check the password inside DATABASE_URL matches your PostgreSQL user's password.";
      } else {
        databaseError = raw.slice(0, 300);
      }
    }
  }

  return Response.json({
    ok: databaseOnline && tablesFound !== null && tablesFound > 0,
    env: {
      databaseUrlSet: isDatabaseConfigured(),
      databaseUrlMasked: maskUrl(DATABASE_URL),
      urlProblem: problem,
      adminPasswordSet: isAdminConfigured(),
    },
    database: {
      online: databaseOnline,
      version: databaseVersion,
      tablesFound,
      error: databaseError,
    },
    nextSteps: [
      !isDatabaseConfigured() && "Create a .env file (Copy-Item .env.example .env) and set DATABASE_URL.",
      problem && `Fix DATABASE_URL: ${problem}`,
      databaseOnline && tablesFound === 0 && "Tables are missing — run:  npx drizzle-kit push",
      !isAdminConfigured() && "Set ADMIN_PASSWORD in .env to enable the /admin console.",
    ].filter(Boolean),
  });
}
