import { createHash } from "node:crypto";

export const EMBEDDING_DIM = 384;

const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are", "was", "were", "be",
  "been", "at", "by", "with", "from", "as", "that", "this", "these", "those", "it", "its", "i",
  "we", "you", "he", "she", "they", "do", "does", "did", "can", "could", "would", "should", "will",
  "please", "tell", "me", "about", "what", "which", "how", "when", "where", "who", "kya", "hai",
  "hain", "ka", "ki", "ke", "ko", "me", "mein", "se", "aur", "ya", "bata", "bataye", "chahiye",
  "kitna", "kitni", "kab", "kahan", "konsa", "kaun", "liye", "ho", "hota", "hoti", "kar",
]);

/**
 * Lightweight, dependency-free embedding used as the default provider.
 * It is a signed hashing-trick bag-of-ngrams model, not a neural model.
 * Quality is lower than a transformer embedding, but it runs on 8 GB CPUs
 * with zero downloads and the provider interface can be swapped for Ollama
 * embeddings at any time.
 */
export function hashEmbed(text: string, dim = EMBEDDING_DIM): number[] {
  const vector = new Array<number>(dim).fill(0);
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff%.,\s-]/g, " ");
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 1 && token.length < 32);
  const addFeature = (feature: string, weight: number) => {
    const digest = createHash("sha1").update(feature).digest();
    const index = digest.readUInt32BE(0) % dim;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign * weight;
  };

  tokens.forEach((token, position) => {
    const clean = token.replace(/^[.,%-]+|[.,%-]+$/g, "");
    if (!clean) return;
    if (!STOPWORDS.has(clean)) {
      addFeature(`w:${clean}`, 1);
      if (clean.length >= 4) {
        for (let i = 0; i <= clean.length - 3; i += 1) addFeature(`g:${clean.slice(i, i + 3)}`, 0.32);
      }
    }
    if (position > 0) {
      const previous = tokens[position - 1].replace(/[^a-z0-9-]/g, "");
      if (previous && !STOPWORDS.has(previous)) addFeature(`b:${previous}_${clean}`, 0.55);
    }
  });

  const numericMatches = text.match(/\d[\d,.]*/g) ?? [];
  numericMatches.slice(0, 200).forEach((value) => addFeature(`n:${value.replace(/[,.]$/, "")}`, 1.4));

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

type EmbedOptions = { provider: "hash" | "ollama"; model: string; ollamaBaseUrl?: string };

async function ollamaEmbed(texts: string[], model: string, baseUrl: string): Promise<number[][] | null> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { embeddings?: number[][] };
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) return null;
    return data.embeddings;
  } catch {
    return null;
  }
}

export async function embedTexts(texts: string[], options: EmbedOptions): Promise<{ vectors: number[][]; model: string }> {
  if (options.provider === "ollama" && options.ollamaBaseUrl) {
    const remote = await ollamaEmbed(texts, options.model, options.ollamaBaseUrl);
    if (remote) return { vectors: remote, model: options.model };
  }
  return { vectors: texts.map((text) => hashEmbed(text)), model: `hash-ngram-${EMBEDDING_DIM}` };
}

export async function embedQuery(text: string, options: EmbedOptions): Promise<{ vector: number[]; model: string }> {
  const result = await embedTexts([text], options);
  return { vector: result.vectors[0] ?? hashEmbed(text), model: result.model };
}
