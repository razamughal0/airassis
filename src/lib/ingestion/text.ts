import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeContent(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, array) => line.length > 0 && line !== array[index - 1])
    .join("\n")
    .trim();
}

export type Chunk = {
  chunkIndex: number;
  heading: string | null;
  content: string;
  pageNumber: number | null;
  section: string | null;
};

export type ChunkOptions = { chunkSize: number; chunkOverlap: number };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * Structure-aware chunking: headings start new chunks, tables stay intact and
 * overlapping text is carried forward so answers are not cut mid-requirement.
 */
export function chunkDocument(text: string, options: ChunkOptions): Chunk[] {
  const normalized = normalizeContent(text);
  if (!normalized) return [];
  const chunkSize = Math.max(400, options.chunkSize);
  const overlap = Math.max(0, Math.min(options.chunkOverlap, Math.floor(chunkSize / 2)));

  const blocks: { heading: string | null; content: string; pageNumber: number | null }[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  // Page numbers are only attached when the source actually carries page
  // markers (PDF extraction). HTML pages must not claim "page 1".
  let pageNumber: number | null = null;

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) blocks.push({ heading: currentHeading, content, pageNumber });
    buffer = [];
  };

  for (const rawLine of normalized.split("\n")) {
    const pageMarker = /^\[page\s+(\d+)\]/i.exec(rawLine.trim());
    if (pageMarker) {
      flush();
      pageNumber = Number(pageMarker[1]);
      continue;
    }
    const headingMatch = HEADING_RE.exec(rawLine.trim());
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim();
      buffer.push(`${headingMatch[1]} ${currentHeading}`);
      continue;
    }
    buffer.push(rawLine);
    if (buffer.join("\n").length >= chunkSize) flush();
  }
  flush();

  const chunks: Chunk[] = [];
  let carry = "";
  for (const block of blocks) {
    let content = block.content;
    if (carry) content = `${carry}\n${content}`;
    if (content.length > chunkSize * 1.4) {
      // Split very long blocks on sentence boundaries.
      const sentences = content.split(/(?<=[.!?])\s+/);
      let part = "";
      for (const sentence of sentences) {
        if ((part + sentence).length > chunkSize && part) {
          chunks.push({
            chunkIndex: chunks.length,
            heading: block.heading,
            content: part.trim(),
            pageNumber: block.pageNumber,
            section: block.heading,
          });
          part = overlap ? part.slice(-overlap) : "";
        }
        part += `${sentence} `;
      }
      if (part.trim()) {
        chunks.push({
          chunkIndex: chunks.length,
          heading: block.heading,
          content: part.trim(),
          pageNumber: block.pageNumber,
          section: block.heading,
        });
      }
      carry = "";
      continue;
    }
    chunks.push({
      chunkIndex: chunks.length,
      heading: block.heading,
      content,
      pageNumber: block.pageNumber,
      section: block.heading,
    });
    if (!overlap) {
      carry = "";
      continue;
    }
    // Start the carried overlap at a word boundary so the next chunk does not
    // begin with a sliced fragment such as "026 Intake".
    const raw = content.slice(-overlap);
    const boundary = raw.search(/\s\S/);
    carry = boundary >= 0 ? raw.slice(boundary).trim() : raw;
    if (/^\d{1,4}\s/.test(carry) || carry.length < 24) carry = "";
  }

  return chunks.filter((chunk) => chunk.content.replace(/[#|\-\s]/g, "").length > 24);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Treat retrieved text as data: neutralise instruction-like content. */
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above|earlier) (instructions|prompts|rules)/gi,
  /disregard (all )?(previous|prior|above) (instructions|prompts)/gi,
  /you are (now|no longer) /gi,
  /system\s*(prompt|message|instruction)s?\s*[:=]/gi,
  /<\|\s*(im_start|im_end|system|endoftext)\s*\|>/gi,
  /\[\/?INST\]/gi,
  /reveal (the )?(system prompt|api key|secret|password)/gi,
  /(print|show|reveal) (your )?(credentials|secrets|env)/gi,
  /execute (this )?(code|command|tool)/gi,
];

export function sanitizeUntrustedText(text: string): { text: string; flagged: boolean } {
  let flagged = false;
  let value = text;
  for (const pattern of INJECTION_PATTERNS) {
    value = value.replace(pattern, () => {
      flagged = true;
      return "[untrusted instruction removed]";
    });
  }
  return { text: value, flagged };
}

export type FreshnessInput = {
  crawlTimestamp: Date;
  expiryDate?: Date | null;
  staleAfterDays: number;
};

export function freshnessOf({ crawlTimestamp, expiryDate, staleAfterDays }: FreshnessInput): "fresh" | "stale" | "expired" {
  if (expiryDate && expiryDate.getTime() < Date.now()) return "expired";
  const ageDays = (Date.now() - crawlTimestamp.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > staleAfterDays ? "stale" : "fresh";
}

export type FeeFigure = { program: string; creditHourFee: number | null; semesterFee: number | null };

/** Extract tabular fee figures so conflicting sources can be detected. */
export function extractFeeFigures(text: string): FeeFigure[] {
  const figures = new Map<string, FeeFigure>();
  const rows = text.split("\n").filter((line) => line.trim().startsWith("|"));
  for (const row of rows) {
    const cells = row
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
    if (cells.length < 3) continue;
    const numbers = cells.filter((cell) => /^[\d,]+(\.\d+)?$/.test(cell)).map((cell) => Number(cell.replace(/,/g, "")));
    if (numbers.length < 2) continue;
    const program = cells[0];
    if (!/^[a-z0-9 .&()\-/]+$/i.test(program) || program.length < 3 || program.length > 110) continue;
    if (/^(program|fee|tuition|payable|amount|remarks|sr)/i.test(program)) continue;
    const key = program.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    figures.set(key, {
      program: program.replace(/\s+/g, " "),
      creditHourFee: numbers[0] ?? null,
      semesterFee: numbers.length >= 3 ? numbers[2] : numbers[1] ?? null,
    });
  }
  return Array.from(figures.values()).slice(0, 80);
}
