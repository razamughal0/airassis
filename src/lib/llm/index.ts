import type { Language } from "@/lib/config";
import type { LlmConfig } from "@/lib/config";
import type { RetrievedPassage } from "@/lib/knowledge/retriever";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { streamFromProvider, providerInfo, type ChatMessage } from "./providers";
import { composeExtractiveAnswer } from "./extractive";

export type AnswerDraft = {
  text: string;
  provider: string;
  model: string;
  providerLabel: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
};

export type AnswerInput = {
  query: string;
  passages: RetrievedPassage[];
  language: Language;
  scopeNote: string;
  conflicts: string[];
  provenanceNotes: string[];
  conversationContext: string;
  config: LlmConfig;
  intent?: string;
  leadCaveat?: string;
};

const chunkForStreaming = (text: string): string[] => {
  const pieces = text.match(/\s*\S+/g) ?? [text];
  const groups: string[] = [];
  let buffer = "";
  for (const piece of pieces) {
    buffer += piece;
    if (buffer.length >= 18) {
      groups.push(buffer);
      buffer = "";
    }
  }
  if (buffer) groups.push(buffer);
  return groups;
};

export async function answerWithFallback(input: AnswerInput, onToken?: (token: string) => void): Promise<AnswerDraft> {
  const info = providerInfo(input.config);
  const extractiveText = composeExtractiveAnswer({
    query: input.query,
    language: input.language,
    passages: input.passages,
    scopeNote: input.scopeNote,
    conflicts: input.conflicts,
    provenanceNotes: input.provenanceNotes,
    intent: input.intent,
    leadCaveat: input.leadCaveat,
  });

  if (!input.passages.length || input.config.provider === "extractive") {
    for (const piece of chunkForStreaming(extractiveText)) onToken?.(piece);
    return {
      text: extractiveText,
      provider: "extractive",
      model: "grounded-extractive-v1",
      providerLabel: "Grounded extractive composer (offline, no paid API)",
      fallbackUsed: false,
    };
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: buildUserPrompt({
        query: input.query,
        passages: input.passages,
        language: input.language,
        scopeNote: input.scopeNote,
        conversationContext: input.conversationContext,
        provenanceNotes: input.provenanceNotes,
      }),
    },
  ];

  try {
    let output = "";
    for await (const token of streamFromProvider(messages, input.config)) {
      output += token;
      onToken?.(token);
    }
    if (output.trim().length < 40) throw new Error("Model returned an empty or unusably short answer");
    return {
      text: output.trim(),
      provider: info.id,
      model: input.config.model,
      providerLabel: info.label,
      fallbackUsed: false,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Local inference failed";
    for (const piece of chunkForStreaming(extractiveText)) onToken?.(piece);
    return {
      text: extractiveText,
      provider: "extractive",
      model: "grounded-extractive-v1",
      providerLabel: "Grounded extractive composer (automatic fallback)",
      fallbackUsed: true,
      fallbackReason: `${reason}. Verified passages were composed without a language model instead.`,
    };
  }
}
