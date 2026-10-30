import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Source registry: every domain/subdomain the crawler is allowed to touch is
 * explicitly registered here (defence in depth on top of the env allowlist).
 */
export const sources = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    campus: text("campus").notNull().default("university-wide"),
    scope: text("scope").notNull().default("official"),
    trustLevel: text("trust_level").notNull().default("official"),
    allowCrawl: boolean("allow_crawl").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sources_base_url_uq").on(t.baseUrl)],
);

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceUrl: text("source_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    campus: text("campus").notNull().default("unknown"),
    contentType: text("content_type").notNull().default("html"),
    pageType: text("page_type").notNull().default("general"),
    contentText: text("content_text").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    extractionMode: text("extraction_mode").notNull().default("live_crawl"),
    crawlTimestamp: timestamp("crawl_timestamp", { withTimezone: true }).notNull().defaultNow(),
    lastModified: timestamp("last_modified", { withTimezone: true }),
    publicationDate: timestamp("publication_date", { withTimezone: true }),
    expiryDate: timestamp("expiry_date", { withTimezone: true }),
    effectiveSession: text("effective_session"),
    processingStatus: text("processing_status").notNull().default("indexed"),
    freshness: text("freshness").notNull().default("fresh"),
    trustLevel: text("trust_level").notNull().default("official"),
    extractionConfidence: real("extraction_confidence").notNull().default(0.85),
    httpStatus: integer("http_status"),
    error: text("error"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count").notNull().default(0),
    version: integer("version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    provenanceNote: text("provenance_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_source_url_uq").on(t.sourceUrl),
    index("documents_campus_idx").on(t.campus),
    index("documents_page_type_idx").on(t.pageType),
    index("documents_active_idx").on(t.active),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    title: text("title").notNull(),
    contentText: text("content_text").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("doc_versions_doc_idx").on(t.documentId)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    heading: text("heading"),
    content: text("content").notNull(),
    pageNumber: integer("page_number"),
    section: text("section"),
    campus: text("campus").notNull().default("unknown"),
    pageType: text("page_type").notNull().default("general"),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    embedding: jsonb("embedding").$type<number[]>(),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chunks_document_idx").on(t.documentId),
    index("chunks_campus_idx").on(t.campus),
    index("chunks_page_type_idx").on(t.pageType),
  ],
);

export const crawlRuns = pgTable("crawl_runs", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull().default("manual"),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  startUrl: text("start_url").notNull(),
  pagesDiscovered: integer("pages_discovered").notNull().default(0),
  pagesProcessed: integer("pages_processed").notNull().default(0),
  pdfsProcessed: integer("pdfs_processed").notNull().default(0),
  ocrPending: integer("ocr_pending").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0),
  notes: text("notes"),
  config: jsonb("config").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crawlLogs = pgTable(
  "crawl_logs",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: text("status").notNull(),
    httpStatus: integer("http_status"),
    detail: text("detail"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("crawl_logs_run_idx").on(t.runId)],
);

export type Citation = {
  index: number;
  title: string;
  url: string;
  campus: string;
  pageType: string;
  contentType: string;
  section: string | null;
  pageNumber: number | null;
  retrievedAt: string;
  effectiveSession: string | null;
  lastModified: string | null;
  freshness: string;
  trustLevel: string;
  excerpt: string;
  score: number;
};

export type EvidenceItem = {
  sourceIndex: number;
  claim: string;
};

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    title: text("title").notNull().default("New conversation"),
    language: text("language").notNull().default("en"),
    campusScope: text("campus_scope").notNull().default("auto"),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_session_idx").on(t.sessionId)],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    language: text("language").notNull().default("en"),
    citations: jsonb("citations").$type<Citation[]>(),
    evidence: jsonb("evidence").$type<EvidenceItem[]>(),
    confidence: real("confidence"),
    verificationStatus: text("verification_status"),
    scopeNote: text("scope_note"),
    provider: text("provider"),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

export const conflicts = pgTable("conflicts", {
  id: serial("id").primaryKey(),
  topicKey: text("topic_key").notNull(),
  campus: text("campus").notNull().default("unknown"),
  description: text("description").notNull(),
  documentAId: integer("document_a_id").references(() => documents.id, { onDelete: "cascade" }),
  documentBId: integer("document_b_id").references(() => documents.id, { onDelete: "cascade" }),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAudit = pgTable("admin_audit", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
