# Air University Knowledge Assistant (Karachi Campus)

A production-oriented, source-grounded RAG assistant for Air University admissions questions. It crawls authorised public
university sources, extracts and versions content, indexes it with hybrid retrieval, and answers questions with numbered
official citations, retrieval dates, admission session and an explicit verification status. When the sources do not verify
something, the assistant says so instead of guessing.

> **Honest status:** the crawler, ingestion pipeline, retrieval, grounding checks, admin dashboard, scheduling endpoint and
> tests are implemented and exercised. In *this* environment the official hosts (`khi.au.edu.pk`, `www.au.edu.pk`) answer
> automated requests with **HTTP 403 (Cloudflare bot protection)**, so the knowledge base was bootstrapped with
> **operator-assisted snapshots of official pages** (`extractionMode = operator_snapshot`). Those records are labelled
> everywhere: in the UI, in citations, in the admin dashboard and in the `/sources` coverage report. Nothing is presented
> as a live crawl when it was not one.

---

## 1. Stack decision (and deviation from the suggested Python stack)

The runtime available for this project is **Next.js (App Router) + PostgreSQL + Drizzle ORM**. Rather than ship an
untested Python sidecar, the same architecture is implemented in TypeScript with clear module boundaries. Mapping from
the suggested layout:

| Suggested module | Implementation here |
| --- | --- |
| `crawler/discovery.py`, `fetcher.py`, `parser.py`, `url_utils.py` | `src/lib/crawler/crawl.ts`, `fetcher.ts`, `parser.ts`, `robots.ts` + `src/lib/security/url.ts` |
| `ingestion/html_processor.py`, `pdf_processor.py`, `ocr_processor.py`, `normalizer.py` | `src/lib/crawler/parser.ts`, `src/lib/ingestion/{pdf,text,ingest}.ts` |
| `knowledge/chunker.py`, `embeddings.py`, `vector_store.py`, `hybrid_search.py`, `retriever.py` | `src/lib/ingestion/text.ts` (chunking), `src/lib/knowledge/{embeddings,retriever}.ts` |
| `llm/base.py`, `ollama_provider.py`, `lm_studio_provider.py`, `prompts.py` | `src/lib/llm/{providers,prompts,index,extractive}.ts` |
| `services/chat_service.py`, `indexing_service.py`, `refresh_service.py` | `src/lib/services/chat.ts`, `src/lib/ingestion/ingest.ts`, `src/lib/crawler/crawl.ts`, `src/app/api/cron/refresh` |
| `database/models.py`, `repository.py` | `src/db/schema.ts` (Drizzle, PostgreSQL) |
| `security/url_validation.py`, `authentication.py` | `src/lib/security/url.ts`, `src/lib/auth.ts`, `src/lib/auth-token.ts` |
| `frontend/` | `src/app/page.tsx`, `src/components/ChatWorkspace.tsx`, `src/app/sources`, `src/app/admin` |
| `tests/` | `tests/*.test.ts` (Vitest) |

SQLite was the suggested prototype store; PostgreSQL is what this deployment provides, and it is the documented scaling
target, so the schema targets Postgres from day one (JSONB embedding storage, full indexing, no ORM-level SQL dialects).

---

## 2. Quick start

```bash
cp .env.example .env          # if starting fresh; DATABASE_URL is required
npm install
npx drizzle-kit push          # create tables
npm run build
npm run start                 # http://localhost:3000
```

The knowledge base bootstraps itself on first request (`src/lib/seed/seed.ts`, guarded by a Postgres advisory lock and a
`seed_version` setting). It is idempotent: existing hashes are re-timestamped rather than re-embedded.

### Windows (target laptop: Ryzen 7 7730U, 8 GB RAM, no CUDA)

1. Install Node.js 20+ LTS, PostgreSQL 15+ and Git for Windows.
2. Create a database: `createdb app_db` (or use pgAdmin).
3. Put `DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/app_db` in `.env`.
4. Run the commands above in PowerShell. No GPU, Python or paid API is required for the default mode.
5. Optional local LLM: install [Ollama](https://ollama.com), `ollama pull llama3.2:3b`, then set
   `LLM_PROVIDER=ollama` (3B quantised models are realistic on 8 GB shared memory; expect slower, lower-quality answers
   than a hosted frontier model — measure rather than assume).
6. Schedule refreshes with Task Scheduler: `curl -X POST -H "Authorization: Bearer %CRON_SECRET%" http://localhost:3000/api/cron/refresh`.

---

## 3. Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection | required |
| `CRAWL_START_URL` | Crawler entry point (configurable; never hardcoded) | `https://khi.au.edu.pk/` |
| `CRAWL_ALLOWED_DOMAINS` | Comma-separated allowlist (suffix-matched) | `au.edu.pk` + known subdomains |
| `CRAWL_MAX_PAGES`, `CRAWL_MAX_DEPTH`, `CRAWL_CONCURRENCY`, `CRAWL_DELAY_MS`, `CRAWL_TIMEOUT_MS`, `CRAWL_MAX_RETRIES`, `CRAWL_MAX_DOCUMENT_MB` | Crawl budgets and politeness | 40 / 3 / 2 / 750 / 15000 / 2 / 15 |
| `CRAWL_RESPECT_ROBOTS`, `CRAWL_FOLLOW_PDFS`, `CRAWL_FOLLOW_IMAGES`, `CRAWL_USER_AGENT` | Crawl policy | true / true / false / descriptive UA |
| `RETRIEVAL_TOP_K`, `RETRIEVAL_MIN_CONFIDENCE`, `RETRIEVAL_CHUNK_SIZE`, `RETRIEVAL_CHUNK_OVERLAP`, `RETRIEVAL_STALE_DAYS`, `RETRIEVAL_KEYWORD_WEIGHT`, `RETRIEVAL_VECTOR_WEIGHT` | Retrieval behaviour | 8 / 0.3 / 1100 / 180 / 30 / 0.55 / 0.45 |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL` | `hash` (offline) or `ollama` | `hash`, `hash-ngram-384` |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_TEMPERATURE`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_TIMEOUT_MS`, `LLM_CONTEXT_CHUNKS`, `LLM_STREAMING` | Model backend | `extractive` / `grounded-extractive-v1` |
| `OLLAMA_BASE_URL`, `LM_STUDIO_BASE_URL`, `LM_STUDIO_API_KEY`, `HOSTED_LLM_BASE_URL`, `HOSTED_LLM_API_KEY` | Provider endpoints (keys server-side only) | local URLs / empty |
| `ADMIN_PASSWORD` | Admin login password | **`au-knowledge-admin`** (change before deployment) |
| `ADMIN_SESSION_SECRET` | HMAC secret for admin cookies | derived locally |
| `CRON_SECRET` | Bearer secret for scheduled refresh | unset (endpoint returns 503) |
| `OCR_SERVICE_URL` | Optional external OCR endpoint | unset → documents marked `ocr_pending` |
| `VLM_BASE_URL`, `VLM_MODEL`, `VLM_API_KEY` | Optional vision-language model for uploaded images (OpenAI-compatible) | unset → image upload works but reading is reported as not configured |

All of these can also be changed at runtime in **Admin → Settings**, except API keys and secrets, which never leave the
server environment.

---

## 4. Source discovery report (Phase 1)

Official host discovered and verified: **`au.edu.pk`** and its campus/portal subdomains. The owner-supplied URL was not
given in the prompt, so the start URL is configurable and defaults to the Karachi campus site.

| Scope | Host / URL | Content used |
| --- | --- | --- |
| Karachi Campus | `https://khi.au.edu.pk/` | Campus overview, contact/address, admissions section structure |
| Karachi Campus | `https://khi.au.edu.pk/Pages/Admission/fees_financial.aspx` | Fee Structure Fall 2026 (tuition per credit hour, 1st semester totals, charges) |
| Karachi Campus | `https://khi.au.edu.pk/Pages/Admission/FAQS.aspx` | Merit/test/documents/processing-fee/international FAQs |
| Karachi Campus | `https://khi.au.edu.pk/Pages/Admission/how_to_apply.aspx` | Admissions navigation (body unavailable — recorded as a gap) |
| Karachi portal | `https://khiportals.au.edu.pk/admissions` | Online application requirements, Fall 2026 open |
| Karachi Campus | `https://khi.au.edu.pk/Pages/About/Vision_Mission.aspx` | Initial programs, future expansion |
| University-wide | `https://www.au.edu.pk/pages/admission/Scholarship.aspx` | Need-based + merit scholarship policy |
| Islamabad (main) | `https://webdata.au.edu.pk/Pages/Admission/{fees_financial,eligibility_criteria}.aspx` | Main-campus fee and eligibility pages (kept campus-scoped) |
| Kharian | `https://kc.au.edu.pk/Pages/Admission/fees_financial.aspx` | Kharian fee table (campus-separation testing) |
| Central portal | `https://portals.au.edu.pk` | Registered domain (authenticated areas never crawled) |

**Coverage limitations (published in the product, not hidden):**
- The Karachi admission schedule, dedicated required-documents page, eligibility page and advertisement could not be read
  (HTTP 403). No deadline was inferred from third-party admission sites, which publish conflicting dates (April vs July
  2026). The assistant answers such questions as *unverified*.
- No official statement about Karachi hostel or transport was found; availability is not inferred.
- Fee tables are for Fall 2026; figures may change and must be confirmed on the official page.
- PDFs, OCR and image notices are supported by the pipeline but no verified PDF was ingested during this cycle because
  the host blocked automated download.

---

## 5. What is implemented

**Crawler** (`src/lib/crawler/*`)
- robots.txt parsing (UA groups, allow/disallow longest-match, crawl-delay, sitemap discovery) with caching.
- Domain allowlist with dot-boundary matching, DNS resolution check and private-address/SSRF rejection on **every** hop,
  manual redirects (max 5) revalidated each time, timeouts, retries with backoff, per-host politeness delay, size caps.
- Sitemap + link discovery, relevance scoring, URL normalisation/dedup, depth/page/concurrency budgets, login/signup paths
  skipped, per-URL crawl log (status, HTTP status, duration, reason) and a run report.

**Ingestion** (`src/lib/ingestion/*`)
- Boilerplate-stripped HTML (cheerio) with headings/lists/tables preserved as structured text.
- PDF text extraction via `unpdf` (pdf.js) with page markers, low-text detection → `ocr_pending`; optional external OCR
  hook; images are never OCR-guessed locally.
- Normalisation, SHA-256 content hashing, URL + content dedup, version rows on change, incremental re-index of only the
  changed document, initial fee-figure conflict detection, freshness calculation (`fresh`/`stale`/`expired`).

**Retrieval** (`src/lib/knowledge/*`)
- Structure-aware overlapping chunking; pluggable embeddings (`hash` offline n-gram model by default, Ollama optional).
- Hybrid scoring (keyword overlap + cosine similarity + intent/page-type alignment + trust + recency), campus and
  page-type filtering, top-K with per-document caps, relative-score focus cut and a confidence threshold.
- Roman-Urdu query expansion glossary; intent detection (fees, deadline, eligibility, documents, how-to-apply,
  scholarship, programs, facilities, contact).

**Generation** (`src/lib/llm/*`)
- Provider interface with Ollama, LM Studio/OpenAI-compatible local, hosted-compatible and deterministic extractive
  adapters. Streaming everywhere; automatic fallback to the extractive composer if a local server is unavailable.
- Strict grounding prompt, untrusted-source fencing and instruction-injection neutralisation.
- Post-retrieval honesty checks: deadline questions require an actual official closing date, facility questions require an
  official statement, otherwise the answer is downgraded to *partial* with an explicit caveat. Empty retrieval returns
  “could not verify” plus official links.

**Product**
- Responsive chat with streaming, conversation history (browser-scoped session), language selector (English / Roman Urdu /
  Urdu script), campus scope selector, suggested questions, grouped citations with excerpts, PDF page numbers, retrieval
  dates, confidence, verification badges, conflict warnings, error/retry/loading states.
- **Voice input** via the Web Speech API (microphone button; en-PK / ur-PK recognition) and **voice output** via
  SpeechSynthesis (per-answer "Listen" button plus an optional auto-speak toggle). Both are browser APIs — no paid API,
  and they keep working offline once the page is served.
- **Image input**: attach a notice or document image (PNG/JPEG/WebP ≤ 8 MB). If a vision-language model is configured
  (`VLM_BASE_URL`, `VLM_MODEL`, `VLM_API_KEY`), the server extracts its text and shows it in the chat; otherwise the
  deployment honestly reports that vision is not configured. Image content is treated as untrusted data — instructions
  inside images are ignored.
- **Campus visuals**: answers citing campus/about/program pages show an illustrative gallery (labelled as non-official
  photography), and the hero shows a campus image.
- **Branding**: the official Air University emblem (provided by the owner) is recreated as crisp SVG assets
  (`public/images/au-mark*.svg`, `au-logo.svg`) and used in the header, chat avatar, login and favicon (src/app/icon.svg).
- Public `/sources` coverage page: indexed records with provenance, source registry, crawl runs, per-URL log, known gaps,
  architecture explanation.
- Password-protected `/admin`: stats, processing queue, crawl trigger, run history, URL log, source re-index/invalidate/
  restore/OCR queue, conflict review, crawler/retrieval/LLM configuration, audit trail, sign-out.
- `/api/cron/refresh` bearer-protected scheduled refresh; `/api/health` reports DB + indexed-document counts.

**Security**
- Admin cookie sessions are HMAC-signed, HttpOnly, SameSite=Lax, 8-hour expiry; login and chat are rate limited.
- Parameterised queries through Drizzle; Zod validation on chat, login, document and conflict actions.
- Secrets are read server-side only; the browser receives no keys or filesystem paths.
- Crawled content is treated as data (see prompt + sanitiser), never as instructions or executable code.

---

## 6. Tests and evaluation

```bash
npx vitest run
```

29 unit tests currently pass, covering URL normalisation/dedup, allowlist look-alike rejection, SSRF/private-IP blocking,
robots parsing and precedence, HTML boilerplate removal and table/heading preservation, chunking (headings, overlap, PDF
page markers), hashing/change detection, fee-figure extraction, prompt-injection neutralisation, freshness states, intent
detection and Roman-Urdu expansion, embedding determinism/relevance ordering, and admin session tamper/expiry rejection.

**Not yet measured (no fabricated numbers):** retrieval recall, citation correctness rate, groundedness, unsupported-answer
rate, latency percentiles and failure rate against a labelled evaluation set. The intended method: label 30–50 real
questions with their official answers and source URLs, then compute recall@k and citation correctness automatically and
audit groundedness on a sample. These are listed as outstanding work rather than claimed.

---

## 7. Known limitations

1. Official hosts block automated crawls from this environment (HTTP 403); only operator-assisted snapshots are indexed
   until the crawler is run from a permitted network.
2. The default embedding model is a lightweight hashed n-gram model, not a transformer; it is replaceable via
   `EMBEDDING_PROVIDER=ollama`.
3. No vector database extension (pgvector/FAISS/Chroma) is installed; embeddings are stored as JSONB and scored in
   application memory over a bounded candidate set (fine for tens of thousands of chunks, not millions).
4. Fee-conflict detection is heuristic (pipe-table figure comparison within a campus).
5. Urdu-script answer quality depends on the chosen model; the extractive fallback uses translated templates and keeps
   official text in English.
6. OCR requires an operator-provided service; otherwise scanned notices stay visibly `ocr_pending`.
7. Background manual crawls run in-process; on serverless hosting a long crawl should be moved to a worker.
8. The assistant is not an official university channel and never completes applications, payments or other consequential
   actions.

---

## 8. Phase status

| Phase | State |
| --- | --- |
| 1. Source discovery report | Done (§4, `/sources`) |
| 2. Safe crawler + text/links | Implemented and unit-tested; live fetch blocked by host here |
| 3. PDF/OCR, metadata, dedup | Implemented; no verified PDF ingested in this environment |
| 4. Searchable KB + hybrid retrieval | Done |
| 5. Configurable LLM + grounded RAG | Done, with deterministic offline fallback |
| 6. Responsive chat UI | Done |
| 7. Scheduled updates + authenticated admin | Done |
| 8. Evaluation, security tests, monitoring docs | Unit/security tests done; labelled evaluation outstanding |
