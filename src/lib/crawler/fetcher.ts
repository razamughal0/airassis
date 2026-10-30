import { CrawlerConfig } from "@/lib/config";
import { guardUrl, isTextLike, normalizeUrl } from "@/lib/security/url";
import { getRobotsRules, isPathAllowed } from "./robots";

export type FetchOutcome = {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: string | null;
  buffer: ArrayBuffer | null;
  lastModified: string | null;
  note: string;
  durationMs: number;
  blockedByRobots?: boolean;
};

const lastRequestAt = new Map<string, number>();

async function politeDelay(host: string, delayMs: number) {
  const last = lastRequestAt.get(host) ?? 0;
  const waitFor = last + delayMs - Date.now();
  if (waitFor > 0) await new Promise((resolve) => setTimeout(resolve, waitFor));
  lastRequestAt.set(host, Date.now());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single entry point for every outbound crawler request.
 * - URL allowlist + SSRF guard on each hop
 * - robots.txt enforcement
 * - per-host politeness delay
 * - manual redirect handling (max 5 hops, each hop revalidated)
 * - retries with exponential backoff on 429/5xx/network errors
 * - response size cap
 */
export async function fetchResource(url: string, config: CrawlerConfig, attempt = 0): Promise<FetchOutcome> {
  const startedAt = Date.now();
  const base: FetchOutcome = {
    url,
    finalUrl: url,
    status: 0,
    ok: false,
    contentType: "",
    body: null,
    buffer: null,
    lastModified: null,
    note: "",
    durationMs: 0,
  };

  const guard = await guardUrl(url, { allowedDomains: config.allowedDomains });
  if (!guard.ok) {
    return { ...base, note: `Blocked by URL safety guard: ${guard.reason}`, durationMs: Date.now() - startedAt };
  }

  let target = guard.url;
  const origin = new URL(target).origin;

  if (config.respectRobots) {
    const rules = await getRobotsRules(origin, config.userAgent, async (robotsUrl) => {
      try {
        const response = await fetch(robotsUrl, {
          headers: { "user-agent": config.userAgent },
          signal: AbortSignal.timeout(Math.min(config.timeoutMs, 8000)),
          cache: "no-store",
        });
        if (!response.ok) return { ok: false, note: `HTTP ${response.status}` };
        return { ok: true, body: (await response.text()).slice(0, 200_000), note: "ok" };
      } catch (error) {
        return { ok: false, note: error instanceof Error ? error.message : "robots fetch failed" };
      }
    });
    if (!isPathAllowed(rules, target)) {
      return {
        ...base,
        note: `Disallowed by robots.txt (${rules.note})`,
        blockedByRobots: true,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  try {
    let redirects = 0;
    let response: Response | null = null;
    while (redirects <= 5) {
      await politeDelay(new URL(target).hostname, config.requestDelayMs);
      response = await fetch(target, {
        redirect: "manual",
        headers: {
          "user-agent": config.userAgent,
          accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5",
        },
        signal: AbortSignal.timeout(config.timeoutMs),
        cache: "no-store",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = normalizeUrl(location, target);
        if (!next) return { ...base, status: response.status, note: "Unsafe redirect target" };
        const nextGuard = await guardUrl(next, { allowedDomains: config.allowedDomains });
        if (!nextGuard.ok) {
          return { ...base, status: response.status, note: `Redirect blocked: ${nextGuard.reason}` };
        }
        target = nextGuard.url;
        redirects += 1;
        continue;
      }
      break;
    }
    if (!response) return { ...base, note: "No response", durationMs: Date.now() - startedAt };

    const contentType = response.headers.get("content-type") ?? "";
    const lastModified = response.headers.get("last-modified");
    const lengthHeader = Number(response.headers.get("content-length") ?? "0");
    const maxBytes = config.maxDocumentMb * 1024 * 1024;

    if (response.status === 429 || response.status >= 500) {
      if (attempt < config.maxRetries) {
        await sleep(600 * 2 ** attempt);
        return fetchResource(target, config, attempt + 1);
      }
    }

    if (!response.ok) {
      return {
        ...base,
        finalUrl: target,
        status: response.status,
        contentType,
        lastModified,
        note: `HTTP ${response.status}${response.status === 403 ? " (host rejected automated client)" : ""}`,
        durationMs: Date.now() - startedAt,
      };
    }
    if (lengthHeader && lengthHeader > maxBytes) {
      return {
        ...base,
        finalUrl: target,
        status: response.status,
        contentType,
        note: `Skipped: declared size ${Math.round(lengthHeader / 1024)} KB exceeds limit`,
        durationMs: Date.now() - startedAt,
      };
    }

    if (isTextLike(contentType) || contentType.includes("pdf") || contentType.startsWith("image/")) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        return {
          ...base,
          finalUrl: target,
          status: response.status,
          contentType,
          note: `Skipped: response exceeds ${config.maxDocumentMb} MB limit`,
          durationMs: Date.now() - startedAt,
        };
      }
      const isText = isTextLike(contentType);
      return {
        ...base,
        finalUrl: target,
        status: response.status,
        ok: true,
        contentType,
        body: isText ? new TextDecoder("utf-8", { fatal: false }).decode(buffer) : null,
        buffer: isText ? null : buffer,
        lastModified,
        note: "ok",
        durationMs: Date.now() - startedAt,
      };
    }

    return {
      ...base,
      finalUrl: target,
      status: response.status,
      contentType,
      note: `Unsupported content type: ${contentType || "unknown"}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (attempt < config.maxRetries) {
      await sleep(500 * 2 ** attempt);
      return fetchResource(target, config, attempt + 1);
    }
    const message = error instanceof Error ? error.message : "network error";
    return {
      ...base,
      finalUrl: target,
      note: /timeout|abort/i.test(message) ? `Timeout after ${config.timeoutMs}ms` : `Network error: ${message}`,
      durationMs: Date.now() - startedAt,
    };
  }
}

export function resetPolitenessState() {
  lastRequestAt.clear();
}
