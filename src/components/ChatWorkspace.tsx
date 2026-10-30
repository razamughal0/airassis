"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Citation = {
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

type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  citations?: Citation[];
  confidence?: number;
  verificationStatus?: "verified" | "partial" | "unverified";
  scopeNote?: string;
  provider?: string;
  providerLabel?: string;
  model?: string;
  latencyMs?: number;
  conflictWarnings?: string[];
  clarificationNeeded?: boolean;
  error?: boolean;
  imageUrl?: string;
  imageCaption?: string;
  visionResult?: { configured: boolean; text: string | null; note: string };
  showGallery?: boolean;
};

type ConversationSummary = { id: number; title: string; messageCount: number; updatedAt: string };

type ChatWorkspaceProps = {
  stats: { documents: number; sources: number; lastUpdated: string | null; campuses: number };
  snapshotNote: string;
};

const LANGUAGES = [
  { id: "en", label: "English", speech: "en-PK" },
  { id: "roman-ur", label: "Roman Urdu", speech: "ur-PK" },
  { id: "ur", label: "اردو", speech: "ur-PK" },
] as const;

type LanguageId = (typeof LANGUAGES)[number]["id"];

const CAMPUS_OPTIONS = [
  { id: "auto", label: "Auto (Karachi + university-wide)" },
  { id: "karachi", label: "Karachi Campus only" },
  { id: "islamabad-main", label: "Islamabad Main Campus" },
  { id: "kharian", label: "Kharian Campus" },
  { id: "university-wide", label: "University-wide only" },
];

const SUGGESTIONS = [
  { tag: "Fees", text: "What is the first-semester fee for BS Artificial Intelligence at Karachi Campus?" },
  { tag: "Eligibility", text: "What are the eligibility requirements for BS Artificial Intelligence?" },
  { tag: "Apply", text: "How do I apply for admission to Karachi Campus?" },
  { tag: "Documents", text: "Which documents are required while applying?" },
  { tag: "Deadline", text: "What is the latest official admission deadline for Fall 2026?" },
  { tag: "Facilities", text: "Is hostel or transport available at Karachi Campus?" },
  { tag: "Roman Urdu", text: "Karachi Campus ki fee aur documents simple Roman Urdu mein samjhayein." },
  { tag: "Scholarship", text: "How does the Air University merit scholarship work?" },
];

const GALLERY = [
  {
    url: "https://images.pexels.com/photos/16666017/pexels-photo-16666017.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    caption: "University campus, aerial view",
  },
  {
    url: "https://images.pexels.com/photos/8199165/pexels-photo-8199165.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    caption: "Students in a classroom",
  },
  {
    url: "https://images.pexels.com/photos/9489906/pexels-photo-9489906.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    caption: "Library study space",
  },
];
const HERO_IMAGE = "https://images.pexels.com/photos/16666095/pexels-photo-16666095.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";

const VERIFICATION_STYLES: Record<string, { label: string; className: string; dot: string }> = {
  verified: { label: "Verified against fresh official sources", className: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  partial: { label: "Partially verified — check caveats", className: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  unverified: { label: "Could not verify in indexed sources", className: "bg-rose-50 text-rose-800 border-rose-200", dot: "bg-rose-500" },
};

function inlineNodes(text: string, keyPrefix: string): React.ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|_[^_]+_|`[^`]+`)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-[#0b1f3a]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#17375f] underline decoration-[#c8a24a] decoration-2 underline-offset-2 hover:text-[#0b1f3a]"
          >
            {link[1]} ↗
          </a>,
        );
      } else nodes.push(token);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <em key={key} className="text-slate-600">
          {token.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = (key: string) => {
    if (!list.length) return;
    blocks.push(
      <ul key={key} className="my-2 space-y-1.5 pl-1">
        {list.map((item, index) => (
          <li key={`${key}-${index}`} className="flex gap-2 text-[13.5px] leading-relaxed">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#c8a24a]" />
            <span>{inlineNodes(item, `${key}-${index}`)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushList(`ul-${lineIndex}`);
      return;
    }
    if (line.trim().startsWith("- ")) {
      list.push(line.trim().slice(2));
      return;
    }
    flushList(`ul-${lineIndex}`);
    if (line.trim().startsWith(">")) {
      blocks.push(
        <div key={`q-${lineIndex}`} className="my-2 rounded-r-md border-l-[3px] border-[#c8a24a] bg-[#fbf7ec] px-3 py-2 text-[13px] text-[#5b4a1d]">
          {inlineNodes(line.replace(/^>\s?/, ""), `q-${lineIndex}`)}
        </div>,
      );
      return;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push(
        <h4 key={`h-${lineIndex}`} className="mt-3 mb-1 font-serif text-[15px] font-semibold text-[#0b1f3a]">
          {inlineNodes(line.replace(/^#{1,4}\s/, ""), `h-${lineIndex}`)}
        </h4>,
      );
      return;
    }
    const stripped = line.replace(/\*\*/g, "");
    const isHeading = line.startsWith("**") && line.endsWith("**") && stripped.length < 130;
    blocks.push(
      <p key={`p-${lineIndex}`} className={isHeading ? "mt-3 font-semibold text-[#0b1f3a]" : "my-1.5 text-[13.5px] leading-relaxed text-slate-700"}>
        {inlineNodes(line, `p-${lineIndex}`)}
      </p>,
    );
  });
  flushList("ul-final");
  return <div>{blocks}</div>;
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "gold" | "green" | "amber" | "navy" }) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    gold: "border-[#e2cf9a] bg-[#fbf7ec] text-[#7c6425]",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    navy: "border-[#17375f]/20 bg-[#eef2f8] text-[#17375f]",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${tones[tone]}`}>{children}</span>;
}

function GalleryStrip({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={compact ? "mt-3" : "mt-4"}>
      <div className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3"}`}>
        {GALLERY.map((image) => (
          <div key={image.url} className="group relative overflow-hidden rounded-lg border border-slate-200">
            <img
              src={image.url}
              alt={image.caption}
              loading="lazy"
              className={`w-full object-cover transition duration-500 group-hover:scale-[1.04] ${compact ? "h-24" : "h-40 sm:h-32"}`}
            />
            <span className="absolute bottom-1 left-1 rounded bg-[#0b1f3a]/80 px-1.5 py-0.5 text-[9px] font-medium text-white">
              {image.caption}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="mt-1 text-[9.5px] text-slate-400">
        Illustrative campus photography (Pexels) — not official Air University imagery.
      </figcaption>
    </figure>
  );
}

function SourceList({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  if (!citations.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-[#17375f]"
      >
        <span className="flex items-center gap-1.5">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <path d="M4 3h8l4 4v10H4V3Zm8 1.5V8h3.5L12 4.5Z" />
          </svg>
          {citations.length} official source{citations.length > 1 ? "s" : ""}
        </span>
        <span className="text-slate-400">{open ? "Hide" : "View"}</span>
      </button>
      {open && (
        <ol className="divide-y divide-slate-100 border-t border-slate-100">
          {Array.from(
            citations.reduce((groups, citation) => {
              const existing = groups.get(citation.url);
              if (existing) existing.items.push(citation);
              else groups.set(citation.url, { primary: citation, items: [citation] });
              return groups;
            }, new Map<string, { primary: Citation; items: Citation[] }>()),
          ).map(([url, group]) => {
            const citation = group.primary;
            return (
              <li key={url} className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#0b1f3a] px-1 text-[10px] font-semibold text-white">
                    {group.items.map((item) => item.index).join(",")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a href={citation.url} target="_blank" rel="noreferrer" className="block truncate text-[12.5px] font-semibold text-[#17375f] hover:underline">
                      {citation.title} ↗
                    </a>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone="navy">{citation.campus.replace(/-/g, " ")}</Badge>
                      <Badge>{citation.pageType}</Badge>
                      {citation.contentType === "pdf" && <Badge tone="gold">PDF{citation.pageNumber ? ` p.${citation.pageNumber}` : ""}</Badge>}
                      {citation.effectiveSession && <Badge tone="gold">{citation.effectiveSession}</Badge>}
                      <Badge tone={citation.freshness === "fresh" ? "green" : "amber"}>
                        retrieved {new Date(citation.retrievedAt).toISOString().slice(0, 10)}
                      </Badge>
                      {group.items.length > 1 && <Badge>{group.items.length} passages</Badge>}
                    </div>
                    <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-relaxed text-slate-500">“{citation.excerpt}”</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function stripForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, " official link available, ")
    .replace(/\[\d+\]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`>#|]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 900);
}

function AssistantMeta({ message }: { message: UIMessage }) {
  const style = VERIFICATION_STYLES[message.verificationStatus ?? "unverified"] ?? VERIFICATION_STYLES.unverified;
  const confidence = Math.round((message.confidence ?? 0) * 100);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-[10.5px] text-slate-500">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${style.className}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {style.label}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="hidden sm:inline">retrieval confidence</span>
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
          <span className="block h-full rounded-full bg-[#0072BC]" style={{ width: `${Math.max(4, Math.min(100, confidence))}%` }} />
        </span>
        {confidence}%
      </span>
      {message.providerLabel && <Badge>{message.providerLabel}</Badge>}
      {message.model && <Badge tone="slate">{message.model}</Badge>}
      {typeof message.latencyMs === "number" && <span>{message.latencyMs} ms</span>}
    </div>
  );
}

export default function ChatWorkspace({ stats, snapshotNote }: ChatWorkspaceProps) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState<LanguageId>("en");
  const [campus, setCampus] = useState("auto");
  const [sessionId, setSessionId] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ name: string; dataUrl: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastQuestionRef = useRef<string>("");
  const autoSpeakRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const languageRef = useRef<LanguageId>("en");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
  }, [autoSpeak]);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    const stored = window.localStorage.getItem("au-kb-session");
    const id = stored && stored.length > 8 ? stored : `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem("au-kb-session", id);
    setSessionId(id);
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setRecognitionSupported(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    setSpeechAvailable("speechSynthesis" in window);
  }, []);

  const refreshConversations = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/conversations?sessionId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations ?? []);
    } catch {
      /* history is a convenience; failures are non-fatal */
    }
  }, []);

  useEffect(() => {
    if (sessionId) void refreshConversations(sessionId);
  }, [sessionId, refreshConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      recognitionRef.current?.stop();
    };
  }, []);

  const speak = useCallback(
    (messageId: string, text: string) => {
      if (!("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      if (speakingId === messageId) {
        synth.cancel();
        setSpeakingId(null);
        return;
      }
      synth.cancel();
      const clean = stripForSpeech(text);
      if (!clean) return;
      const utterance = new SpeechSynthesisUtterance(clean);
      const langId = languageRef.current;
      const prefer = langId === "en" ? ["en-pk", "en-in", "en-gb", "en-us"] : ["ur-pk", "ur"];
      utterance.lang = prefer[0];
      const voices = synth.getVoices();
      const match = voices.find((voice) => prefer.some((prefix) => voice.lang.toLowerCase().startsWith(prefix)));
      if (match) utterance.voice = match;
      utterance.rate = 1;
      utterance.onstart = () => setSpeakingId(messageId);
      utterance.onend = () => setSpeakingId((current) => (current === messageId ? null : current));
      utterance.onerror = () => setSpeakingId(null);
      synth.speak(utterance);
    },
    [speakingId],
  );

  const toggleListening = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((event: { results: { length: number; [index: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    }) | undefined;
    if (!Ctor) {
      setError("Voice input is not supported in this browser. Use Chrome or Edge for the microphone feature.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    setError(null);
    const langId = languageRef.current;
    const recognition = new Ctor();
    recognition.lang = LANGUAGES.find((entry) => entry.id === langId)?.speech ?? "en-PK";
    recognition.interimResults = true;
    recognition.continuous = false;
    const baseline = input.trim() ? `${input} ` : "";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) transcript = `${baseline}${result[0].transcript} `;
      }
      if (transcript) setInput(transcript);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed") setError("Microphone permission was blocked. Allow access to the microphone to use voice input.");
      else if (event.error === "no-speech") setError("I could not hear anything. Tap the mic and try again.");
      else setError(`Microphone error: ${event.error}`);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition as { stop: () => void };
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  }, [listening, input]);

  const onAttachImage = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setError("Only PNG, JPEG or WebP images can be attached.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Please attach an image under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAttachment({ name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => setError("Could not read that image file.");
    reader.readAsDataURL(file);
  }, []);

  const sendVisionImage = useCallback(
    async (dataUrl: string, name: string) => {
      setError(null);
      const userMessage: UIMessage = {
        id: `u-img-${Date.now()}`,
        role: "user",
        content: "Here is an image — what does it say?",
        imageUrl: dataUrl,
        imageCaption: name,
      };
      const cardId = `vision-${Date.now()}`;
      setMessages((current) => [...current, userMessage, { id: cardId, role: "assistant", content: "", streaming: true }]);
      setStreaming(true);
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const form = new FormData();
        form.append("image", blob, name);
        const response = await fetch("/api/vision", { method: "POST", body: form });
        const data = (await response.json()) as { error?: string; configured?: boolean; text?: string | null; note?: string };
        if (!response.ok) throw new Error(data.error ?? "Image could not be processed.");
        const visionResult = { configured: Boolean(data.configured), text: data.text ?? null, note: data.note ?? "" };
        setMessages((current) =>
          current.map((message) =>
            message.id === cardId
              ? {
                  ...message,
                  streaming: false,
                  visionResult,
                  content: visionResult.text
                    ? `**Read from your image:**\n${visionResult.text.slice(0, 900)}\n\n_${visionResult.note}_`
                    : visionResult.note,
                  provider: "vision",
                  providerLabel: visionResult.configured ? "Vision model reading" : "Vision not configured",
                  verificationStatus: visionResult.configured && visionResult.text ? "partial" : "unverified",
                }
              : message,
          ),
        );
      } catch (caught) {
        const messageText = caught instanceof Error ? caught.message : "Image processing failed.";
        setMessages((current) =>
          current.map((message) => (message.id === cardId ? { ...message, streaming: false, error: true, content: messageText } : message)),
        );
      } finally {
        setStreaming(false);
      }
    },
    [],
  );

  const send = async (question: string, attached?: { name: string; dataUrl: string }) => {
    if (attached) {
      setAttachment(null);
      void sendVisionImage(attached.dataUrl, attached.name);
      return;
    }
    const trimmed = question.trim();
    if (!trimmed || streaming || !sessionId) return;
    lastQuestionRef.current = trimmed;
    setError(null);
    setInput("");
    const userMessage: UIMessage = { id: `u-${Date.now()}`, role: "user", content: trimmed };
    const assistantId = `a-${Date.now()}`;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "", streaming: true }]);
    setStreaming(true);

    const updateAssistant = (patch: Partial<UIMessage> | ((message: UIMessage) => Partial<UIMessage>)) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, ...(typeof patch === "function" ? patch(message) : patch) } : message,
        ),
      );
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, sessionId, conversationId, language, campus, stream: true }),
      });
      if (!response.ok || !response.body) {
        const detail =
          response.status === 429 ? "Too many questions in a row. Please wait a minute." : "The assistant is unavailable right now. Please retry.";
        throw new Error(detail);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answeredText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const eventLine = part.split("\n").find((line) => line.startsWith("event:"));
          const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const event = eventLine ? eventLine.slice(6).trim() : "message";
          const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
          if (event === "token") {
            const token = String(data.token ?? "");
            answeredText += token;
            updateAssistant((message) => ({ content: message.content + token }));
          } else if (event === "meta") {
            const nextConversationId = Number(data.conversationId);
            if (Number.isInteger(nextConversationId)) setConversationId(nextConversationId);
            const citations = (data.citations as Citation[]) ?? [];
            updateAssistant({
              streaming: false,
              citations,
              confidence: Number(data.confidence ?? 0),
              verificationStatus: (data.verificationStatus as UIMessage["verificationStatus"]) ?? "unverified",
              scopeNote: String(data.scopeNote ?? ""),
              provider: data.provider as string,
              providerLabel: data.providerLabel as string,
              model: data.model as string,
              latencyMs: Number(data.latencyMs ?? 0),
              conflictWarnings: (data.conflictWarnings as string[]) ?? [],
              clarificationNeeded: Boolean(data.clarificationNeeded),
              showGallery: citations.some((citation) => ["campus-info", "about", "programs"].includes(citation.pageType)),
            });
            if (autoSpeakRef.current) speak(assistantId, answeredText || stripForSpeech(String(data.scopeNote ?? "")));
          } else if (event === "error") {
            updateAssistant({ streaming: false, error: true, content: String(data.message ?? "The answer could not be generated.") });
          }
        }
      }
      updateAssistant({ streaming: false });
      void refreshConversations(sessionId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The assistant is unavailable right now.";
      setError(message);
      updateAssistant({ streaming: false, error: true, content: message });
    } finally {
      setStreaming(false);
    }
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setShowSidebar(false);
    setAttachment(null);
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  };

  const loadConversation = async (id: number) => {
    if (!sessionId) return;
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${id}?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load conversation");
      const data = (await response.json()) as {
        conversation: { language: string };
        messages: {
          id: number;
          role: "user" | "assistant";
          content: string;
          citations: Citation[];
          confidence: number;
          verificationStatus: string;
          provider: string;
          model: string;
          latencyMs: number;
        }[];
      };
      setConversationId(id);
      setMessages(
        data.messages.map((message) => ({
          id: `db-${message.id}`,
          role: message.role,
          content: message.content,
          citations: message.citations ?? [],
          confidence: message.confidence,
          verificationStatus: (message.verificationStatus as UIMessage["verificationStatus"]) ?? "unverified",
          provider: message.provider ?? undefined,
          model: message.model ?? undefined,
          latencyMs: message.latencyMs ?? undefined,
          showGallery: (message.citations ?? []).some((citation) => ["campus-info", "about", "programs"].includes(citation.pageType)),
        })),
      );
      setShowSidebar(false);
    } catch {
      setError("That conversation could not be loaded.");
    }
  };

  const suggested = useMemo(() => SUGGESTIONS.slice(0, 6), []);

  return (
    <main className="mx-auto max-w-7xl px-3 pb-6 pt-4 sm:px-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#071730] via-[#0b1f3a] to-[#10345e] text-white shadow-xl">
        <div className="absolute inset-0 paper-grid opacity-50" aria-hidden />
        <div className="relative flex flex-col gap-5 px-5 py-6 sm:px-8 sm:py-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2.5 flex flex-wrap gap-2">
              <span className="rounded-full border border-[#e7c878]/50 bg-[#e7c878]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e7c878]">
                RAG · cited · verification-aware
              </span>
              <span className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200">
                <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor" aria-hidden>
                  <path d="M8 1a3 3 0 0 0-3 3v3a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Zm-5 6a5 5 0 0 0 4 4.9V14H4.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H9v-2.1A5 5 0 0 0 13 7H3Z" />
                </svg>
                voice in · voice out
              </span>
              <span className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200">
                <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor" aria-hidden>
                  <path d="M1 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1h2a3 3 0 0 1 3 3v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3Zm7 0H2v8h6V3Zm4 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
                </svg>
                image understanding
              </span>
            </div>
            <h1 className="font-serif text-2xl leading-tight text-white sm:text-[34px] sm:leading-[1.15]">
              Ask about admissions, fees, eligibility and official notices.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
              Speak it, type it, or upload a notice image. Answers come only from indexed official Air University sources —
              every reply shows source links, retrieval dates and a verification status, and says so plainly when something
              cannot be verified.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative hidden h-36 w-60 overflow-hidden rounded-xl ring-2 ring-[#e7c878]/50 md:block">
              <img src={HERO_IMAGE} alt="University campus" loading="eager" className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#071730] to-transparent px-3 pb-2 pt-6 text-[10px] text-slate-200">
                Campus life — illustrative photo
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2.5 text-center sm:grid-cols-1">
              {[
                { label: "Indexed sources", value: stats.documents },
                { label: "Official domains", value: stats.sources },
                { label: "Last update", value: stats.lastUpdated ? new Date(stats.lastUpdated).toISOString().slice(0, 10) : "—" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <dt className="text-[9px] uppercase tracking-[0.14em] text-slate-400">{item.label}</dt>
                  <dd className="mt-1 font-serif text-lg text-[#e7c878]">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className={`${showSidebar ? "block" : "hidden"} space-y-3 lg:block`}>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-sm font-semibold text-[#0b1f3a]">Conversations</h2>
              <button
                type="button"
                onClick={newConversation}
                className="rounded-md bg-[#0b1f3a] px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#17375f]"
              >
                + New
              </button>
            </div>
            <div className="chat-scroll mt-2.5 max-h-52 space-y-1 overflow-y-auto pr-1">
              {!conversations.length && <p className="py-2 text-[11.5px] text-slate-400">Your questions are saved in this browser only.</p>}
              {conversations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => loadConversation(item.id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-[11.5px] transition hover:bg-slate-100 ${
                    conversationId === item.id ? "bg-[#eef2f8] font-semibold text-[#17375f]" : "text-slate-600"
                  }`}
                >
                  <span className="line-clamp-2">{item.title}</span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(item.updatedAt).toISOString().slice(0, 10)} · {item.messageCount} msgs
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <h2 className="font-serif text-sm font-semibold text-[#0b1f3a]">Answer settings</h2>
            <label className="mt-2 block text-[10.5px] font-semibold uppercase tracking-wide text-slate-500" htmlFor="language">
              Language
            </label>
            <select
              id="language"
              value={language}
              onChange={(event) => setLanguage(event.target.value as LanguageId)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] focus:border-[#17375f] focus:outline-none"
            >
              {LANGUAGES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="mt-2 block text-[10.5px] font-semibold uppercase tracking-wide text-slate-500" htmlFor="campus">
              Campus scope
            </label>
            <select
              id="campus"
              value={campus}
              onChange={(event) => setCampus(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] focus:border-[#17375f] focus:outline-none"
            >
              {CAMPUS_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="mt-2.5 flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
              <input type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} className="mt-0.5" disabled={!speechAvailable} />
              <span className="text-[11px] leading-snug text-slate-600">
                <strong className="text-[#0b1f3a]">Speak answers aloud</strong>
                {speechAvailable ? " (text-to-speech follows the language above)" : " — not supported in this browser"}
              </span>
            </label>
            <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">
              Fees and deadlines are campus-specific. Auto scope searches Karachi + university-wide material and flags the
              scope used.
            </p>
          </div>

          <div className="rounded-xl border border-[#e2cf9a] bg-[#fbf7ec] p-3.5">
            <h2 className="font-serif text-sm font-semibold text-[#5b4a1d]">Coverage honesty</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-[#6b5a2a]">{snapshotNote}</p>
            <Link href="/sources" className="mt-2 inline-flex text-[11px] font-semibold text-[#7c6425] underline underline-offset-2">
              View source coverage &amp; gaps →
            </Link>
          </div>
        </aside>

        {/* Chat */}
        <section className="flex min-h-[640px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-gradient-to-r from-[#0b1f3a] to-[#10345e] px-3 py-2 sm:px-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-[#e7c878]/50">
                <img src="/images/au-mark-white.svg" alt="" className="h-6 w-6" />
              </span>
              <div className="leading-tight">
                <p className="text-[12px] font-semibold text-white">AU Knowledge Assistant</p>
                <p className="flex items-center gap-1 text-[10px] text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {streaming || listening ? (listening ? "listening…" : "thinking…") : `${stats.documents} official sources ready`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {listening && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-200">● Recording</span>}
              <button
                type="button"
                onClick={() => setShowSidebar((value) => !value)}
                className="rounded-md border border-white/20 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-100 lg:hidden"
              >
                {showSidebar ? "Hide menu" : "Menu"}
              </button>
              {messages.length > 0 && (
                <button type="button" onClick={newConversation} className="text-[11px] font-medium text-slate-200 hover:text-white">
                  Clear chat
                </button>
              )}
            </div>
          </div>

          <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto bg-[#f7f8fa] px-3 py-4 sm:px-5">
            {messages.length === 0 && (
              <div className="animate-fade-up">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0b1f3a] ring-1 ring-[#c8a24a]/50">
                      <img src="/images/au-mark-white.svg" alt="Air University emblem" className="h-8 w-8" />
                    </span>
                    <div>
                      <h3 className="font-serif text-base font-semibold text-[#0b1f3a]">Assalam-o-alaikum! What would you like to know?</h3>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-600">
                        Type, <strong>tap the microphone</strong> to ask by voice, or attach a photo of a notice. English and
                        Roman Urdu both work.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
                    {suggested.map((suggestion) => (
                      <button
                        key={suggestion.text}
                        type="button"
                        onClick={() => void send(suggestion.text)}
                        className="group flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-[#0072BC] hover:shadow"
                      >
                        <span className="mt-0.5 rounded bg-[#e8f1fb] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#0072BC]">
                          {suggestion.tag}
                        </span>
                        <span className="text-[12px] leading-snug text-slate-700 group-hover:text-[#0b1f3a]">{suggestion.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <GalleryStrip />
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    { title: "Cited, not improvised", body: "Answers quote retrieved official text with numbered source links, session and retrieval date." },
                    { title: "Campus separated", body: "Karachi, Islamabad and Kharian publications are stored and filtered separately — never merged." },
                    { title: "Honest about gaps", body: "If official sources do not verify a fee, deadline or facility, the assistant says so." },
                  ].map((card) => (
                    <div key={card.title} className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-[12px] font-semibold text-[#0b1f3a]">{card.title}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{card.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-gradient-to-br from-[#0b1f3a] to-[#12355e] px-3.5 py-2.5 text-[13px] leading-relaxed text-white shadow-md">
                      {message.imageUrl && (
                        <img
                          src={message.imageUrl}
                          alt={message.imageCaption ?? "Uploaded image"}
                          className="mb-2 max-h-56 w-full rounded-lg object-cover ring-1 ring-white/20"
                        />
                      )}
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="animate-fade-up flex items-start gap-2.5">
                    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0b1f3a] ring-1 ring-[#c8a24a]/50">
                      <img src="/images/au-mark-white.svg" alt="" className="h-6 w-6" />
                    </span>
                    <div className={`min-w-0 flex-1 rounded-xl border bg-white shadow-sm ${message.error ? "border-rose-200" : "border-slate-200"}`}>
                      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
                        <span className="text-[11px] font-semibold text-[#0b1f3a]">Knowledge Assistant</span>
                        <span className="ml-auto flex items-center gap-2">
                          {message.content && !message.streaming && (
                            <button
                              type="button"
                              onClick={() => speak(message.id, message.content)}
                              title={speakingId === message.id ? "Stop speaking" : "Read this answer aloud"}
                              className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold transition ${
                                speakingId === message.id ? "bg-[#0072BC] text-white" : "text-slate-500 hover:bg-slate-100 hover:text-[#0b1f3a]"
                              }`}
                            >
                              {speakingId === message.id ? (
                                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
                                  <rect x="4" y="3.5" width="3" height="9" rx="0.8" />
                                  <rect x="9" y="3.5" width="3" height="9" rx="0.8" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
                                  <path d="M2 6v4a1 1 0 0 0 1 1h2.2l3.3 2.6a.5.5 0 0 0 .8-.4V2.8a.5.5 0 0 0-.8-.4L5.2 5H3a1 1 0 0 0-1 1Zm10.6 2a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2Zm-2-5.9v1.4a5 5 0 0 1 0 9v1.4a6.5 6.5 0 0 0 0-11.8Z" />
                                </svg>
                              )}
                              {speakingId === message.id ? "Stop" : "Listen"}
                            </button>
                          )}
                          <span className="hidden text-[9.5px] uppercase tracking-wide text-slate-400 sm:inline">AI explanation</span>
                        </span>
                      </div>
                      <div className={`px-3.5 py-3 ${message.error ? "bg-rose-50/40" : ""}`} dir={language === "ur" ? "rtl" : "ltr"}>
                        {message.content ? (
                          <RichText text={message.content} />
                        ) : message.streaming ? (
                          <span className="flex items-center gap-1.5 py-1">
                            {[0, 1, 2].map((dot) => (
                              <span key={dot} className="typing-dot h-1.5 w-1.5 rounded-full bg-[#0072BC]" style={{ animationDelay: `${dot * 0.15}s` }} />
                            ))}
                            <span className="ml-1 text-[11.5px] text-slate-400">
                              {message.visionResult ? "Working…" : "Retrieving official sources…"}
                            </span>
                          </span>
                        ) : null}
                        {message.streaming && message.content && (
                          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#c8a24a] align-middle" />
                        )}
                        {(message.conflictWarnings?.length ?? 0) > 0 && (
                          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11.5px] text-rose-800">
                            <p className="font-semibold">Conflicting official sources detected</p>
                            {message.conflictWarnings?.map((warning) => (
                              <p key={warning}>{warning}</p>
                            ))}
                          </div>
                        )}
                        {message.scopeNote && <p className="mt-2 text-[10.5px] italic leading-relaxed text-slate-500">{message.scopeNote}</p>}
                        {message.showGallery && !message.visionResult && <GalleryStrip compact />}
                        <SourceList citations={message.citations ?? []} />
                        {(message.citations?.length ?? 0) > 0 && <AssistantMeta message={message} />}
                        {message.error && (
                          <button
                            type="button"
                            onClick={() => void send(lastQuestionRef.current)}
                            className="mt-2 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700"
                          >
                            Retry question
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
            {error && <p className="mb-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-[11.5px] text-rose-700">{error}</p>}
            {attachment && (
              <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-[#0072BC]/30 bg-[#f2f7fd] p-2">
                <img src={attachment.dataUrl} alt="attachment preview" className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-200" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px] font-semibold text-[#0b1f3a]">{attachment.name}</p>
                  <p className="text-[10px] text-slate-500">Attach it with your question, or send now to read it.</p>
                </div>
                <button type="button" onClick={() => setAttachment(null)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-white">
                  Remove
                </button>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send(input, attachment ?? undefined);
              }}
              className="flex items-end gap-1.5 sm:gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => void onAttachImage(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach a notice or document image"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 transition hover:border-[#0072BC] hover:text-[#0072BC]"
              >
                <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="currentColor" aria-hidden>
                  <path d="M3 4a2 2 0 0 1 2-2h7l5 5v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4Zm6.5 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM14 8.5A1.5 1.5 0 1 1 14 11.5 1.5 1.5 0 0 1 14 8.5Z" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <label htmlFor="question" className="sr-only">
                  Ask a question
                </label>
                <textarea
                  id="question"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send(input, attachment ?? undefined);
                    }
                  }}
                  rows={input.split("\n").length > 1 ? 3 : 1}
                  maxLength={1500}
                  placeholder={
                    language === "roman-ur"
                      ? "Sawal likhein ya mic dabayein… e.g. Karachi Campus ki BS AI fee kitni hai?"
                      : language === "ur"
                        ? "سوال لکھیں یا مائیک دبائیں…"
                        : "Type your question, or tap the mic to speak it…"
                  }
                  className="max-h-32 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[13px] leading-relaxed text-slate-800 shadow-inner outline-none transition focus:border-[#0072BC] focus:ring-2 focus:ring-[#0072BC]/10"
                  disabled={streaming}
                />
              </div>
              <button
                type="button"
                onClick={toggleListening}
                disabled={streaming}
                title={
                  recognitionSupported
                    ? listening
                      ? "Stop listening"
                      : "Ask by voice"
                    : "Voice input needs Chrome or Edge"
                }
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition disabled:opacity-40 ${
                  listening
                    ? "border-rose-500 bg-rose-500 text-white"
                    : recognitionSupported
                      ? "border-[#0072BC]/40 bg-[#f2f7fd] text-[#0072BC] hover:bg-[#0072BC] hover:text-white"
                      : "border-slate-200 bg-slate-50 text-slate-300"
                }`}
              >
                {listening && <span className="absolute inset-0 animate-ping rounded-xl bg-rose-400/40" />}
                <svg viewBox="0 0 20 20" className="relative h-4.5 w-4.5" fill="currentColor" aria-hidden>
                  <path d="M10 2a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm-5.5 7a5.5 5.5 0 0 0 4.5 5.4V16H7a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.6A5.5 5.5 0 0 0 15.5 9h-1.7a3.8 3.8 0 0 1-7.6 0H4.5Z" />
                </svg>
              </button>
              <button
                type="submit"
                disabled={streaming || (input.trim().length < 2 && !attachment)}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#0b1f3a] to-[#17375f] px-3.5 text-[12.5px] font-semibold text-white shadow transition hover:from-[#10345e] hover:to-[#1d4470] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {streaming ? "Thinking…" : attachment ? "Send image" : "Ask"}
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                  <path d="M2 10 18 3l-4 7 4 7-16-7Z" />
                </svg>
              </button>
            </form>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
              {listening ? (
                <span className="font-semibold text-rose-600">Listening — speak now, tap the mic to stop.</span>
              ) : (
                <>
                  Accuracy first: answers are generated from retrieved official text. Never treat an AI explanation as an
                  official confirmation of fees, deadlines or eligibility.
                </>
              )}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
