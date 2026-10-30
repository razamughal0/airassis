import { promises as dns } from "node:dns";
import net from "node:net";

const TRACKING_PARAM_PREFIXES = ["utm_", "pk_", "mc_", "ga_"];
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "gclsrc", "dclid", "msclkid", "ref", "source"]);
const BLOCKED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "ico", "bmp", "tif", "tiff",
  "zip", "rar", "7z", "gz", "tar", "exe", "msi", "apk", "dmg", "iso",
  "mp4", "mp3", "avi", "mov", "wmv", "woff", "woff2", "ttf", "eot",
  "css", "js", "json", "xml", "rss",
]);
export const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

export function normalizeUrl(rawUrl: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(rawUrl, base) : new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  url.hash = "";

  const keptParams = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) continue;
    keptParams.append(key, value);
  }
  keptParams.sort();
  url.search = keptParams.toString();

  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname === "") url.pathname = "/";
  return url.toString();
}

/** Deduplication key: case-insensitive path + query, no fragment/trailing slash. */
export function urlKey(rawUrl: string): string {
  const normalized = normalizeUrl(rawUrl);
  const candidate = normalized ?? rawUrl;
  try {
    const url = new URL(candidate);
    const path = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    return `${url.hostname.replace(/^www\./, "")}${path}${url.search.toLowerCase()}`;
  } catch {
    return candidate.toLowerCase();
  }
}

export function extensionOf(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname;
    const match = /\.([a-zA-Z0-9]{1,5})$/.exec(pathname);
    return match ? match[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

export function isDocumentUrl(rawUrl: string): boolean {
  return DOCUMENT_EXTENSIONS.has(extensionOf(rawUrl));
}

export function isBlockedAsset(rawUrl: string): boolean {
  return BLOCKED_EXTENSIONS.has(extensionOf(rawUrl));
}

export function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Domain allowlist uses suffix matching with a dot boundary so that
 * "evilau.edu.pk" can never match "au.edu.pk".
 */
export function isAllowedDomain(rawUrl: string, allowedDomains: string[]): boolean {
  const host = hostOf(rawUrl);
  if (!host) return false;
  if (net.isIP(host)) return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return allowedDomains.some((domain) => {
    const clean = domain.toLowerCase().replace(/^\./, "");
    return host === clean || host.endsWith(`.${clean}`);
  });
}

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("fe80")) return true;
    if (normalized.startsWith("::ffff:")) {
      return isPrivateAddress(normalized.replace("::ffff:", ""));
    }
    return false;
  }
  return true;
}

export type UrlGuardOptions = {
  allowedDomains: string[];
  allowPrivateNetworks?: boolean;
};

export type UrlGuardResult = { ok: true; url: string } | { ok: false; reason: string };

/** SSRF-aware validation used before every outbound crawler request. */
export async function guardUrl(rawUrl: string, options: UrlGuardOptions): Promise<UrlGuardResult> {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return { ok: false, reason: "Invalid or unsupported URL scheme" };
  if (!isAllowedDomain(normalized, options.allowedDomains)) {
    return { ok: false, reason: "Host is not in the configured domain allowlist" };
  }
  const url = new URL(normalized);
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: "Non-standard port blocked" };
  }
  if (options.allowPrivateNetworks) return { ok: true, url: normalized };

  const host = url.hostname;
  if (net.isIP(host) || !host.includes(".")) {
    return { ok: false, reason: "IP literal or internal hostname blocked" };
  }
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) return { ok: false, reason: "Host did not resolve" };
    if (records.some((record) => isPrivateAddress(record.address))) {
      return { ok: false, reason: "Host resolves to a private/internal address" };
    }
  } catch {
    // DNS failure is handled by the fetcher (records a failed URL); we do not
    // allow the request to proceed with an unresolved host.
    return { ok: false, reason: "DNS resolution failed" };
  }
  return { ok: true, url: normalized };
}

export function isTextLike(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return (
    value.includes("text/html") ||
    value.includes("application/xhtml") ||
    value.includes("text/plain") ||
    value.includes("application/xml") ||
    value.includes("text/xml")
  );
}
