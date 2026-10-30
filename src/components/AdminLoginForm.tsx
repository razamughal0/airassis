"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const response = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password }),
          });
          const data = (await response.json()) as { error?: string };
          if (!response.ok) throw new Error(data.error ?? "Sign in failed");
          router.replace("/admin");
          router.refresh();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Sign in failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Administrator password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-[#17375f] focus:ring-2 focus:ring-[#17375f]/10"
          required
        />
      </div>
      {error && <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[11.5px] text-rose-700">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-md bg-[#0b1f3a] px-3 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#17375f] disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
