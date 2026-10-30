import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import AdminLoginForm from "@/components/AdminLoginForm";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdminAuthenticated()) redirect("/admin");
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0b1f3a] ring-1 ring-[#c8a24a]/50">
          <img src="/images/au-mark-white.svg" alt="Air University emblem" className="h-9 w-9" />
        </span>
        <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#a9863a]">Restricted area</p>
        <h1 className="mt-1 font-serif text-xl text-[#0b1f3a]">Administrator sign in</h1>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
          Crawling, re-indexing, source invalidation and model configuration are protected. Public users can read answers
          and sources but cannot modify the knowledge base.
        </p>
        <AdminLoginForm />
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-[10.5px] leading-relaxed text-slate-500">
          There is <strong>no default password</strong> — it comes only from your own{" "}
          <code className="font-mono">ADMIN_PASSWORD</code> in <code className="font-mono">.env</code>. If it is empty, admin
          login stays disabled by design. Sessions are signed HTTP-only cookies and expire after 8 hours.
        </p>
        <a href="/setup" className="mt-2 inline-block text-[11px] font-semibold text-[#17375f] underline underline-offset-2">
          Run the setup check →
        </a>
      </div>
    </main>
  );
}
