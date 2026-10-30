import type { RetrievedPassage } from "@/lib/knowledge/retriever";
import type { Language } from "@/lib/config";

/**
 * Deterministic, grounded answer composer. It never uses pretrained facts: it
 * only rearranges and quotes retrieved official passages, so it remains
 * useful offline (and as a fallback when a local LLM server is not running).
 */

const TEMPLATES: Record<Language, {
  intro: string;
  official: string;
  notVerified: string;
  notVerifiedBody: string;
  links: string;
  session: string;
  freshness: string;
  conflict: string;
  interpretation: string;
  clarification: string;
}> = {
  en: {
    intro: "Here is what the indexed official sources say:",
    official: "Official source",
    notVerified: "I could not verify this from the indexed official sources.",
    notVerifiedBody:
      "I only answer from official Air University pages and documents that have been ingested into the knowledge base, and nothing relevant enough was found. I will not guess fees, dates, eligibility or contacts.",
    links: "Official links to continue your research",
    session: "Admission session",
    freshness: "Retrieved",
    conflict: "Sources disagree — verify with the admissions office before acting.",
    interpretation: "My interpretation (not an official statement)",
    clarification: "Could you confirm which campus this is about?",
  },
  "roman-ur": {
    intro: "Indexed official sources ke mutabiq ye maloom hota hai:",
    official: "Official source",
    notVerified: "Main indexed official sources se ye confirm nahi kar saka.",
    notVerifiedBody:
      "Main sirf official Air University pages/documents se jawab deta hoon jo knowledge base mein indexed hain. Is sawal ke liye relevant official text nahi mila, is liye main fees, dates, eligibility ya contact numbers ka andaza nahi lagaunga.",
    links: "Tafseel ke liye official links",
    session: "Admission session",
    freshness: "Retrieve kiya gaya",
    conflict: "Sources mein farq hai — admission office se confirm karein.",
    interpretation: "Meri tafseer (official statement nahi)",
    clarification: "Baraye meharbani batayein ke sawal kis campus ke bare mein hai?",
  },
  ur: {
    intro: "انڈیکس شدہ سرکاری ذرائع کے مطابق:",
    official: "سرکاری ماخذ",
    notVerified: "میں انڈیکس شدہ سرکاری ذرائع سے اس کی تصدیق نہیں کر سکا۔",
    notVerifiedBody:
      "میں صرف ایئر یونیورسٹی کے سرکاری صفحات اور دستاویزات سے جواب دیتا ہوں جو نالج بیس میں شامل ہیں۔ اس سوال کے لیے موزوں سرکاری متن نہیں ملا، اس لیے میں فیس، تاریخ، اہلیت یا رابطے کا اندازہ نہیں لگاؤں گا۔",
    links: "مزید تحقیق کے لیے سرکاری لنکس",
    session: "داخلہ سیشن",
    freshness: "حاصل کردہ",
    conflict: "ذرائع میں اختلاف ہے — داخلہ دفتر سے تصدیق کریں۔",
    interpretation: "میری تشریح (سرکاری بیان نہیں)",
    clarification: "براہِ کرم بتائیں کہ سوال کس کیمپس کے بارے میں ہے؟",
  },
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "are", "was", "were", "will",
  "which", "what", "who", "when", "where", "how", "does", "did", "not", "you", "your", "our", "their",
  "about", "into", "than", "then", "also", "only", "such", "been", "being", "after", "before",
]);

function keyTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9.]+/)
        .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
    ),
  ).slice(0, 12);
}

const ABBREVIATIONS = /\b(Rs|No|Dr|Mr|Mrs|Ms|St|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\./gi;

function splitSentences(text: string): string[] {
  const protectedText = text.replace(ABBREVIATIONS, (match) => match.replace(/\.$/, "<DOT>"));
  return protectedText
    .replace(/\n+/g, "\n")
    .split(/(?<=[.!?])\s+|\n/)
    .map((sentence) => sentence.replace(/<DOT>/g, ".").trim())
    .filter((sentence) => sentence.length > 25);
}

const PROGRAM_PHRASES: { phrase: string; patterns: RegExp[] }[] = [
  { phrase: "BS Artificial Intelligence", patterns: [/artificial intelligence/i, /\bbsai\b/i, /\bai\b/i] },
  { phrase: "BS Computer Science", patterns: [/computer science/i, /\bbscs\b/i] },
  { phrase: "BS Data Science", patterns: [/data science/i, /\bbsds\b/i] },
  { phrase: "BS Cyber Security", patterns: [/cyber security/i, /\bbscys\b/i] },
  { phrase: "BS Software Engineering", patterns: [/software engineering/i] },
  { phrase: "BS Psychology", patterns: [/psychology/i] },
  { phrase: "BS English", patterns: [/\benglish\b/i] },
  { phrase: "BS Aviation Management", patterns: [/aviation management/i] },
  { phrase: "BS Accounting", patterns: [/accounting/i, /\bbsaf\b/i] },
  { phrase: "BBA", patterns: [/\bbba\b/i, /business administration/i] },
  { phrase: "BS International Relations", patterns: [/international relations/i, /\bbs-?ir\b/i] },
  { phrase: "BS Statistics", patterns: [/statistics/i, /data analytical/i] },
  { phrase: "BS Cyber Forensic", patterns: [/cyber forensic/i] },
  { phrase: "BS Business & Information Technology", patterns: [/business & information technology/i, /\bbsbit\b/i] },
];

export function detectProgramPhrases(query: string): string[] {
  return PROGRAM_PHRASES.filter((entry) => entry.patterns.some((pattern) => pattern.test(query))).map((entry) => entry.phrase);
}

function scoreSentence(sentence: string, terms: string[], isTableRow: boolean, programs: string[]): number {
  const lower = sentence.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score += term.length > 4 ? 1.4 : 0.9;
  }
  for (const program of programs) {
    const token = program.replace(/^BS /, "").toLowerCase();
    if (lower.includes(token) || lower.includes(program.toLowerCase())) score += 3.2;
  }
  if (isTableRow) score += 1.1;
  const numbers = (sentence.match(/\d[\d,.]{2,}/g) ?? []).length;
  if (numbers >= 2) score += 1.2;
  else if (numbers === 1) score += 0.4;
  if (sentence.length > 400) score -= 0.7;
  if (/^#{1,6}\s/.test(sentence.trim())) score -= 0.6;
  return score;
}

function cleanSnippet(sentence: string): string {
  return sentence
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\|\s*/, "")
    .replace(/\s*\|\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rowForProgram(passages: RetrievedPassage[], programs: string[]): string | null {
  if (!programs.length) return null;
  for (const passage of passages) {
    for (const line of passage.content.split("\n")) {
      if (!line.trim().startsWith("|")) continue;
      const lower = line.toLowerCase();
      if (programs.some((program) => lower.includes(program.replace(/^BS /, "").toLowerCase()))) {
        const cleaned = cleanSnippet(line);
        if (/\d{1,}/.test(cleaned) && cleaned.length > 12) return cleaned;
      }
    }
  }
  return null;
}

const SHORT_ANSWER_LABEL: Record<Language, string> = {
  en: "Short answer",
  "roman-ur": "Mukhtasar jawab",
  ur: "مختصر جواب",
};

type Options = {
  query: string;
  language: Language;
  passages: RetrievedPassage[];
  scopeNote: string;
  conflicts: string[];
  provenanceNotes: string[];
  intent?: string;
  leadCaveat?: string;
};

export function composeExtractiveAnswer(options: Options): string {
  const template = TEMPLATES[options.language];
  const terms = keyTerms(options.query);
  const programs = detectProgramPhrases(options.query);
  const lines: string[] = [];

  if (options.leadCaveat) {
    lines.push(`> **${options.leadCaveat}**`, "");
  }

  if (!options.passages.length) {
    lines.push(`**${template.notVerified}**`, "", template.notVerifiedBody);
    if (options.scopeNote) lines.push("", `${options.scopeNote}`);
    return lines.join("\n");
  }

  lines.push(template.intro, "");

  const scoredSentences = options.passages
    .flatMap((passage, passageIndex) =>
      splitSentences(passage.content).map((sentence) => ({
        sentence,
        passageIndex,
        score: scoreSentence(sentence, terms, sentence.trim().startsWith("|"), programs),
      })),
    )
    .sort((a, b) => b.score - a.score);

  const shortAnswer =
    options.intent === "fees" || options.intent === "scholarship" || options.intent === "eligibility"
      ? rowForProgram(options.passages, programs) ?? (scoredSentences[0] ? cleanSnippet(scoredSentences[0].sentence) : null)
      : scoredSentences[0]
        ? cleanSnippet(scoredSentences[0].sentence)
        : null;

  if (shortAnswer) {
    const sourceIndex = (scoredSentences[0]?.passageIndex ?? 0) + 1;
    lines.push(`**${SHORT_ANSWER_LABEL[options.language]}:** ${shortAnswer} [${sourceIndex}]`, "");
  }

  const used: { index: number; passage: RetrievedPassage }[] = [];
  const seen = new Set<string>();
  options.passages.slice(0, 4).forEach((passage, index) => {
    const picks = scoredSentences
      .filter((entry) => entry.passageIndex === index && entry.score > 0.9)
      .slice(0, 3);
    const fresh: string[] = [];
    for (const pick of picks) {
      const key = cleanSnippet(pick.sentence).toLowerCase().slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(cleanSnippet(pick.sentence));
      if (fresh.length >= 3) break;
    }
    if (!fresh.length) return;
    used.push({ index: index + 1, passage });
    lines.push(`**${passage.title}** [${index + 1}]`);
    for (const entry of fresh) lines.push(`- ${entry} [${index + 1}]`);
    const meta: string[] = [];
    if (passage.effectiveSession) meta.push(`${template.session}: ${passage.effectiveSession}`);
    meta.push(`${template.freshness}: ${new Date(passage.retrievedAt).toISOString().slice(0, 10)}`);
    if (passage.pageNumber) meta.push(`PDF page ${passage.pageNumber}`);
    if (passage.campus && passage.campus !== "university-wide") meta.push(passage.campus.replace(/-/g, " "));
    lines.push("");
  });

  if (!used.length) {
    const passage = options.passages[0];
    used.push({ index: 1, passage });
    const snippet = splitSentences(passage.content)[0] ?? passage.content.slice(0, 320);
    lines.push(`- ${cleanSnippet(snippet)} [1]`, "");
  }

  if (options.conflicts.length) {
    lines.push(`> **${template.conflict}**`, ...options.conflicts.map((conflict) => `> - ${conflict}`), "");
  }

  if (options.provenanceNotes.length) {
    lines.push(`_${options.provenanceNotes.join(" ")}_`, "");
  }

  if (options.scopeNote) lines.push(`_${options.scopeNote}_`, "");

  lines.push(`**${template.interpretation}:** ${
    options.language === "en"
      ? "I selected the passages above because they best match your question; I have not added any figure or date that is not literally present in those official sources."
      : options.language === "roman-ur"
        ? "Upar diye gaye passages aap ke sawal se sab se zyada match karte hain; koi bhi figure ya date jo official sources mein nahi hai, main ne add nahi ki."
        : "اوپر دیے گئے اقتباسات آپ کے سوال سے سب سے زیادہ مطابقت رکھتے ہیں؛ کوئی بھی عدد یا تاریخ جو سرکاری ماخذ میں نہیں، شامل نہیں کی گئی۔"
  }`);

  return lines.join("\n").trim();
}

export function composeLinkFooter(passages: RetrievedPassage[], language: Language): string {
  const template = TEMPLATES[language];
  if (!passages.length) return "";
  const seen = new Set<string>();
  const lines = [`\n**${template.links}:**`];
  for (const passage of passages.slice(0, 4)) {
    if (seen.has(passage.sourceUrl)) continue;
    seen.add(passage.sourceUrl);
    lines.push(`- [${passage.title}](${passage.sourceUrl})`);
  }
  return lines.join("\n");
}
