import { db } from "@/db";
import { conflicts, conversations, documents, messages, type Citation } from "@/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getSettings } from "@/lib/settings";
import { retrieve, detectIntent, type RetrievedPassage } from "@/lib/knowledge/retriever";
import { answerWithFallback } from "@/lib/llm";
import { SOURCE_GAPS } from "@/lib/seed/corpus";
import type { Campus, Language } from "@/lib/config";

export type ChatRequestBody = {
  message: string;
  conversationId?: number | null;
  sessionId: string;
  language?: Language;
  campus?: "auto" | Campus;
};

export type ChatAnswer = {
  conversationId: number;
  userMessageId: number;
  assistantMessageId: number;
  answer: string;
  citations: Citation[];
  evidence: { sourceIndex: number; claim: string }[];
  confidence: number;
  verificationStatus: "verified" | "partial" | "unverified";
  scopeNote: string;
  provider: string;
  providerLabel: string;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  clarificationNeeded: boolean;
  conflictWarnings: string[];
  retrievedAt: string;
  language: Language;
};

const CAMPUS_PATTERNS: { campus: Campus; patterns: RegExp }[] = [
  { campus: "karachi", patterns: /\bkarachi\b|\bkhi\b|\bsindh\b/i },
  { campus: "islamabad-main", patterns: /\bislamabad\b|\bmain campus\b|\be-?9\b|\bh-?11\b/i },
  { campus: "kharian", patterns: /\bkharian\b/i },
  { campus: "multan", patterns: /\bmultan\b/i },
  { campus: "kamra", patterns: /\bkamra\b|\ba&ac\b|\baerospace and aviation\b/i },
  { campus: "bahu", patterns: /\bbahu\b|\bshorkot\b/i },
];

export function detectMentionedCampus(query: string): Campus | null {
  const match = CAMPUS_PATTERNS.find((entry) => entry.patterns.test(query));
  return match?.campus ?? null;
}

const CLOSING_CLAIM = /(last date|deadline|closing date|apply by|applications? close|admission schedule)/i;
const DATE_CLAIM = /\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/i;

const DEFAULT_OFFICIAL_LINKS = [
  { label: "AU Karachi Campus admissions", url: "https://khi.au.edu.pk/Pages/Admission/how_to_apply.aspx" },
  { label: "AU Karachi fee structure", url: "https://khi.au.edu.pk/Pages/Admission/fees_financial.aspx" },
  { label: "AU Karachi online admission portal", url: "https://khiportals.au.edu.pk/admissions" },
  { label: "AU main website", url: "https://www.au.edu.pk/" },
];

function buildScopeNote(campusFilter: "auto" | Campus, campusesUsed: string[]): string {
  if (campusFilter === "auto") {
    const labels = campusesUsed.map((campus) => campus.replace(/-/g, " "));
    return `Scope: no campus was specified, so retrieval prioritised the Karachi Campus plus university-wide material${
      labels.length ? ` (sources used: ${Array.from(new Set(labels)).join(", ")})` : ""
    }. Fees and deadlines differ by campus — specify a campus for a stricter answer.`;
  }
  return `Scope: retrieval was limited to ${campusFilter.replace(/-/g, " ")} plus university-wide material.`;
}

function provenanceNotesFor(passages: RetrievedPassage[]): string[] {
  const notes: string[] = [];
  if (passages.some((passage) => passage.extractionMode === "operator_snapshot")) {
    notes.push(
      "Some evidence comes from an operator-assisted snapshot of official pages (the host blocked automated crawling with HTTP 403). Confirm time-sensitive figures on the official page before acting.",
    );
  }
  if (passages.some((passage) => passage.freshness !== "fresh")) {
    notes.push("At least one source is flagged stale/expired by the freshness policy; re-verify it.");
  }
  return notes;
}

function gapAdvisory(intent: string): string | null {
  if (intent === "deadline") {
    return "Coverage gap: no verified official Karachi closing date is indexed. Third-party admission websites publish conflicting dates (for example different April and July 2026 dates), and those claims are deliberately excluded from answers.";
  }
  if (intent === "facilities") {
    return "Coverage gap: the retrieved official Karachi pages do not document hostel or transport provision, so availability cannot be confirmed either way.";
  }
  if (intent === "documents") {
    return "Coverage gap: the dedicated Karachi required-documents page could not be read during the last update; the document list below comes from the campus FAQ and portal pages.";
  }
  return null;
}

function toCitations(passages: RetrievedPassage[]): Citation[] {
  return passages.map((passage, index) => ({
    index: index + 1,
    title: passage.title,
    url: passage.sourceUrl,
    campus: passage.campus,
    pageType: passage.pageType,
    contentType: passage.contentType,
    section: passage.heading,
    pageNumber: passage.pageNumber,
    retrievedAt: passage.retrievedAt,
    effectiveSession: passage.effectiveSession,
    lastModified: passage.lastModified,
    freshness: passage.freshness,
    trustLevel: passage.trustLevel,
    excerpt: passage.content.replace(/\s+/g, " ").slice(0, 320),
    score: passage.combinedScore,
  }));
}

function toEvidence(passages: RetrievedPassage[]): { sourceIndex: number; claim: string }[] {
  return passages.slice(0, 5).map((passage, index) => ({
    sourceIndex: index + 1,
    claim: passage.content
      .replace(/\s+/g, " ")
      .replace(/^[#|\s-]+/, "")
      .slice(0, 220),
  }));
}

export async function answerQuestion(
  body: ChatRequestBody,
  onToken?: (token: string) => void,
): Promise<ChatAnswer> {
  const startedAt = Date.now();
  const settings = await getSettings();
  const language: Language = body.language ?? "en";
  const query = body.message.trim().slice(0, 1500);
  const sessionId = body.sessionId.slice(0, 80);

  let conversationId = body.conversationId ?? null;
  let history: { role: string; content: string }[] = [];
  if (conversationId) {
    const found = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.sessionId, sessionId)))
      .limit(1);
    if (!found.length) conversationId = null;
  }
  if (!conversationId) {
    const [created] = await db
      .insert(conversations)
      .values({
        sessionId,
        title: query.slice(0, 90),
        language,
        campusScope: body.campus ?? "auto",
      })
      .returning({ id: conversations.id });
    conversationId = created.id;
  } else {
    const previous = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.id))
      .limit(6);
    history = previous.reverse();
  }

  const [userMessage] = await db
    .insert(messages)
    .values({ conversationId, role: "user", content: query, language })
    .returning({ id: messages.id });

  const lastUserQuery = [...history].reverse().find((entry) => entry.role === "user")?.content ?? "";
  const retrievalQuery =
    query.length < 32 && lastUserQuery ? `${lastUserQuery} — follow-up: ${query}` : query;

  const mentionedCampus = detectMentionedCampus(retrievalQuery);
  const requestedCampus = body.campus && body.campus !== "auto" ? body.campus : null;
  const campusFilter: "auto" | Campus = requestedCampus ?? (mentionedCampus ? mentionedCampus : "auto");
  const campuses: Campus[] =
    campusFilter === "auto"
      ? ["karachi", "university-wide"]
      : campusFilter === "university-wide"
        ? ["university-wide"]
        : [campusFilter, "university-wide"];

  const result = await retrieve(retrievalQuery, { campuses }, settings);
  const passages = result.passages;
  const intent = result.intent;
  const campusesUsed = Array.from(new Set(passages.map((passage) => passage.campus)));
  const scopeNote = buildScopeNote(campusFilter === "auto" ? "auto" : campusFilter, campusesUsed);
  const provenanceNotes = provenanceNotesFor(passages);
  const advisory = gapAdvisory(intent);
  if (advisory) provenanceNotes.push(advisory);

  let conflictWarnings: string[] = [];
  if (passages.length) {
    const documentIds = passages.map((passage) => passage.documentId);
    const rows = await db
      .select()
      .from(conflicts)
      .where(and(eq(conflicts.status, "open"), inArray(conflicts.documentAId, documentIds)))
      .limit(4);
    conflictWarnings = rows.map((row) => row.description);
  }

  const explicitCampus = Boolean(requestedCampus) || Boolean(mentionedCampus);
  const clarificationNeeded =
    !explicitCampus && ["fees", "deadline", "eligibility", "documents"].includes(intent) && campusesUsed.length > 1;

  const answerPassages = passages.slice(0, 5);
  // Time-sensitive questions need a real date in the evidence, not just a page
  // that happens to mention admissions.
  const deadlineUngrounded =
    intent === "deadline" && !passages.some((passage) => CLOSING_CLAIM.test(passage.content) && DATE_CLAIM.test(passage.content));
  const facilitiesUngrounded =
    intent === "facilities" &&
    !passages.some((passage) => /(hostel|transport|bus service|accommodation|library)/i.test(passage.content));

  const lowConfidence = result.belowThreshold || passages.length === 0;
  const verificationStatus: ChatAnswer["verificationStatus"] = lowConfidence
    ? "unverified"
    : deadlineUngrounded || facilitiesUngrounded
      ? "partial"
      : result.confidence >= 0.32 && passages.every((passage) => passage.freshness === "fresh")
        ? "verified"
        : "partial";

  const leadCaveat = deadlineUngrounded
    ? "I could not verify an official closing date for the current admission session. No indexed official page states one, so I will not quote a date. Third-party admission websites publish conflicting dates and are excluded."
    : facilitiesUngrounded
      ? "The indexed official pages do not state whether hostel or transport facilities are available, so I cannot confirm or deny availability."
      : undefined;

  let answer = "";
  const draft = await answerWithFallback(
    {
      query,
      intent,
      leadCaveat,
      passages: lowConfidence ? [] : answerPassages,
      language,
      scopeNote,
      conflicts: conflictWarnings,
      provenanceNotes,
      conversationContext: history.map((entry) => `${entry.role}: ${entry.content.slice(0, 200)}`).join("\n"),
      config: settings.llm,
    },
    (token) => {
      answer += token;
      onToken?.(token);
    },
  );

  let finalAnswer = draft.text;
  if (clarificationNeeded) {
    finalAnswer += `\n\n> **Campus clarification:** You did not specify a campus. Karachi Campus figures are different from Islamabad/Kharian, so please confirm which campus you mean if the answer must be exact.`;
  }
  if (lowConfidence) {
    finalAnswer += `\n\n**Official links:**\n${DEFAULT_OFFICIAL_LINKS.map((link) => `- [${link.label}](${link.url})`).join("\n")}`;
    if (!answer.includes("Official links")) onToken?.("\n\nSee the official links above.");
  }
  if (draft.fallbackUsed) {
    finalAnswer += `\n\n> Local language model unavailable (${draft.fallbackReason}). This answer was composed directly from retrieved official text.`;
  }

  const citations = toCitations(lowConfidence ? [] : answerPassages);
  const [assistantMessage] = await db
    .insert(messages)
    .values({
      conversationId,
      role: "assistant",
      content: finalAnswer,
      language,
      citations,
      evidence: toEvidence(lowConfidence ? [] : answerPassages),
      confidence: result.confidence,
      verificationStatus,
      scopeNote,
      provider: draft.provider,
      model: draft.model,
      latencyMs: Date.now() - startedAt,
    })
    .returning({ id: messages.id });

  await db
    .update(conversations)
    .set({
      updatedAt: new Date(),
      messageCount: sql`${conversations.messageCount} + 2`,
      title: sql`case when ${conversations.messageCount} = 0 then ${query.slice(0, 90)} else ${conversations.title} end`,
      language,
      campusScope: campusFilter,
    })
    .where(eq(conversations.id, conversationId));

  return {
    conversationId,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    answer: finalAnswer,
    citations,
    evidence: toEvidence(lowConfidence ? [] : answerPassages),
    confidence: result.confidence,
    verificationStatus,
    scopeNote,
    provider: draft.provider,
    providerLabel: draft.providerLabel,
    model: draft.model,
    latencyMs: Date.now() - startedAt,
    fallbackUsed: draft.fallbackUsed,
    clarificationNeeded,
    conflictWarnings,
    retrievedAt: new Date().toISOString(),
    language,
  };
}

export async function getConversation(conversationId: number, sessionId: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.sessionId, sessionId)))
    .limit(1);
  if (!rows.length) return null;
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id));
  return {
    conversation: rows[0],
    messages: history.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      citations: message.citations ?? [],
      confidence: message.confidence,
      verificationStatus: message.verificationStatus,
      scopeNote: message.scopeNote,
      provider: message.provider,
      model: message.model,
      latencyMs: message.latencyMs,
      language: message.language,
      createdAt: message.createdAt,
    })),
  };
}

export async function listConversations(sessionId: string) {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
      messageCount: conversations.messageCount,
      language: conversations.language,
    })
    .from(conversations)
    .where(eq(conversations.sessionId, sessionId))
    .orderBy(desc(conversations.updatedAt))
    .limit(25);
}

export async function sourceReport() {
  const rows = await db
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
      lastModified: documents.lastModified,
      effectiveSession: documents.effectiveSession,
      chunkCount: documents.chunkCount,
      version: documents.version,
      active: documents.active,
      httpStatus: documents.httpStatus,
      provenanceNote: documents.provenanceNote,
    })
    .from(documents)
    .orderBy(desc(documents.crawlTimestamp))
    .limit(200);
  return rows;
}

export function coverageGaps() {
  return SOURCE_GAPS;
}

export function intentOf(query: string) {
  return detectIntent(query);
}
