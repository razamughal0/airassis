/**
 * Central configuration. Everything that operators may need to change is read
 * from environment variables (see README) and can be overridden at runtime by
 * an authenticated administrator through the settings table.
 */

export const CAMPUSES = [
  "karachi",
  "islamabad-main",
  "kharian",
  "multan",
  "kamra",
  "bahu",
  "university-wide",
  "unknown",
] as const;

export type Campus = (typeof CAMPUSES)[number];

export const CAMPUS_LABELS: Record<string, string> = {
  karachi: "Karachi Campus",
  "islamabad-main": "Islamabad Main Campus",
  kharian: "Kharian Campus",
  multan: "Multan Campus",
  kamra: "Kamra (A&AC) Campus",
  bahu: "Bahu Campus",
  "university-wide": "University-wide",
  unknown: "Unscoped",
};

export const PAGE_TYPES = [
  "admissions",
  "eligibility",
  "fees",
  "scholarship",
  "programs",
  "how-to-apply",
  "documents",
  "faq",
  "notices",
  "contact",
  "campus-info",
  "about",
  "general",
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

export const DEFAULT_ALLOWED_DOMAINS = [
  "au.edu.pk",
  "www.au.edu.pk",
  "khi.au.edu.pk",
  "khiportals.au.edu.pk",
  "webdata.au.edu.pk",
  "portals.au.edu.pk",
  "admissions.au.edu.pk",
  "admission.au.edu.pk",
  "kc.au.edu.pk",
  "multan.au.edu.pk",
  "kamra.au.edu.pk",
  "aack.au.edu.pk",
];

export type CrawlerConfig = {
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

export type RetrievalConfig = {
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

export type LlmConfig = {
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

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const defaultCrawlerConfig: CrawlerConfig = {
  startUrl: process.env.CRAWL_START_URL ?? "https://khi.au.edu.pk/",
  allowedDomains: (process.env.CRAWL_ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS.join(","))
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
  maxPages: num(process.env.CRAWL_MAX_PAGES, 40),
  maxDepth: num(process.env.CRAWL_MAX_DEPTH, 3),
  concurrency: Math.min(4, Math.max(1, num(process.env.CRAWL_CONCURRENCY, 2))),
  // Polite by default: 750ms between requests to the same host.
  requestDelayMs: num(process.env.CRAWL_DELAY_MS, 750),
  timeoutMs: num(process.env.CRAWL_TIMEOUT_MS, 15000),
  maxRetries: num(process.env.CRAWL_MAX_RETRIES, 2),
  maxDocumentMb: num(process.env.CRAWL_MAX_DOCUMENT_MB, 15),
  userAgent:
    process.env.CRAWL_USER_AGENT ??
    "AU-KnowledgeBot/1.0 (academic information assistant; contact: knowledge@au.example.edu)",
  followPdfs: (process.env.CRAWL_FOLLOW_PDFS ?? "true") !== "false",
  followImages: (process.env.CRAWL_FOLLOW_IMAGES ?? "false") === "true",
  respectRobots: (process.env.CRAWL_RESPECT_ROBOTS ?? "true") !== "false",
};

export const defaultRetrievalConfig: RetrievalConfig = {
  topK: num(process.env.RETRIEVAL_TOP_K, 8),
  minConfidence: num(process.env.RETRIEVAL_MIN_CONFIDENCE, 0.3),
  chunkSize: num(process.env.RETRIEVAL_CHUNK_SIZE, 1100),
  chunkOverlap: num(process.env.RETRIEVAL_CHUNK_OVERLAP, 180),
  embeddingProvider: process.env.EMBEDDING_PROVIDER === "ollama" ? "ollama" : "hash",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "hash-ngram-384",
  vectorWeight: num(process.env.RETRIEVAL_VECTOR_WEIGHT, 0.45),
  keywordWeight: num(process.env.RETRIEVAL_KEYWORD_WEIGHT, 0.55),
  staleAfterDays: num(process.env.RETRIEVAL_STALE_DAYS, 30),
};

export const defaultLlmConfig: LlmConfig = {
  provider: (process.env.LLM_PROVIDER as LlmConfig["provider"]) ?? "extractive",
  model:
    process.env.LLM_MODEL ??
    (process.env.LLM_PROVIDER === "ollama" ? "llama3.2:3b" : "grounded-extractive-v1"),
  temperature: num(process.env.LLM_TEMPERATURE, 0.2),
  maxOutputTokens: num(process.env.LLM_MAX_OUTPUT_TOKENS, 700),
  timeoutMs: num(process.env.LLM_TIMEOUT_MS, 60000),
  maxRetries: num(process.env.LLM_MAX_RETRIES, 1),
  streaming: (process.env.LLM_STREAMING ?? "true") !== "false",
  contextChunks: num(process.env.LLM_CONTEXT_CHUNKS, 6),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
  hostedBaseUrl: process.env.HOSTED_LLM_BASE_URL ?? "https://api.openai.com/v1",
};

export const MIN_CONFIDENCE_FLOOR = 0.12;

export const APP_NAME = "Air University Knowledge Assistant";
export const APP_SCOPE_NOTE =
  "AI-generated explanations, not an official university statement. Official sources are linked with every answer.";

export const SUPPORTED_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "roman-ur", label: "Roman Urdu" },
  { id: "ur", label: "اردو" },
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number]["id"];
