import Link from "next/link";
import { db } from "@/db";
import { chunks, crawlLogs, crawlRuns, documents, sources } from "@/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ensureSeeded } from "@/lib/seed/seed";
import { SOURCE_GAPS, SEED_SOURCES } from "@/lib/seed/corpus";
import { CAMPUS_LABELS, PAGE_TYPES } from "@/lib/config";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ campus?: string; pageType?: string; q?: string }>;

const STATUS_STYLES: Record<string, string> = {
  indexed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ocr_pending: "bg-amber-50 text-amber-800 border-amber-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  invalid: "bg-slate-100 text-slate-600 border-slate-200",
  pending: "bg-sky-50 text-sky-700 border-sky-200",
};

export default async function SourcesPage({ searchParams }: { searchParams: SearchParams }) {
  try {
    await ensureSeeded();
  } catch (error) {
    console.error("seed unavailable", error);
  }
  const params = await searchParams;
  const campus = params.campus ?? "all";
  const pageType = params.pageType ?? "all";
  const query = (params.q ?? "").trim();

  const conditions = [];
  if (campus !== "all") conditions.push(eq(documents.campus, campus));
  if (pageType !== "all") conditions.push(eq(documents.pageType, pageType));
  if (query) {
    const pattern = `%${query.slice(0, 80)}%`;
    conditions.push(or(ilike(documents.title, pattern), ilike(documents.sourceUrl, pattern), ilike(documents.contentText, pattern)));
  }

  const [rows, statsRow, chunkRow, runRows, logRows, sourceRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        sourceUrl: documents.sourceUrl,
        campus: documents.campus,
        pageType: documents.pageType,
        contentType: documents.contentType,
        processingStatus: documents.processingStatus,
        freshness: documents.freshness,
        trustLevel: documents.trustLevel,
        extractionMode: documents.extractionMode,
        extractionConfidence: documents.extractionConfidence,
        crawlTimestamp: documents.crawlTimestamp,
        effectiveSession: documents.effectiveSession,
        chunkCount: documents.chunkCount,
        active: documents.active,
        version: documents.version,
        httpStatus: documents.httpStatus,
        provenanceNote: documents.provenanceNote,
      })
      .from(documents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(documents.crawlTimestamp))
      .limit(60),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${documents.active})::int`,
        pdfs: sql<number>`count(*) filter (where ${documents.contentType} = 'pdf')::int`,
        ocrPending: sql<number>`count(*) filter (where ${documents.processingStatus} = 'ocr_pending')::int`,
        failed: sql<number>`count(*) filter (where ${documents.processingStatus} = 'failed')::int`,
        campuses: sql<number>`count(distinct ${documents.campus})::int`,
        snapshots: sql<number>`count(*) filter (where ${documents.extractionMode} = 'operator_snapshot')::int`,
      })
      .from(documents),
    db.select({ count: sql<number>`count(*)::int` }).from(chunks),
    db.select().from(crawlRuns).orderBy(desc(crawlRuns.id)).limit(4),
    db.select().from(crawlLogs).orderBy(desc(crawlLogs.id)).limit(18),
    db.select().from(sources).orderBy(desc(sources.id)),
  ]);

  const stats = statsRow[0] ?? { total: 0, active: 0, pdfs: 0, ocrPending: 0, failed: 0, campuses: 0, snapshots: 0 };
  const lastCrawl = runRows.find((run) => run.status === "completed" || run.status === "partial") ?? runRows[0] ?? null;
  const registeredDomains = sourceRows.length ? sourceRows : SEED_SOURCES.map((source, index) => ({ ...source, id: index, allowCrawl: true, createdAt: new Date() }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#a9863a]">Transparency</p>
          <h1 className="mt-1 font-serif text-2xl text-[#0b1f3a] sm:text-3xl">Sources, coverage and known gaps</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            This is a source-discovery report for the knowledge base, not a marketing page. It lists every indexed source,
            how it was retrieved, what is still missing, and which URLs failed. Nothing on this page is inferred from
            third-party admission websites.
          </p>
        </div>
        <Link href="/" className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-[#0b1f3a] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[#17375f]">
          ← Back to the assistant
        </Link>
      </div>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Indexed sources", value: stats.active, hint: `${stats.total} stored (incl. inactive)` },
          { label: "Searchable chunks", value: chunkRow[0]?.count ?? 0, hint: "structure-aware, overlapping" },
          { label: "Campuses separated", value: stats.campuses, hint: "Karachi / Islamabad / Kharian…" },
          { label: "OCR queue", value: stats.ocrPending, hint: "image-only documents" },
          { label: "Last successful update", value: lastCrawl?.finishedAt ? new Date(lastCrawl.finishedAt).toISOString().slice(0, 10) : "—", hint: lastCrawl?.status ?? "no run yet" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{card.label}</p>
            <p className="mt-1 font-serif text-2xl text-[#0b1f3a]">{card.value}</p>
            <p className="text-[10.5px] text-slate-400">{card.hint}</p>
          </div>
        ))}
      </section>

      <section className="mt-5 rounded-xl border border-[#e2cf9a] bg-[#fbf7ec] p-4">
        <h2 className="font-serif text-base font-semibold text-[#5b4a1d]">Coverage limitation — read this first</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#6b5a2a]">
          {stats.snapshots} of {stats.total} indexed sources were captured with an operator-assisted fetch because the
          official hosts answered automated crawling with <strong>HTTP 403</strong> (Cloudflare bot protection) from this
          environment. The crawler itself is fully implemented (robots.txt, allowlist, SSRF guard, deduplication,
          content-hash change detection, PDF extraction) and will ingest live pages as soon as it is run from a network the
          host permits. Every indexed record below shows its extraction mode, so operator snapshots are never presented as
          live crawls.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg text-[#0b1f3a]">Indexed source records</h2>
        <form className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_180px_180px_auto]" method="get">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search titles, URLs and extracted text…"
            className="rounded-md border border-slate-200 px-3 py-2 text-[12.5px] outline-none focus:border-[#17375f]"
          />
          <select name="campus" defaultValue={campus} className="rounded-md border border-slate-200 px-2 py-2 text-[12.5px]">
            <option value="all">All campuses</option>
            {Object.entries(CAMPUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select name="pageType" defaultValue={pageType} className="rounded-md border border-slate-200 px-2 py-2 text-[12.5px]">
            <option value="all">All page types</option>
            {PAGE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-[#0b1f3a] px-3.5 py-2 text-[12.5px] font-semibold text-white">Filter</button>
        </form>

        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Scope</th>
                  <th className="px-3 py-2 font-semibold">Retrieval</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Chunks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="max-w-[380px] px-3 py-2.5">
                      <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#17375f] hover:underline">
                        {row.title} ↗
                      </a>
                      <p className="mt-0.5 truncate text-[10.5px] text-slate-400">{row.sourceUrl}</p>
                      {row.provenanceNote && <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-slate-500">{row.provenanceNote}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <span className="rounded-full border border-[#17375f]/20 bg-[#eef2f8] px-2 py-0.5 text-[10px] text-[#17375f]">{row.campus.replace(/-/g, " ")}</span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">{row.pageType}</span>
                        {row.effectiveSession && <span className="rounded-full border border-[#e2cf9a] bg-[#fbf7ec] px-2 py-0.5 text-[10px] text-[#7c6425]">{row.effectiveSession}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[10.5px] text-slate-500">
                      <p>{new Date(row.crawlTimestamp).toISOString().slice(0, 10)}</p>
                      <p className="mt-0.5">{row.extractionMode === "live_crawl" ? "live crawl" : "operator snapshot"}</p>
                      <p className="mt-0.5">confidence {Math.round((row.extractionConfidence ?? 0) * 100)}%</p>
                      <p className="mt-0.5">v{row.version} · {row.freshness}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[row.processingStatus] ?? STATUS_STYLES.invalid}`}>
                        {row.processingStatus}
                      </span>
                      {!row.active && <p className="mt-1 text-[10px] text-slate-400">not answering</p>}
                      {row.httpStatus && <p className="mt-1 text-[10px] text-slate-400">HTTP {row.httpStatus}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-600">{row.chunkCount}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-[12px] text-slate-500">
                      No sources match this filter. Clear filters to see the full report.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-serif text-lg text-[#0b1f3a]">Known coverage gaps</h2>
          <p className="mt-1 text-[11.5px] text-slate-500">Reported honestly instead of being filled with guesses.</p>
          <ul className="mt-3 space-y-2.5">
            {SOURCE_GAPS.map((gap) => (
              <li key={gap.url} className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12.5px] font-semibold text-[#5b4a1d]">{gap.label}</p>
                  <span className="whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-amber-800">{gap.status.replace(/_/g, " ")}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#6b5a2a]">{gap.reason}</p>
                <p className="mt-1 text-[10.5px] text-[#8a7433]">Next step: {gap.action}</p>
                <a href={gap.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-[10.5px] font-semibold text-[#7c6425] underline">
                  {gap.url} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-serif text-lg text-[#0b1f3a]">Registered official domains</h2>
            <p className="mt-1 text-[11.5px] text-slate-500">The crawler is restricted to these hosts plus the configured allowlist.</p>
            <ul className="mt-3 space-y-2">
              {registeredDomains.map((source) => (
                <li key={source.baseUrl} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-[#17375f]">{source.name}</p>
                    <a href={source.baseUrl} target="_blank" rel="noreferrer" className="truncate text-[10.5px] text-slate-500 hover:underline">{source.baseUrl}</a>
                    <p className="mt-0.5 text-[10px] text-slate-400">{source.notes}</p>
                  </div>
                  <span className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9.5px] text-slate-600">{source.campus.replace(/-/g, " ")}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-serif text-lg text-[#0b1f3a]">Crawl status & failures</h2>
            <div className="mt-2 space-y-2">
              {runRows.map((run) => (
                <div key={run.id} className="rounded-lg border border-slate-100 px-3 py-2 text-[11.5px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#17375f]">Run #{run.id} · {run.mode}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${run.status === "completed" ? "bg-emerald-50 text-emerald-700" : run.status === "partial" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{run.status}</span>
                  </div>
                  <p className="mt-1 text-[10.5px] text-slate-500">
                    {new Date(run.startedAt).toISOString().slice(0, 16).replace("T", " ")} · discovered {run.pagesDiscovered} · processed {run.pagesProcessed} · PDFs {run.pdfsProcessed} · failures {run.failures} · skipped {run.skipped}
                  </p>
                  {run.notes && <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{run.notes}</p>}
                </div>
              ))}
            </div>
            <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Latest URL log</h3>
            <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto pr-1 text-[10.5px]">
              {logRows.map((log) => (
                <li key={log.id} className="flex gap-2 border-b border-slate-50 pb-1">
                  <span className={`mt-0.5 whitespace-nowrap rounded px-1.5 py-0 font-medium ${log.status === "failed" ? "bg-rose-50 text-rose-700" : log.status === "ok" || log.status === "operator_snapshot" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {log.status}{log.httpStatus ? ` ${log.httpStatus}` : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-slate-600">{log.url}</span>
                    <span className="block text-[10px] text-slate-400">{log.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-serif text-lg text-[#0b1f3a]">How this knowledge base is built</h2>
        <ol className="mt-2 grid gap-2 text-[12px] leading-relaxed text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Discover", "robots.txt + sitemaps + internal links, restricted to the domain allowlist with SSRF checks on every hop."],
            ["Extract", "Boilerplate-stripped HTML text with headings and tables preserved; digital PDFs via pdf.js; scanned files queued for OCR rather than guessed."],
            ["Deduplicate", "URL normalisation + SHA-256 content hashes. Unchanged pages are re-timestamped; changed pages create a version and re-index only themselves."],
            ["Retrieve", "Hybrid keyword + hashed-embedding search with campus, page-type and freshness filters, intent-aware reranking, and a confidence floor."],
            ["Answer", "Grounded composition with numbered citations; configurable local LLM adapters (Ollama / LM Studio) with a deterministic fallback."],
            ["Verify", "Every answer reports verification status, retrieval date, admission session and provenance warnings."],
            ["Separate campuses", "Karachi, Islamabad and Kharian documents are stored with explicit campus scope and never merged in answers."],
            ["Stay fresh", "Scheduled refresh endpoint re-crawls, hashes and only reprocesses changed resources; stale and expired content is flagged."],
          ].map(([title, body], index) => (
            <li key={title} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <span className="font-serif text-sm font-semibold text-[#a9863a]">{String(index + 1).padStart(2, "0")}</span>
              <p className="mt-0.5 font-semibold text-[#0b1f3a]">{title}</p>
              <p className="mt-1 text-[11px] text-slate-500">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
