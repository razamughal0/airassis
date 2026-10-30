import * as cheerio from "cheerio";
import { isDocumentUrl, isBlockedAsset, normalizeUrl } from "@/lib/security/url";
import type { Campus, PageType } from "@/lib/config";

export type InferredCampus = Campus;

export type ParsedPage = {
  title: string;
  canonicalUrl: string;
  description: string;
  language: string;
  text: string;
  headings: string[];
  links: string[];
  documents: string[];
  images: { url: string; alt: string }[];
  lastModified: string | null;
  publicationDate: string | null;
  campus: Campus;
  pageType: PageType;
  relevance: number;
};

const BOILERPLATE_SELECTORS = [
  "script", "style", "noscript", "svg", "iframe", "form", "nav", "footer", "header", "aside",
  "button", "input", "select", "textarea",
  "[role=navigation]", "[role=banner]", "[role=contentinfo]", ".navbar", ".nav", ".menu",
  ".footer", ".header", ".sidebar", ".breadcrumb", ".breadcrumbs", ".cookie", ".cookies",
  ".social", ".advertisement", ".ads", ".carousel", ".slider", ".topbar", ".top-bar",
  "#navbar", "#footer", "#header", "#sidebar", "#menu",
].join(",");

const CAMPUS_BY_HOST: { match: RegExp; campus: Campus }[] = [
  { match: /^khi(portals)?\./i, campus: "karachi" },
  { match: /^kc(portals)?\./i, campus: "kharian" },
  { match: /^multan\./i, campus: "multan" },
  { match: /^kamra\./i, campus: "kamra" },
  { match: /^bahu\./i, campus: "bahu" },
  { match: /^webdata\./i, campus: "islamabad-main" },
  { match: /^portals\./i, campus: "university-wide" },
  { match: /^(www\.)?au\.edu\.pk$/i, campus: "university-wide" },
];

const PAGE_TYPE_RULES: { type: PageType; patterns: RegExp }[] = [
  { type: "fees", patterns: /fee|tuition|financial|charges|payment/i },
  { type: "eligibility", patterns: /eligibility|admission-criteria|requirement/i },
  { type: "scholarship", patterns: /scholar|financial-aid|grant|ehsaas|peef/i },
  { type: "documents", patterns: /required-document|documents/i },
  { type: "how-to-apply", patterns: /how.?to.?apply|apply|admission-process/i },
  { type: "programs", patterns: /program|facult|department|degree|bachelor|master/i },
  { type: "notices", patterns: /notice|advertis|announcement|news|merit-list|schedule/i },
  { type: "faq", patterns: /faq|frequently/i },
  { type: "contact", patterns: /contact|reach-us|address/i },
  { type: "admissions", patterns: /admission/i },
  { type: "campus-info", patterns: /campus|hostel|transport|library|facilit/i },
  { type: "about", patterns: /about|vision|mission|history/i },
];

const RELEVANT_URL_WORDS =
  /admission|fee|eligib|program|scholar|financial|apply|document|faq|notice|karachi|contact|hostel|transport|library|prospectus|merit|deadline|schedule|department|facult/i;

export function inferCampus(url: string): Campus {
  try {
    const host = new URL(url).hostname;
    const match = CAMPUS_BY_HOST.find((entry) => entry.match.test(host));
    return match?.campus ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function inferPageType(url: string, title = ""): PageType {
  const haystack = `${url} ${title}`;
  const match = PAGE_TYPE_RULES.find((rule) => rule.patterns.test(haystack));
  return match?.type ?? "general";
}

export function relevanceScore(url: string, title = ""): number {
  let score = 0;
  if (RELEVANT_URL_WORDS.test(url)) score += 0.6;
  if (RELEVANT_URL_WORDS.test(title)) score += 0.3;
  if (isDocumentUrl(url)) score += 0.1;
  if (/login|signin|signup|logout|register|cart|calendar|event/i.test(url)) score -= 0.5;
  return Math.max(-1, Math.min(1, score));
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, array) => line.length > 0 && line !== array[index - 1])
    .join("\n")
    .trim();
}

type DomNode = { type: string; name?: string; data?: string; children?: DomNode[] };

const HEADING_PREFIX: Record<string, string> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
  h4: "#### ",
  h5: "##### ",
  h6: "###### ",
};

function collectText(node: DomNode, out: string[]) {
  if (node.type === "text") {
    const value = (node.data ?? "").replace(/\s+/g, " ").trim();
    if (value) out.push(value);
    return;
  }
  if (node.type !== "tag" && node.type !== "root") {
    if (node.children) node.children.forEach((child) => collectText(child, out));
    return;
  }
  const name = (node.name ?? "").toLowerCase();
  if (HEADING_PREFIX[name]) {
    const inner: string[] = [];
    (node.children ?? []).forEach((child) => collectText(child, inner));
    const heading = inner.join(" ").trim();
    if (heading) out.push(`\n${HEADING_PREFIX[name]}${heading}`);
    return;
  }
  if (name === "li") {
    const inner: string[] = [];
    (node.children ?? []).forEach((child) => collectText(child, inner));
    const item = inner.join(" ").trim();
    if (item) out.push(`- ${item}`);
    return;
  }
  if (name === "tr") {
    const cells: string[] = [];
    for (const cell of node.children ?? []) {
      const cellName = (cell.name ?? "").toLowerCase();
      if (cellName !== "td" && cellName !== "th") continue;
      const inner: string[] = [];
      (cell.children ?? []).forEach((child) => collectText(child, inner));
      cells.push(inner.join(" ").replace(/\|/g, "/").trim());
    }
    if (cells.some(Boolean)) out.push(`| ${cells.join(" | ")} |`);
    return;
  }
  if (name === "table") {
    out.push("");
    for (const child of node.children ?? []) collectText(child, out);
    out.push("");
    return;
  }
  if (["p", "div", "section", "article", "blockquote", "dd", "dt", "figcaption"].includes(name)) {
    const inner: string[] = [];
    (node.children ?? []).forEach((child) => collectText(child, inner));
    const paragraph = inner.join(" ").replace(/\s+/g, " ").trim();
    if (paragraph) out.push(paragraph);
    return;
  }
  if (name === "br") {
    out.push("\n");
    return;
  }
  (node.children ?? []).forEach((child) => collectText(child, out));
}

export function parseHtml(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  $(BOILERPLATE_SELECTORS).remove();
  $("*").each((_, element) => {
    const attribs = (element as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    const marker = `${attribs.class ?? ""} ${attribs.id ?? ""}`.toLowerCase();
    if (/\b(nav|navbar|menu|footer|header|sidebar|breadcrumb|cookie|advert|advertisement|social|share)\b/.test(marker)) {
      $(element).remove();
      return false;
    }
    return undefined;
  });

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    new URL(pageUrl).pathname;

  const canonicalHref = $("link[rel='canonical']").attr("href");
  const canonicalUrl = (canonicalHref && normalizeUrl(canonicalHref, pageUrl)) || normalizeUrl(pageUrl) || pageUrl;
  const description = $("meta[name='description']").attr("content")?.trim() ?? "";
  const language = $("html").attr("lang") ?? "en";
  const lastModified =
    $("meta[property='article:modified_time']").attr("content") ??
    $("meta[name='last-modified']").attr("content") ??
    null;
  const publicationDate =
    $("meta[property='article:published_time']").attr("content") ??
    $("meta[name='date']").attr("content") ??
    null;

  const mainSelectors = ["main", "#main-content", "#content", ".main-content", "article", "#main", ".content"];
  const out: string[] = [];
  const bodyNode = $("body").get(0) as unknown as DomNode | undefined;
  let rootNode = bodyNode;
  for (const selector of mainSelectors) {
    const candidate = $(selector).first();
    if (candidate.length && candidate.text().trim().length > 600) {
      rootNode = (candidate.get(0) as unknown as DomNode | undefined) ?? rootNode;
      break;
    }
  }
  rootNode = rootNode ?? ($.root().get(0) as unknown as DomNode | undefined);
  if (rootNode) collectText(rootNode, out);
  const headings = $("h1,h2,h3,h4,h5,h6")
    .map((_, element) => $(element).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean)
    .slice(0, 40);

  let text = cleanText(out.join("\n"));
  if (text.replace(/\s/g, "").length < 120 && bodyNode) {
    // Short pages: re-walk the whole body structurally rather than flattening
    // it with .text(), which would destroy tables and headings.
    const full: string[] = [];
    collectText(bodyNode, full);
    text = cleanText(full.join("\n"));
  }
  // Keep the highest-signal leading content first but retain full page context.
  text = text.slice(0, 60_000);

  const links = new Set<string>();
  const documents = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const absolute = normalizeUrl(href, pageUrl);
    if (!absolute) return;
    if (isDocumentUrl(absolute)) documents.add(absolute);
    else if (!isBlockedAsset(absolute)) links.add(absolute);
  });

  const images: { url: string; alt: string }[] = [];
  $("img[src]").each((_, element) => {
    const src = $(element).attr("src");
    if (!src) return;
    const absolute = normalizeUrl(src, pageUrl);
    if (absolute) images.push({ url: absolute, alt: $(element).attr("alt") ?? "" });
  });

  const campus = inferCampus(pageUrl);
  return {
    title: title.replace(/\s+/g, " ").slice(0, 300),
    canonicalUrl,
    description,
    language,
    text,
    headings,
    links: Array.from(links).slice(0, 400),
    documents: Array.from(documents).slice(0, 120),
    images: images.slice(0, 40),
    lastModified,
    publicationDate,
    campus,
    pageType: inferPageType(pageUrl, title),
    relevance: relevanceScore(pageUrl, title),
  };
}
