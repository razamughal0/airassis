"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type CrawlerSettings = {
  startUrl: string;
  allowedDomains: string[];
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  requestDelayMs: number;
  timeoutMs: number;
  maxRetries: number;
  maxDocumentMb: number;
  userAgent: string;
  followPdfs: boolean;
  followImages: boolean;
  respectRobots: boolean;
};

type RetrievalSettings = {
  topK: number;
  minConfidence: number;
  chunkSize: number;
  chunkOverlap: number;
  embeddingProvider: "hash" | "ollama";
  embeddingModel: string;
  vectorWeight: number;
  keywordWeight: number;
  staleAfterDays: number;
};

type LlmSettings = {
  provider: "extractive" | "ollama" | "lmstudio" | "hosted";
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  streaming: boolean;
  contextChunks: number;
  ollamaBaseUrl: string;
  lmStudioBaseUrl: string;
  hostedBaseUrl: string;
};

type Settings = { crawler: CrawlerSettings; retrieval: RetrievalSettings; llm: LlmSettings };

type CrawlRun = {
  id: number;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  startUrl: string;
  pagesDiscovered: number;
  pagesProcessed: number;
  pdfsProcessed: number;
  failures: number;
  skipped: number;
  duplicates: number;
  ocrPending: number;
  notes: string | null;
};

type LogRow = { id: number; runId: number; url: string; status: string; httpStatus: number | null; detail: string | null; durationMs: number | null; createdAt: string };

type ConflictRow = {
  id: number;
  topicKey: string;
  campus: string;
  description: string;
  severity: string;
  status: string;
  createdAt: string;
};

type DocumentRow = {
  id: number;
  title: string;
  sourceUrl: string;
  campus: string;
  pageType: string;
  processingStatus: string;
  freshness: string;
  extractionMode: string;
  chunkCount: number;
  active: boolean;
  version: number;
};

type Overview = {
  stats: {
    total: number;
    active: number;
    inactive: number;
    pdfs: number;
    documents: number;
    conversations: number;
    messages: number;
    unverifiedAnswers: number;
    openConflicts: number;
    crawlRunning: boolean;
    byCampus: Record<string, number>;
  };
  lastCrawl: CrawlRun | null;
  pending: { id: number; title: string; status: string; error: string | null; sourceUrl: string }[];
  settings: Settings;
  provider: { id: string; label: string; isLocal: boolean; model: string };
  conflicts: ConflictRow[];
  runs: CrawlRun[];
  logs: LogRow[];
  sources: { id: number; name: string; baseUrl: string; campus: string; scope: string; trustLevel: string }[];
  gaps: { url: string; label: string; reason: string; status: string; action: string }[];
  seed: unknown;
  audit: { id: number; action: string; detail: string | null; createdAt: string }[];
};

const TABS = ["overview", "crawl", "sources", "conflicts", "settings"] as const;
type Tab = (typeof TABS)[number];

function Card({ title, value, hint }: { title: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p>
      <p className="mt-1 font-serif text-2xl text-[#0b1f3a]">{value}</p>
      {hint && <p className="text-[10.5px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#17375f] focus:ring-2 focus:ring-[#17375f]/10";

export default function AdminDashboard() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [docFilter, setDocFilter] = useState("");
  const [logFilter, setLogFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const [overviewResponse, knowledgeResponse] = await Promise.all([
        fetch("/api/admin/overview", { cache: "no-store" }),
        fetch("/api/knowledge?campus=all&pageType=all", { cache: "no-store" }),
      ]);
      if (overviewResponse.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (overviewResponse.ok) {
        const data = (await overviewResponse.json()) as Overview;
        setOverview(data);
        setSettingsDraft((current) => current ?? data.settings);
      }
      if (knowledgeResponse.ok) {
        const data = (await knowledgeResponse.json()) as { documents: DocumentRow[] };
        setDocuments(data.documents ?? []);
      }
    } catch {
      setStatus("Could not refresh dashboard data.");
    }
  }, [router]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 12000);
    return () => clearInterval(interval);
  }, [load]);

  const act = async (url: string, body?: unknown, method = "POST") => {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json()) as { error?: string; note?: string };
      if (!response.ok && response.status !== 202 && response.status !== 409) throw new Error(data.error ?? "Action failed");
      setStatus(data.note ?? "Done.");
      await load();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const filteredDocuments = useMemo(() => {
    const term = docFilter.trim().toLowerCase();
    if (!term) return documents;
    return documents.filter((document) =>
      `${document.title} ${document.sourceUrl} ${document.campus} ${document.pageType}`.toLowerCase().includes(term),
    );
  }, [documents, docFilter]);

  const filteredLogs = useMemo(() => {
    if (!overview) return [];
    if (logFilter === "all") return overview.logs;
    return overview.logs.filter((log) => log.status === logFilter);
  }, [overview, logFilter]);

  if (!overview) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
          Loading administrator overview…
        </div>
      </main>
    );
  }

  const { stats } = overview;
  const draft = settingsDraft ?? overview.settings;

  return (
    <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#a9863a]">Authenticated maintainer view</p>
          <h1 className="mt-1 font-serif text-2xl text-[#0b1f3a]">Knowledge base operations</h1>
          <p className="mt-1 text-[12px] text-slate-500">
            Crawl health, indexing, conflicts, OCR queue and model configuration. All writes are audited.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void act("/api/admin/crawl")}
            disabled={busy || stats.crawlRunning}
            className="rounded-md bg-[#0b1f3a] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {stats.crawlRunning ? "Crawl running…" : "Run refresh now"}
          </button>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/admin/logout", { method: "POST" });
              router.replace("/admin/login");
              router.refresh();
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600"
          >
            Sign out
          </button>
        </div>
      </div>

      {status && <p className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-[11.5px] text-slate-600">{status}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card title="Active sources" value={stats.active} hint={`${stats.total} stored · ${stats.inactive} inactive`} />
        <Card title="Open conflicts" value={stats.openConflicts} hint="fee / figure disagreements" />
        <Card title="Pending processing" value={overview.pending.length} hint="OCR or failed documents" />
        <Card title="Questions answered" value={stats.messages} hint={`${stats.conversations} conversations`} />
        <Card title="Unverified answers" value={stats.unverifiedAnswers} hint="no-answer / low confidence" />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 border-b border-slate-200">
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12px] font-semibold capitalize transition ${
              tab === entry ? "border-[#c8a24a] text-[#0b1f3a]" : "border-transparent text-slate-500 hover:text-[#0b1f3a]"
            }`}
          >
            {entry}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-serif text-base text-[#0b1f3a]">Crawl & indexing state</h2>
              <dl className="mt-2 grid gap-2 text-[11.5px] sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-slate-500">Start URL</dt>
                  <dd className="break-all font-medium text-[#17375f]">{overview.settings.crawler.startUrl}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-slate-500">Last successful crawl</dt>
                  <dd className="font-medium text-[#17375f]">
                    {overview.lastCrawl?.finishedAt ? new Date(overview.lastCrawl.finishedAt).toISOString().replace("T", " ").slice(0, 16) : "none recorded"}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-slate-500">Allowlisted domains</dt>
                  <dd className="font-medium text-[#17375f]">{overview.settings.crawler.allowedDomains.length}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-slate-500">Model backend</dt>
                  <dd className="font-medium text-[#17375f]">{overview.provider.label}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-slate-500">Embedding model</dt>
                  <dd className="font-medium text-[#17375f]">{overview.settings.retrieval.embeddingModel} ({overview.settings.retrieval.embeddingProvider})</dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-slate-500">Indexed campus scopes</dt>
                  <dd className="font-medium text-[#17375f]">{Object.keys(stats.byCampus).length}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-serif text-base text-[#0b1f3a]">Processing queue</h2>
              {!overview.pending.length && <p className="mt-2 text-[12px] text-slate-500">Nothing waiting. OCR failures and invalid documents appear here.</p>}
              <ul className="mt-2 space-y-2">
                {overview.pending.map((document) => (
                  <li key={document.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11.5px]">
                    <p className="font-semibold text-[#5b4a1d]">{document.title}</p>
                    <p className="text-[10.5px] text-[#6b5a2a]">{document.status} · {document.error}</p>
                    <a href={document.sourceUrl} target="_blank" rel="noreferrer" className="text-[10.5px] text-[#7c6425] underline">{document.sourceUrl}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-serif text-base text-[#0b1f3a]">Recent audit entries</h2>
              <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
                {overview.audit.map((entry) => (
                  <li key={entry.id} className="flex gap-2 border-b border-slate-50 pb-1">
                    <span className="whitespace-nowrap font-mono text-[10px] text-slate-400">{new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                    <span><strong className="text-[#17375f]">{entry.action}</strong> — {entry.detail}</span>
                  </li>
                ))}
                {!overview.audit.length && <li className="text-slate-400">No admin actions recorded yet.</li>}
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[#e2cf9a] bg-[#fbf7ec] p-4">
              <h2 className="font-serif text-base text-[#5b4a1d]">Known coverage gaps</h2>
              <ul className="mt-2 space-y-2">
                {overview.gaps.map((gap) => (
                  <li key={gap.url} className="rounded-md border border-[#e2cf9a] bg-white/60 px-2.5 py-2 text-[11px]">
                    <p className="font-semibold text-[#5b4a1d]">{gap.label}</p>
                    <p className="text-[10.5px] text-[#6b5a2a]">{gap.reason}</p>
                    <p className="mt-0.5 text-[10px] text-[#8a7433]">Next: {gap.action}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-serif text-base text-[#0b1f3a]">Source mix</h2>
              <ul className="mt-2 space-y-1 text-[11.5px]">
                {Object.entries(stats.byCampus).map(([campus, count]) => (
                  <li key={campus} className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5">
                    <span className="capitalize text-slate-600">{campus.replace(/-/g, " ")}</span>
                    <span className="font-semibold text-[#17375f]">{count}</span>
                  </li>
                ))}
              </ul>
              <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Registered domains</h3>
              <ul className="mt-1 space-y-0.5 text-[10.5px] text-slate-500">
                {overview.sources.map((source) => (
                  <li key={source.id} className="truncate">· {source.baseUrl} ({source.campus})</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {tab === "crawl" && (
        <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-serif text-base text-[#0b1f3a]">Crawl runs</h2>
            <div className="mt-2 space-y-2">
              {overview.runs.map((run) => (
                <details key={run.id} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 open:bg-white">
                  <summary className="cursor-pointer text-[11.5px] font-semibold text-[#17375f]">
                    Run #{run.id} · {run.mode} · {run.status}
                    <span className="ml-2 font-normal text-slate-400">{new Date(run.startedAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                  </summary>
                  <dl className="mt-2 grid grid-cols-2 gap-1 text-[10.5px] text-slate-600">
                    <div>discovered: {run.pagesDiscovered}</div>
                    <div>processed: {run.pagesProcessed}</div>
                    <div>PDFs: {run.pdfsProcessed}</div>
                    <div>failures: {run.failures}</div>
                    <div>skipped: {run.skipped}</div>
                    <div>duplicates: {run.duplicates}</div>
                    <div>OCR pending: {run.ocrPending}</div>
                    <div>finished: {run.finishedAt ? new Date(run.finishedAt).toISOString().slice(0, 16).replace("T", " ") : "running"}</div>
                  </dl>
                  {run.notes && <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{run.notes}</p>}
                </details>
              ))}
            </div>
            <p className="mt-3 rounded-md bg-slate-50 px-2.5 py-2 text-[10.5px] leading-relaxed text-slate-500">
              The manual refresh starts a background crawl using the configured start URL, depth, page budget, per-host
              delay, retry policy and robots setting. Progress is written to the database; reload to see live counts.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-base text-[#0b1f3a]">Per-URL log</h2>
              <select value={logFilter} onChange={(event) => setLogFilter(event.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-[11px]">
                {["all", "ok", "pdf", "unchanged", "failed", "skipped", "robots_blocked", "operator_snapshot"].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <ul className="mt-2 max-h-[520px] space-y-1.5 overflow-y-auto pr-1 text-[10.5px]">
              {filteredLogs.map((log) => (
                <li key={log.id} className="rounded border border-slate-100 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${log.status === "failed" ? "bg-rose-50 text-rose-700" : log.status === "ok" || log.status === "operator_snapshot" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {log.status}{log.httpStatus ? ` ${log.httpStatus}` : ""}
                    </span>
                    <span className="text-slate-400">run #{log.runId}</span>
                    {log.durationMs !== null && <span className="text-slate-400">{log.durationMs} ms</span>}
                  </div>
                  <p className="mt-0.5 break-all text-slate-600">{log.url}</p>
                  <p className="text-[10px] text-slate-400">{log.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === "sources" && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-base text-[#0b1f3a]">Indexed sources ({documents.length})</h2>
            <input
              value={docFilter}
              onChange={(event) => setDocFilter(event.target.value)}
              placeholder="Filter by title, URL, campus…"
              className="w-64 rounded-md border border-slate-300 px-2.5 py-1.5 text-[11.5px] outline-none focus:border-[#17375f]"
            />
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-[9.5px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Scope</th>
                  <th className="px-2 py-2">State</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocuments.map((document) => (
                  <tr key={document.id}>
                    <td className="max-w-[360px] px-2 py-2">
                      <a href={document.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#17375f] hover:underline">{document.title} ↗</a>
                      <p className="truncate text-[9.5px] text-slate-400">{document.sourceUrl}</p>
                    </td>
                    <td className="px-2 py-2 text-[10px] text-slate-600">
                      {document.campus.replace(/-/g, " ")} · {document.pageType}
                      <p className="text-slate-400">{document.extractionMode === "live_crawl" ? "live" : "snapshot"} · v{document.version} · {document.chunkCount} chunks</p>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[9.5px] ${document.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                        {document.active ? document.processingStatus : "inactive"}
                      </span>
                      <p className="text-[9.5px] text-slate-400">{document.freshness}</p>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button type="button" disabled={busy} onClick={() => void act("/api/admin/documents", { id: document.id, action: "reprocess" })} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50">Re-index</button>
                        <button type="button" disabled={busy} onClick={() => void act("/api/admin/documents", { id: document.id, action: document.active ? "invalidate" : "restore" })} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50">
                          {document.active ? "Invalidate" : "Restore"}
                        </button>
                        <button type="button" disabled={busy} onClick={() => void act("/api/admin/documents", { id: document.id, action: "mark_ocr" })} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50">Queue OCR</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "conflicts" && (
        <section className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-serif text-base text-[#0b1f3a]">Conflicting or stale information review</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
              Detected when two active fee documents for the same campus publish different first-semester tuition for the
              same program. Resolve only after checking the official pages; the assistant reports open conflicts to users.
            </p>
            {!overview.conflicts.length && <p className="mt-3 text-[12px] text-slate-500">No conflicts detected in the current index.</p>}
            <ul className="mt-3 space-y-2">
              {overview.conflicts.map((conflict) => (
                <li key={conflict.id} className={`rounded-lg border px-3 py-2 text-[11.5px] ${conflict.status === "open" ? "border-rose-200 bg-rose-50/60" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#5b2b2b]">{conflict.topicKey}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[9.5px] uppercase tracking-wide text-slate-600">{conflict.status} · {conflict.severity}</span>
                  </div>
                  <p className="mt-1 text-slate-700">{conflict.description}</p>
                  <div className="mt-1 flex gap-1.5">
                    <button type="button" disabled={busy} onClick={() => void act("/api/admin/conflicts", { id: conflict.id, status: "resolved" })} className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Mark resolved</button>
                    <button type="button" disabled={busy} onClick={() => void act("/api/admin/conflicts", { id: conflict.id, status: "dismissed" })} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">Dismiss</button>
                    <button type="button" disabled={busy} onClick={() => void act("/api/admin/conflicts", { id: conflict.id, status: "open" })} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">Reopen</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-serif text-base text-[#0b1f3a]">Low-confidence / unanswered questions</h2>
            <p className="mt-1 text-[11.5px] text-slate-500">
              Aggregated counter from stored assistant messages: <strong>{stats.unverifiedAnswers}</strong> answers were
              returned as unverified. Question text is retained only within the browser-scoped conversation records.
            </p>
          </div>
        </section>
      )}

      {tab === "settings" && (
        <section className="mt-4 space-y-4">
          <form
            className="rounded-xl border border-slate-200 bg-white p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              await act("/api/admin/settings", { crawler: draft.crawler, retrieval: draft.retrieval, llm: draft.llm }, "PATCH");
            }}
          >
            <h2 className="font-serif text-base text-[#0b1f3a]">Crawler configuration</h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Start URL" hint="Configurable starting point; not hardcoded in the crawler">
                <input className={inputClass} value={draft.crawler.startUrl} onChange={(event) => setSettingsDraft({ ...draft, crawler: { ...draft.crawler, startUrl: event.target.value } })} />
              </Field>
              <Field label="Allowed domains" hint="Comma separated; suffix matching with dot boundary">
                <textarea
                  className={`${inputClass} font-mono`}
                  rows={3}
                  value={draft.crawler.allowedDomains.join(", ")}
                  onChange={(event) => setSettingsDraft({ ...draft, crawler: { ...draft.crawler, allowedDomains: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })}
                />
              </Field>
              <Field label="User agent">
                <input className={inputClass} value={draft.crawler.userAgent} onChange={(event) => setSettingsDraft({ ...draft, crawler: { ...draft.crawler, userAgent: event.target.value } })} />
              </Field>
              {([
                ["maxPages", "Max pages per run"],
                ["maxDepth", "Max link depth"],
                ["concurrency", "Concurrency (1–4)"],
                ["requestDelayMs", "Per-host delay (ms)"],
                ["timeoutMs", "Request timeout (ms)"],
                ["maxRetries", "Retries"],
                ["maxDocumentMb", "Max document size (MB)"],
              ] as const).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    className={inputClass}
                    value={draft.crawler[key]}
                    onChange={(event) =>
                      setSettingsDraft({ ...draft, crawler: { ...draft.crawler, [key]: Number(event.target.value) } })
                    }
                  />
                </Field>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-[11.5px] text-slate-600">
              {([
                ["respectRobots", "Respect robots.txt"],
                ["followPdfs", "Follow and extract PDFs"],
                ["followImages", "Follow images (OCR queue)"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.crawler[key]}
                    onChange={(event) => setSettingsDraft({ ...draft, crawler: { ...draft.crawler, [key]: event.target.checked } })}
                  />
                  {label}
                </label>
              ))}
            </div>

            <h2 className="mt-5 font-serif text-base text-[#0b1f3a]">Retrieval configuration</h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Top K passages">
                <input type="number" className={inputClass} value={draft.retrieval.topK} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, topK: Number(event.target.value) } })} />
              </Field>
              <Field label="Minimum confidence" hint="Below this the assistant refuses to assert facts">
                <input type="number" step="0.01" className={inputClass} value={draft.retrieval.minConfidence} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, minConfidence: Number(event.target.value) } })} />
              </Field>
              <Field label="Stale after (days)">
                <input type="number" className={inputClass} value={draft.retrieval.staleAfterDays} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, staleAfterDays: Number(event.target.value) } })} />
              </Field>
              <Field label="Chunk size (chars)">
                <input type="number" className={inputClass} value={draft.retrieval.chunkSize} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, chunkSize: Number(event.target.value) } })} />
              </Field>
              <Field label="Chunk overlap (chars)">
                <input type="number" className={inputClass} value={draft.retrieval.chunkOverlap} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, chunkOverlap: Number(event.target.value) } })} />
              </Field>
              <Field label="Embedding provider">
                <select className={inputClass} value={draft.retrieval.embeddingProvider} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, embeddingProvider: event.target.value as "hash" | "ollama" } })}>
                  <option value="hash">hash (offline, CPU)</option>
                  <option value="ollama">ollama embeddings (local server)</option>
                </select>
              </Field>
              <Field label="Embedding model">
                <input className={inputClass} value={draft.retrieval.embeddingModel} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, embeddingModel: event.target.value } })} />
              </Field>
              <Field label="Keyword weight">
                <input type="number" step="0.05" className={inputClass} value={draft.retrieval.keywordWeight} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, keywordWeight: Number(event.target.value) } })} />
              </Field>
              <Field label="Vector weight">
                <input type="number" step="0.05" className={inputClass} value={draft.retrieval.vectorWeight} onChange={(event) => setSettingsDraft({ ...draft, retrieval: { ...draft.retrieval, vectorWeight: Number(event.target.value) } })} />
              </Field>
            </div>

            <h2 className="mt-5 font-serif text-base text-[#0b1f3a]">Language model configuration</h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Provider" hint="Local inference needs no paid API">
                <select className={inputClass} value={draft.llm.provider} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, provider: event.target.value as LlmSettings["provider"] } })}>
                  <option value="extractive">extractive (offline, deterministic)</option>
                  <option value="ollama">Ollama (local)</option>
                  <option value="lmstudio">LM Studio (local OpenAI-compatible)</option>
                  <option value="hosted">Hosted (authorized API key)</option>
                </select>
              </Field>
              <Field label="Model identifier">
                <input className={inputClass} value={draft.llm.model} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, model: event.target.value } })} />
              </Field>
              <Field label="Temperature">
                <input type="number" step="0.05" className={inputClass} value={draft.llm.temperature} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, temperature: Number(event.target.value) } })} />
              </Field>
              <Field label="Max output tokens">
                <input type="number" className={inputClass} value={draft.llm.maxOutputTokens} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, maxOutputTokens: Number(event.target.value) } })} />
              </Field>
              <Field label="Timeout (ms)">
                <input type="number" className={inputClass} value={draft.llm.timeoutMs} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, timeoutMs: Number(event.target.value) } })} />
              </Field>
              <Field label="Context chunks">
                <input type="number" className={inputClass} value={draft.llm.contextChunks} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, contextChunks: Number(event.target.value) } })} />
              </Field>
              <Field label="Ollama base URL">
                <input className={inputClass} value={draft.llm.ollamaBaseUrl} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, ollamaBaseUrl: event.target.value } })} />
              </Field>
              <Field label="LM Studio base URL">
                <input className={inputClass} value={draft.llm.lmStudioBaseUrl} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, lmStudioBaseUrl: event.target.value } })} />
              </Field>
              <Field label="Hosted base URL" hint="Key is read server-side from the environment">
                <input className={inputClass} value={draft.llm.hostedBaseUrl} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, hostedBaseUrl: event.target.value } })} />
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11.5px] text-slate-600">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.llm.streaming} onChange={(event) => setSettingsDraft({ ...draft, llm: { ...draft.llm, streaming: event.target.checked } })} />
                Request streaming from the provider
              </label>
              <button type="submit" disabled={busy} className="rounded-md bg-[#0b1f3a] px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-50">
                {busy ? "Saving…" : "Save configuration"}
              </button>
              <button type="button" onClick={() => setSettingsDraft(overview.settings)} className="text-[11px] text-slate-500 underline">
                Reset to loaded values
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              API keys are never editable here and never sent to the browser. Configure <code className="font-mono">HOSTED_LLM_API_KEY</code>,
              <code className="font-mono"> LM_STUDIO_API_KEY</code>, <code className="font-mono">CRON_SECRET</code> and <code className="font-mono">ADMIN_PASSWORD</code> in the server environment.
            </p>
          </form>
        </section>
      )}
    </main>
  );
}
