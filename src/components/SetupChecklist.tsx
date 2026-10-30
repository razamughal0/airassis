"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  ok: boolean;
  env: { databaseUrlSet: boolean; databaseUrlMasked: string; urlProblem: string | null; adminPasswordSet: boolean };
  database: { online: boolean; version: string | null; tablesFound: number | null; error: string | null };
  nextSteps: string[];
};

function Row({ ok, label, value }: { ok: boolean | null; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
          ok === null ? "bg-slate-300" : ok ? "bg-emerald-500" : "bg-amber-500"
        }`}
      >
        {ok === null ? "?" : ok ? "✓" : "!"}
      </span>
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-[#0b1f3a]">{label}</p>
        <p className="mt-0.5 break-all font-mono text-[11px] leading-relaxed text-slate-500">{value}</p>
      </div>
    </div>
  );
}

export default function SetupChecklist() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch("/api/setup-status", { cache: "no-store" });
      setStatus((await response.json()) as Status);
    } catch {
      setLoadError("Could not reach the setup API. Is the dev server running?");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <a href="/" className="text-[12px] font-semibold text-[#17375f] hover:underline">
        ← Back to assistant
      </a>
      <h1 className="mt-3 font-serif text-2xl text-[#0b1f3a]">Setup check</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
        This page checks your local configuration and tells you the exact command to run next — no stack traces.
      </p>

      {loadError && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{loadError}</p>}

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-[#f7f8fa] px-4 py-2.5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Configuration</p>
        </div>
        {status ? (
          <>
            <Row
              ok={status.env.databaseUrlSet}
              label="DATABASE_URL is set"
              value={status.env.databaseUrlSet ? status.env.databaseUrlMasked : "Missing — add it to .env"}
            />
            {status.env.urlProblem && <Row ok={false} label="DATABASE_URL format" value={status.env.urlProblem} />}
            <Row ok={status.database.online} label="PostgreSQL reachable" value={status.database.version ?? status.database.error ?? "checking…"} />
            <Row
              ok={status.database.tablesFound === null ? null : status.database.tablesFound > 0}
              label="Tables created"
              value={
                status.database.tablesFound === null
                  ? "unknown"
                  : status.database.tablesFound > 0
                    ? `${status.database.tablesFound} tables found in the public schema`
                    : "0 tables — run: npx drizzle-kit push"
              }
            />
            <Row
              ok={status.env.adminPasswordSet}
              label="ADMIN_PASSWORD set (admin console)"
              value={status.env.adminPasswordSet ? "configured — /admin/login is enabled" : "not set — /admin is disabled until you set it in .env"}
            />
          </>
        ) : (
          <p className="px-4 py-4 text-[12.5px] text-slate-500">Checking configuration…</p>
        )}
      </div>

      {!!status?.nextSteps.length && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[12.5px] font-semibold text-amber-900">Do this next</p>
          <ol className="mt-2 space-y-1.5">
            {status.nextSteps.map((step) => (
              <li key={step} className="flex gap-2 text-[12.5px] leading-relaxed text-amber-900">
                <span>•</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[12.5px] font-semibold text-[#0b1f3a]">Full local setup (Windows PowerShell)</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-[#0b1f3a] px-3 py-3 text-[11px] leading-relaxed text-slate-100">
{`# 1) install dependencies
npm install

# 2) create your env file (only once)
Copy-Item .env.example .env
notepad .env      # set DATABASE_URL and ADMIN_PASSWORD

# 3) make sure PostgreSQL is running
net start postgresql-x64-16    # or start it from Services.msc

# 4) create the database (name must match DATABASE_URL)
createdb -U postgres air_university_kb
#    no createdb?  psql -U postgres -c "CREATE DATABASE air_university_kb;"

# 5) create the tables
npx drizzle-kit push

# 6) start the app
npm run dev`}
        </pre>
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
          Connection format: <code className="font-mono">postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME</code>. If your
          PostgreSQL user is <code className="font-mono">postgres</code>, the password is the one you chose when installing
          PostgreSQL.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-lg bg-[#0b1f3a] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#17375f]"
        >
          Re-run check
        </button>
      </div>
    </main>
  );
}
