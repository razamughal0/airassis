import { db } from "@/db";
import { chunks, documents } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getSettings, AppSettings } from "@/lib/settings";
import type { Campus } from "@/lib/config";
import { embedQuery, cosineSimilarity } from "./embeddings";
import { sanitizeUntrustedText } from "@/lib/ingestion/text";

export type QueryIntent =
  | "fees"
  | "deadline"
  | "eligibility"
  | "documents"
  | "how-to-apply"
  | "scholarship"
  | "programs"
  | "facilities"
  | "contact"
  | "general";

export type RetrievedPassage = {
  chunkId: number;
  documentId: number;
  title: string;
  sourceUrl: string;
  campus: string;
  pageType: string;
  contentType: string;
  effectiveSession: string | null;
  heading: string | null;
  pageNumber: number | null;
  content: string;
  retrievedAt: string;
  lastModified: string | null;
  freshness: string;
  trustLevel: string;
  extractionMode: string;
  keywordScore: number;
  vectorScore: number;
  combinedScore: number;
  intentMatch: boolean;
};

export type RetrievalFilters = {
  campuses?: Campus[];
  pageTypes?: string[];
  session?: string;
};

export type RetrievalResult = {
  passages: RetrievedPassage[];
  intent: QueryIntent;
  queryVariants: string[];
  confidence: number;
  belowThreshold: boolean;
  campusesInResults: string[];
  usedFallback: boolean;
};

const INTENT_PATTERNS: { intent: QueryIntent; patterns: RegExp[] }[] = [
  { intent: "fees", patterns: [/fee/i, /tuition/i, /charge/i, /fees? kitn/i, /pais/i, /cost/i, /expense/i, /semester fee/i] },
  { intent: "deadline", patterns: [/deadline/i, /last date/i, /closing/i, /schedule/i, /kab tak/i, /aakhri tareekh/i, /due date/i, /apply by/i] },
  { intent: "eligibility", patterns: [/eligib/i, /criteria/i, /requirement/i, /marks? chahiye/i, /percentage/i, /kya zaroori/i, /minimum marks/i] },
  { intent: "documents", patterns: [/document/i, /certificate/i, /cnic/i, /b-?form/i, /equivalence/i, /kaghaz/i, /papers?/i, /attest/i] },
  { intent: "how-to-apply", patterns: [/how (do|can|to) (i )?apply/i, /application procedure/i, /apply/i, /form/i, /portal/i, /kaise apply/i, /apply kaise/i] },
  { intent: "scholarship", patterns: [/scholar/i, /financial aid/i, /grant/i, /concession/i, /waiver/i, /ehsaas/i, /peef/i, /wazifa/i] },
  { intent: "programs", patterns: [/program/i, /degree/i, /bs |ms |bba/i, /department/i, /faculty/i, /course/i, /kaunsi degree/i] },
  { intent: "facilities", patterns: [/hostel/i, /transport/i, /library/i, /lab/i, /facilit/i, /bus/i, /accommodation/i] },
  { intent: "contact", patterns: [/contact/i, /phone/i, /email/i, /address/i, /number/i, /rabta/i, /office/i] },
];

const INTENT_PAGE_TYPES: Record<QueryIntent, string[]> = {
  fees: ["fees"],
  deadline: ["notices", "admissions", "how-to-apply"],
  eligibility: ["eligibility", "admissions", "faq"],
  documents: ["documents", "how-to-apply", "faq", "admissions"],
  "how-to-apply": ["how-to-apply", "admissions", "documents", "faq"],
  scholarship: ["scholarship", "fees"],
  programs: ["programs", "about", "admissions"],
  facilities: ["campus-info", "faq"],
  contact: ["contact", "campus-info", "faq"],
  general: [],
};

const ROMAN_URDU_GLOSSARY: Record<string, string> = {
  fees: "fees",
  fee: "fees",
  kitni: "how much",
  kitna: "how much",
  paisa: "fee",
  paise: "fee",
  zahir: "required",
  zaroori: "required",
  zaruri: "required",
  kaghaz: "documents",
  kaghazat: "documents",
  darkhwast: "application",
  aakhri: "last",
  tareekh: "date",
  kab: "when",
  kahan: "where",
  kaise: "how",
  apply: "apply",
  milega: "available",
  milegi: "available",
  hostal: "hostel",
  bus: "transport",
  wazifa: "scholarship",
  scholarship: "scholarship",
  imtihan: "test",
  test: "test",
  marks: "marks",
  percentage: "percentage",
  admission: "admission",
  dakhla: "admission",
  numbar: "number",
  rabta: "contact",
};

export function detectIntent(query: string): QueryIntent {
  for (const entry of INTENT_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(query))) return entry.intent;
  }
  return "general";
}

export function expandQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const tokens = lower.split(/[^a-z0-9.\u0600-\u06ff-]+/).filter(Boolean);
  const translated = tokens.map((token) => ROMAN_URDU_GLOSSARY[token] ?? token);
  const variants = new Set<string>([lower, translated.join(" ")]);
  if (/^(what|how|when|where|who|kya|kaise|kab)/.test(lower)) {
    variants.add(tokens.filter((token) => token.length > 3).join(" "));
  }
  if (/\bfee/i.test(lower) || tokens.some((token) => ["kitni", "kitna", "paisa", "paise"].includes(token))) {
    variants.add(`${translated.join(" ")} tuition per credit hour first semester`);
  }
  return Array.from(variants).filter((variant) => variant.trim().length > 1).slice(0, 3);
}

const WORD_RE = /[a-z0-9\u0600-\u06ff][a-z0-9\u0600-\u06ff.,%-]*/gi;

function normalizeToken(token: string) {
  return token.toLowerCase().replace(/[.,]+$/g, "");
}

export function keywordOverlap(query: string, text: string): number {
  const queryTokens = (query.match(WORD_RE) ?? []).map(normalizeToken).filter((token) => token.length > 1);
  if (!queryTokens.length) return 0;
  const textLower = text.toLowerCase();
  let matches = 0;
  for (const token of new Set(queryTokens)) {
    if (textLower.includes(token)) matches += token.length > 4 ? 1.4 : 1;
  }
  return matches / Math.sqrt(new Set(queryTokens).size + 2);
}

function recencyAdjustment(retrievedAt: string, freshness: string): number {
  if (freshness === "expired") return -0.25;
  if (freshness === "stale") return -0.08;
  const ageDays = (Date.now() - new Date(retrievedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 7) return 0.05;
  if (ageDays < 45) return 0.02;
  return 0;
}

export async function retrieve(query: string, filters: RetrievalFilters = {}, settingsOverride?: AppSettings): Promise<RetrievalResult> {
  const settings = settingsOverride ?? (await getSettings());
  const intent = detectIntent(query);
  const variants = expandQuery(query);
  const campuses = filters.campuses ?? ["karachi", "university-wide"];
  const useAutoCampus = campuses.length === 0;

  const conditions = [eq(documents.active, true), eq(documents.processingStatus, "indexed")];
  if (!useAutoCampus && campuses.length) conditions.push(inArray(documents.campus, campuses));
  if (filters.pageTypes?.length) conditions.push(inArray(documents.pageType, filters.pageTypes));

  const rows = await db
    .select({
      chunkId: chunks.id,
      documentId: documents.id,
      title: documents.title,
      sourceUrl: documents.sourceUrl,
      campus: documents.campus,
      pageType: documents.pageType,
      contentType: documents.contentType,
      effectiveSession: documents.effectiveSession,
      heading: chunks.heading,
      pageNumber: chunks.pageNumber,
      content: chunks.content,
      embedding: chunks.embedding,
      retrievedAt: documents.crawlTimestamp,
      lastModified: documents.lastModified,
      freshness: documents.freshness,
      trustLevel: documents.trustLevel,
      extractionMode: documents.extractionMode,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(and(...conditions))
    .limit(1200);

  const { vector: queryVector } = await embedQuery(`${query}\n${variants.join(" ")}`, {
    provider: settings.retrieval.embeddingProvider,
    model: settings.retrieval.embeddingModel,
    ollamaBaseUrl: settings.llm.ollamaBaseUrl,
  });

  const pageTypesForIntent = INTENT_PAGE_TYPES[intent];
  const scored: RetrievedPassage[] = rows.map((row) => {
    const haystack = `${row.title}\n${row.heading ?? ""}\n${row.content}`;
    const sanitized = sanitizeUntrustedText(haystack).text;
    const keywordScore = Math.min(1, keywordOverlap(`${variants.join(" ")} ${query}`, sanitized) / 5);
    const vectorScore = row.embedding ? Math.max(0, cosineSimilarity(queryVector, row.embedding)) : 0;
    const intentMatch = pageTypesForIntent.includes(row.pageType);
    const titleBonus = /[a-z]{3,}/i.test(query) && row.title.toLowerCase().includes(query.toLowerCase().split(" ")[0]) ? 0.05 : 0;
    const sessionBonus = filters.session && row.effectiveSession === filters.session ? 0.04 : 0;
    const combined = Math.min(
      1,
      Math.max(
        0,
        settings.retrieval.keywordWeight * keywordScore +
          settings.retrieval.vectorWeight * vectorScore +
          (intentMatch ? 0.12 : 0) +
          (row.trustLevel === "official" || row.trustLevel === "official-portal" ? 0.03 : 0) +
          titleBonus +
          sessionBonus +
          recencyAdjustment(row.retrievedAt.toISOString(), row.freshness),
      ),
    );
    return {
      chunkId: row.chunkId,
      documentId: row.documentId,
      title: row.title,
      sourceUrl: row.sourceUrl,
      campus: row.campus,
      pageType: row.pageType,
      contentType: row.contentType,
      effectiveSession: row.effectiveSession,
      heading: row.heading,
      pageNumber: row.pageNumber,
      content: sanitizeUntrustedText(row.content).text,
      retrievedAt: row.retrievedAt.toISOString(),
      lastModified: row.lastModified ? row.lastModified.toISOString() : null,
      freshness: row.freshness,
      trustLevel: row.trustLevel,
      extractionMode: row.extractionMode,
      keywordScore: Number(keywordScore.toFixed(4)),
      vectorScore: Number(vectorScore.toFixed(4)),
      combinedScore: Number(combined.toFixed(4)),
      intentMatch,
    };
  });

  // Rerank: intent-aligned documents first, then score; keep at most 2 chunks
  // per document so one long fee table cannot crowd out other sources.
  scored.sort((a, b) => {
    if (a.intentMatch !== b.intentMatch) return a.intentMatch ? -1 : 1;
    return b.combinedScore - a.combinedScore;
  });

  const perDocument = new Map<number, number>();
  const selected: RetrievedPassage[] = [];
  for (const passage of scored) {
    const count = perDocument.get(passage.documentId) ?? 0;
    if (count >= 2) continue;
    perDocument.set(passage.documentId, count + 1);
    selected.push(passage);
    if (selected.length >= settings.retrieval.topK) break;
  }

  // Focus: keep the strongest passages and drop far weaker ones so an
  // unrelated but merely reachable page never becomes "evidence".
  const strongest = selected[0]?.combinedScore ?? 0;
  const focused = selected.filter((passage, index) => index < 2 || passage.combinedScore >= strongest * 0.5);

  const best = focused[0]?.combinedScore ?? 0;
  const supportive = focused.slice(0, 3).reduce((sum, passage) => sum + passage.combinedScore, 0) / Math.max(1, Math.min(3, focused.length));
  const confidence = Number(Math.min(1, best * 0.7 + supportive * 0.3).toFixed(3));

  // Lexical fallback for exact figures / rare wording that hashed embeddings miss.
  let usedFallback = false;
  if (!selected.length) {
    const fallback = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(chunks)
      .innerJoin(documents, eq(chunks.documentId, documents.id))
      .where(and(eq(documents.active, true), sql`${chunks.content} ilike ${`%${query.slice(0, 40)}%`}`));
    usedFallback = (fallback[0]?.count ?? 0) > 0;
  }

  const campusesInResults = Array.from(new Set(focused.map((passage) => passage.campus)));

  return {
    passages: focused,
    intent,
    queryVariants: variants,
    confidence,
    belowThreshold: confidence < settings.retrieval.minConfidence || focused.length === 0,
    campusesInResults,
    usedFallback,
  };
}
