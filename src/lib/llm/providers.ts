import type { LlmConfig } from "@/lib/config";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ProviderInfo = { id: string; label: string; isLocal: boolean; model: string };

export function providerInfo(config: LlmConfig): ProviderInfo {
  switch (config.provider) {
    case "ollama":
      return { id: "ollama", label: "Ollama (local inference)", isLocal: true, model: config.model };
    case "lmstudio":
      return { id: "lmstudio", label: "LM Studio local OpenAI-compatible server", isLocal: true, model: config.model };
    case "hosted":
      return {
        id: "hosted",
        label: "Authorized hosted provider (OpenAI-compatible)",
        isLocal: false,
        model: config.model,
      };
    default:
      return {
        id: "extractive",
        label: "Grounded extractive composer (offline, no paid API)",
        isLocal: true,
        model: "grounded-extractive-v1",
      };
  }
}

async function* readLines(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) yield line;
  }
  if (buffer) yield buffer;
}

async function* streamOllama(messages: ChatMessage[], config: LlmConfig): AsyncGenerator<string> {
  const response = await fetch(`${config.ollamaBaseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.model, messages, stream: true, options: { temperature: config.temperature, num_predict: config.maxOutputTokens } }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  for await (const line of readLines(response)) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
      if (data.message?.content) yield data.message.content;
      if (data.done) break;
    } catch {
      continue;
    }
  }
}

async function* streamOpenAiCompatible(messages: ChatMessage[], config: LlmConfig, baseUrl: string, apiKey: string | undefined): AsyncGenerator<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxOutputTokens,
      stream: true,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`Inference server returned HTTP ${response.status}`);
  for await (const line of readLines(response)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") break;
    try {
      const data = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
      const token = data.choices?.[0]?.delta?.content;
      if (token) yield token;
    } catch {
      continue;
    }
  }
}

export async function* streamFromProvider(messages: ChatMessage[], config: LlmConfig): AsyncGenerator<string> {
  if (config.provider === "ollama") {
    yield* streamOllama(messages, config);
    return;
  }
  if (config.provider === "lmstudio") {
    yield* streamOpenAiCompatible(messages, config, config.lmStudioBaseUrl, process.env.LM_STUDIO_API_KEY);
    return;
  }
  if (config.provider === "hosted") {
    const apiKey = process.env.HOSTED_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Hosted provider selected but HOSTED_LLM_API_KEY is not configured");
    yield* streamOpenAiCompatible(messages, config, config.hostedBaseUrl, apiKey);
    return;
  }
  throw new Error("No remote provider configured; the extractive composer is used instead");
}

export async function completeFromProvider(messages: ChatMessage[], config: LlmConfig): Promise<string> {
  let output = "";
  for await (const token of streamFromProvider(messages, config)) output += token;
  return output.trim();
}
