import { db } from "@/db";
import { chunks as chunksTable, conflicts, documentVersions, documents, sources } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { getSettings, AppSettings } from "@/lib/settings";
import { embedTexts } from "@/lib/knowledge/embeddings";
import { chunkDocument, estimateTokens, extractFeeFigures, freshnessOf, normalizeContent, sha256 } from "./text";
import type { Campus, PageType } from "@/lib/config";

export type IngestInput = {
  sourceUrl: string;
  canonicalUrl?: string;
  title: string;
  text: string;
  campus: Campus;
  pageType: PageType;
  contentType: "html" | "pdf" | "image" | "text";
  extractionMode: "live_crawl" | "operator_snapshot" | "manual";
  httpStatus?: number | null;
  lastModified?: Date | null;
  publicationDate?: Date | null;
  expiryDate?: Date | null;
  effectiveSession?: string | null;
  trustLevel?: "official" | "official-portal" | "third-party" | "unknown";
  extractionConfidence?: number;
  processingStatus?: "indexed" | "ocr_pending" | "failed";
  error?: string | null;
  pageCount?: number | null;
  provenanceNote?: string | null;
  settings?: AppSettings;
};

export type IngestResult = {
  status: "created" | "updated" | "unchanged" | "skipped" | "failed";
  documentId?: number;
  chunkCount?: number;
  reason?: string;
  version?: number;
};

function campusFromSource(baseUrl: string, fallback: Campus): Campus {
  if (fallback !== "unknown") return fallback;
  if (/khi/i.test(baseUrl)) return "karachi";
  if (/kc\./i.test(baseUrl)) return "kharian";
  if (/webdata/i.test(baseUrl)) return "islamabad-main";
  return "university-wide";
}

async function ensureSource(url: string, campus: Campus, trustLevel: string) {
  const origin = new URL(url).origin;
  const host = new URL(url).hostname;
  const existing = await db.select().from(sources).where(eq(sources.baseUrl, origin)).limit(1);
  if (existing.length) return existing[0];
  const inserted = await db
    .insert(sources)
    .values({
      name: host,
      baseUrl: origin,
      campus: campusFromSource(origin, campus),
      scope: "discovered-by-crawler",
      trustLevel,
      notes: "Registered automatically during ingestion. Review allowlist in admin settings.",
    })
    .onConflictDoNothing({ target: sources.baseUrl })
    .returning();
  if (inserted.length) return inserted[0];
  const retry = await db.select().from(sources).where(eq(sources.baseUrl, origin)).limit(1);
  return retry[0] ?? null;
}

export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const settings = input.settings ?? (await getSettings());
  const text = normalizeContent(input.text);
  if (text.replace(/[#|\-\s]/g, "").length < 120) {
    return { status: "skipped", reason: "Extracted content was below the minimum usable length" };
  }
  const hash = sha256(text);
  const source = await ensureSource(input.sourceUrl, input.campus, input.trustLevel ?? "official");
  const campus = campusFromSource(input.sourceUrl, input.campus);
  const now = new Date();
  const freshness = freshnessOf({
    crawlTimestamp: now,
    expiryDate: input.expiryDate ?? null,
    staleAfterDays: settings.retrieval.staleAfterDays,
  });

  const existingRows = await db.select().from(documents).where(eq(documents.sourceUrl, input.sourceUrl)).limit(1);
  const existing = existingRows[0];

  if (existing && existing.contentHash === hash) {
    await db
      .update(documents)
      .set({
        crawlTimestamp: now,
        lastModified: input.lastModified ?? existing.lastModified,
        httpStatus: input.httpStatus ?? existing.httpStatus,
        freshness,
        active: true,
        error: null,
        processingStatus: existing.processingStatus === "failed" ? "indexed" : existing.processingStatus,
        updatedAt: now,
      })
      .where(eq(documents.id, existing.id));
    return { status: "unchanged", documentId: existing.id, chunkCount: existing.chunkCount, version: existing.version };
  }

  const result = await db.transaction(async (tx) => {
    let documentId: number;
    let version = 1;
    if (existing) {
      await tx.insert(documentVersions).values({
        documentId: existing.id,
        version: existing.version,
        contentHash: existing.contentHash,
        title: existing.title,
        contentText: existing.contentText,
        capturedAt: existing.crawlTimestamp,
      });
      version = existing.version + 1;
      await tx.delete(chunksTable).where(eq(chunksTable.documentId, existing.id));
      await tx
        .update(documents)
        .set({
          canonicalUrl: input.canonicalUrl ?? input.sourceUrl,
          title: input.title.slice(0, 300),
          campus,
          contentType: input.contentType,
          pageType: input.pageType,
          contentText: text,
          contentHash: hash,
          extractionMode: input.extractionMode,
          crawlTimestamp: now,
          lastModified: input.lastModified ?? null,
          publicationDate: input.publicationDate ?? null,
          expiryDate: input.expiryDate ?? null,
          effectiveSession: input.effectiveSession ?? null,
          processingStatus: input.processingStatus ?? "indexed",
          freshness,
          trustLevel: input.trustLevel ?? "official",
          extractionConfidence: input.extractionConfidence ?? 0.9,
          httpStatus: input.httpStatus ?? null,
          error: input.error ?? null,
          pageCount: input.pageCount ?? null,
          version,
          active: true,
          provenanceNote: input.provenanceNote ?? null,
          updatedAt: now,
        })
        .where(eq(documents.id, existing.id));
      documentId = existing.id;
    } else {
      const inserted = await tx
        .insert(documents)
        .values({
          sourceId: source?.id ?? null,
          sourceUrl: input.sourceUrl,
          canonicalUrl: input.canonicalUrl ?? input.sourceUrl,
          title: input.title.slice(0, 300),
          campus,
          contentType: input.contentType,
          pageType: input.pageType,
          contentText: text,
          contentHash: hash,
          extractionMode: input.extractionMode,
          crawlTimestamp: now,
          lastModified: input.lastModified ?? null,
          publicationDate: input.publicationDate ?? null,
          expiryDate: input.expiryDate ?? null,
          effectiveSession: input.effectiveSession ?? null,
          processingStatus: input.processingStatus ?? "indexed",
          freshness,
          trustLevel: input.trustLevel ?? "official",
          extractionConfidence: input.extractionConfidence ?? 0.9,
          httpStatus: input.httpStatus ?? null,
          error: input.error ?? null,
          pageCount: input.pageCount ?? null,
          provenanceNote: input.provenanceNote ?? null,
          updatedAt: now,
        })
        .returning({ id: documents.id });
      documentId = inserted[0].id;
    }

    const docChunks = chunkDocument(text, {
      chunkSize: settings.retrieval.chunkSize,
      chunkOverlap: settings.retrieval.chunkOverlap,
    });

    if (docChunks.length) {
      const embedding = await embedTexts(
        docChunks.map((chunk) => `${input.title}\n${chunk.heading ?? ""}\n${chunk.content}`),
        {
          provider: settings.retrieval.embeddingProvider,
          model: settings.retrieval.embeddingModel,
          ollamaBaseUrl: settings.llm.ollamaBaseUrl,
        },
      );
      await tx.insert(chunksTable).values(
        docChunks.map((chunk, index) => ({
          documentId,
          chunkIndex: chunk.chunkIndex,
          heading: chunk.heading,
          content: chunk.content,
          pageNumber: chunk.pageNumber,
          section: chunk.section,
          campus,
          pageType: input.pageType,
          tokenEstimate: estimateTokens(chunk.content),
          embedding: embedding.vectors[index] ?? null,
          embeddingModel: embedding.model,
        })),
      );
    }

    await tx.update(documents).set({ chunkCount: docChunks.length }).where(eq(documents.id, documentId));
    return { documentId, chunkCount: docChunks.length, version };
  });

  if (input.pageType === "fees") {
    await detectFeeConflicts(result.documentId, campus, settings).catch(() => undefined);
  }

  return {
    status: existing ? "updated" : "created",
    documentId: result.documentId,
    chunkCount: result.chunkCount,
    version: result.version,
  };
}

async function detectFeeConflicts(documentId: number, campus: Campus, settings: AppSettings) {
  const current = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!current.length) return;
  const peers = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.pageType, "fees"),
        eq(documents.campus, campus),
        eq(documents.active, true),
        ne(documents.id, documentId),
      ),
    )
    .limit(20);
  const currentFigures = extractFeeFigures(current[0].contentText);
  if (!currentFigures.length) return;

  for (const peer of peers) {
    const peerFigures = extractFeeFigures(peer.contentText);
    const peerMap = new Map(peerFigures.map((figure) => [figure.program.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), figure]));
    for (const figure of currentFigures) {
      if (figure.semesterFee === null) continue;
      const key = figure.program.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const other = peerMap.get(key);
      if (!other || other.semesterFee === null) continue;
      const delta = Math.abs(figure.semesterFee - other.semesterFee) / Math.max(figure.semesterFee, other.semesterFee);
      if (delta < 0.01) continue;
      const topicKey = `${campus}:fee:${key}`;
      const already = await db
        .select({ id: conflicts.id })
        .from(conflicts)
        .where(and(eq(conflicts.topicKey, topicKey), eq(conflicts.documentAId, documentId), eq(conflicts.documentBId, peer.id)))
        .limit(1);
      if (already.length) continue;
      await db.insert(conflicts).values({
        topicKey,
        campus,
        description: `${figure.program}: first-semester tuition is Rs. ${figure.semesterFee.toLocaleString()} in "${current[0].title}" but Rs. ${other.semesterFee.toLocaleString()} in "${peer.title}". Both documents are currently active.`,
        documentAId: documentId,
        documentBId: peer.id,
        severity: "high",
        status: "open",
        evidence: {
          program: figure.program,
          documentA: { title: current[0].title, url: current[0].sourceUrl, value: figure.semesterFee },
          documentB: { title: peer.title, url: peer.sourceUrl, value: other.semesterFee },
          staleAfterDays: settings.retrieval.staleAfterDays,
        },
      });
    }
  }
}
