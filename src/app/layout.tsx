import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Air University Knowledge Assistant — Karachi Campus",
  description:
    "A retrieval-augmented assistant for Air University Karachi Campus admissions, fees, eligibility and official sources. Every answer is cited and verification status is explicit.",
};

const nav = [
  { href: "/", label: "Assistant" },
  { href: "/sources", label: "Sources & coverage" },
  { href: "/admin", label: "Admin" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f5f6f8] text-[#12233c] antialiased">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1f3a] text-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" className="group flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0d2b4f] ring-1 ring-[#e7c878]/40 transition group-hover:ring-[#e7c878]/80">
                <img src="/images/au-mark-white.svg" alt="Air University emblem" className="h-9 w-9" />
              </span>
              <span className="leading-tight">
                <span className="block font-serif text-[15px] font-semibold tracking-wide text-white sm:text-base">
                  Air University <span className="text-[#e7c878]">Knowledge Assistant</span>
                </span>
                <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-300/80">
                  Karachi Campus · voice, text &amp; images · cited answers
                </span>
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-xs sm:text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2.5 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        {children}
        <footer className="mt-16 border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-slate-500 sm:px-6 md:flex-row md:items-center md:justify-between">
            <p className="max-w-2xl leading-relaxed">
              Independent, source-grounded information assistant. Not an official Air University statement or admission
              system. Fees, deadlines and eligibility must be confirmed with the campus admissions office. No personal
              data is required to ask a question.
            </p>
            <div className="flex flex-wrap gap-4">
              <a href="https://khi.au.edu.pk/" target="_blank" rel="noreferrer" className="hover:text-[#0b1f3a]">
                khi.au.edu.pk ↗
              </a>
              <a href="https://au.edu.pk/" target="_blank" rel="noreferrer" className="hover:text-[#0b1f3a]">
                au.edu.pk ↗
              </a>
              <Link href="/sources" className="hover:text-[#0b1f3a]">
                Source traceability
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
