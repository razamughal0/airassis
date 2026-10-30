import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  CrawlerConfig,
  LlmConfig,
  RetrievalConfig,
  defaultCrawlerConfig,
  defaultLlmConfig,
  defaultRetrievalConfig,
} from "./config";

export type AppSettings = {
  crawler: CrawlerConfig;
  retrieval: RetrievalConfig;
  llm: LlmConfig;
};

export const defaultSettings: AppSettings = {
  crawler: defaultCrawlerConfig,
  retrieval: defaultRetrievalConfig,
  llm: defaultLlmConfig,
};

type SettingsKey = keyof AppSettings;

function merge<T extends object>(base: T, override: unknown): T {
  if (!override || typeof override !== "object") return base;
  return { ...base, ...(override as Partial<T>) };
}

export async function getSettings(): Promise<AppSettings> {
  const result: AppSettings = {
    crawler: { ...defaultSettings.crawler, allowedDomains: [...defaultSettings.crawler.allowedDomains] },
    retrieval: { ...defaultSettings.retrieval },
    llm: { ...defaultSettings.llm },
  };
  try {
    const rows = await db.select().from(appSettings);
    for (const row of rows) {
      if (row.key === "crawler") result.crawler = merge(result.crawler, row.value);
      if (row.key === "retrieval") result.retrieval = merge(result.retrieval, row.value);
      if (row.key === "llm") result.llm = merge(result.llm, row.value);
    }
  } catch {
    // Settings table may not exist yet (fresh database). Defaults are safe.
  }
  return result;
}

export async function saveSetting(key: SettingsKey, value: Record<string, unknown>) {
  const existing = await db
    .update(appSettings)
    .set({ value, updatedAt: new Date() })
    .where(eq(appSettings.key, key))
    .returning({ key: appSettings.key });
  if (!existing.length) {
    await db.insert(appSettings).values({ key, value }).onConflictDoNothing();
  }
  return { key, value };
}

export function sanitizeCrawlerConfig(input: unknown, base: CrawlerConfig): CrawlerConfig {
  const raw = (input ?? {}) as Record<string, unknown>;
  const domains = Array.isArray(raw.allowedDomains)
    ? raw.allowedDomains
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => /^[a-z0-9.-]+$/.test(entry))
    : base.allowedDomains;
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  };
  return {
    ...base,
    allowedDomains: Array.from(new Set(domains)).slice(0, 60),
    startUrl: typeof raw.startUrl === "string" && /^https?:\/\//.test(raw.startUrl) ? raw.startUrl : base.startUrl,
    maxPages: clamp(raw.maxPages, 1, 300, base.maxPages),
    maxDepth: clamp(raw.maxDepth, 0, 6, base.maxDepth),
    concurrency: clamp(raw.concurrency, 1, 4, base.concurrency),
    requestDelayMs: clamp(raw.requestDelayMs, 0, 10000, base.requestDelayMs),
    timeoutMs: clamp(raw.timeoutMs, 3000, 60000, base.timeoutMs),
    maxRetries: clamp(raw.maxRetries, 0, 5, base.maxRetries),
    maxDocumentMb: clamp(raw.maxDocumentMb, 1, 60, base.maxDocumentMb),
    followPdfs: typeof raw.followPdfs === "boolean" ? raw.followPdfs : base.followPdfs,
    followImages: typeof raw.followImages === "boolean" ? raw.followImages : base.followImages,
    respectRobots: typeof raw.respectRobots === "boolean" ? raw.respectRobots : base.respectRobots,
    userAgent: typeof raw.userAgent === "string" && raw.userAgent.length > 8 ? raw.userAgent.slice(0, 240) : base.userAgent,
  };
}

export function sanitizeLlmConfig(input: unknown, base: LlmConfig): LlmConfig {
  const raw = (input ?? {}) as Record<string, unknown>;
  const provider =
    raw.provider === "ollama" || raw.provider === "lmstudio" || raw.provider === "hosted" || raw.provider === "extractive"
      ? raw.provider
      : base.provider;
  const temperature = Number(raw.temperature);
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  return {
    ...base,
    provider,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim().slice(0, 120) : base.model,
    temperature: Number.isFinite(temperature) ? clamp(temperature, 0, 1, base.temperature) : base.temperature,
    maxOutputTokens: clamp(raw.maxOutputTokens, 120, 3000, base.maxOutputTokens),
    timeoutMs: clamp(raw.timeoutMs, 3000, 180000, base.timeoutMs),
    maxRetries: clamp(raw.maxRetries, 0, 4, base.maxRetries),
    streaming: typeof raw.streaming === "boolean" ? raw.streaming : base.streaming,
    contextChunks: clamp(raw.contextChunks, 2, 12, base.contextChunks),
    ollamaBaseUrl: typeof raw.ollamaBaseUrl === "string" ? raw.ollamaBaseUrl.slice(0, 200) : base.ollamaBaseUrl,
    lmStudioBaseUrl: typeof raw.lmStudioBaseUrl === "string" ? raw.lmStudioBaseUrl.slice(0, 200) : base.lmStudioBaseUrl,
    hostedBaseUrl: typeof raw.hostedBaseUrl === "string" ? raw.hostedBaseUrl.slice(0, 200) : base.hostedBaseUrl,
  };
}

export function sanitizeRetrievalConfig(input: unknown, base: RetrievalConfig): RetrievalConfig {
  const raw = (input ?? {}) as Record<string, unknown>;
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  return {
    ...base,
    topK: clamp(raw.topK, 2, 20, base.topK),
    minConfidence: clamp(raw.minConfidence, 0.05, 0.9, base.minConfidence),
    chunkSize: clamp(raw.chunkSize, 400, 3000, base.chunkSize),
    chunkOverlap: clamp(raw.chunkOverlap, 0, 600, base.chunkOverlap),
    vectorWeight: clamp(raw.vectorWeight, 0, 1, base.vectorWeight),
    keywordWeight: clamp(raw.keywordWeight, 0, 1, base.keywordWeight),
    staleAfterDays: clamp(raw.staleAfterDays, 1, 365, base.staleAfterDays),
    embeddingProvider: raw.embeddingProvider === "ollama" ? "ollama" : base.embeddingProvider,
    embeddingModel:
      typeof raw.embeddingModel === "string" && raw.embeddingModel.trim()
        ? raw.embeddingModel.trim().slice(0, 120)
        : base.embeddingModel,
  };
}
