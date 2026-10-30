export type PdfExtraction = {
  text: string;
  pageCount: number;
  pages: string[];
  confidence: number;
  ocrRequired: boolean;
  note: string;
};

/**
 * PDF text extraction. Digital PDFs are handled with unpdf (pdf.js).
 * If a document yields almost no text we flag it for OCR instead of guessing
 * at its content. OCR itself is only executed when an operator-configured OCR
 * service is available (see OCR_SERVICE_URL); otherwise the document is kept
 * in `ocr_pending` state so the gap is visible in the admin dashboard.
 */
export async function extractPdf(buffer: ArrayBuffer): Promise<PdfExtraction> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(result.text) ? result.text : [result.text]).map((page) =>
      String(page ?? "").replace(/\s+\n/g, "\n").trim(),
    );
    const joined = pages
      .map((page, index) => `[page ${index + 1}]\n${page}`)
      .join("\n\n")
      .trim();
    const charactersPerPage = pages.length ? joined.length / pages.length : 0;
    const ocrRequired = joined.length < 300 || charactersPerPage < 80;
    return {
      text: joined,
      pageCount: result.totalPages ?? pages.length,
      pages,
      confidence: ocrRequired ? 0.3 : Math.min(0.98, 0.7 + Math.log10(Math.max(joined.length, 10)) / 10),
      ocrRequired,
      note: ocrRequired
        ? "Very little embedded text detected. Document queued for OCR; content not yet answerable."
        : `Extracted ${joined.length} characters from ${pages.length} page(s) with embedded text.`,
    };
  } catch (error) {
    return {
      text: "",
      pageCount: 0,
      pages: [],
      confidence: 0,
      ocrRequired: true,
      note: `PDF extraction failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

export async function ocrImage(buffer: ArrayBuffer, contentType: string): Promise<{ text: string; confidence: number; note: string }> {
  const endpoint = process.env.OCR_SERVICE_URL;
  if (!endpoint) {
    return {
      text: "",
      confidence: 0,
      note: "OCR service not configured (OCR_SERVICE_URL). Image kept as a source reference only.",
    };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": contentType || "application/octet-stream" },
      body: buffer,
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) return { text: "", confidence: 0, note: `OCR service returned HTTP ${response.status}` };
    const data = (await response.json()) as { text?: string; confidence?: number };
    return {
      text: data.text ?? "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0.5,
      note: "OCR via configured external service.",
    };
  } catch (error) {
    return {
      text: "",
      confidence: 0,
      note: `OCR failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
