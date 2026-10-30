import { describe, expect, it } from "vitest";
import {
  guardUrl,
  isAllowedDomain,
  isBlockedAsset,
  isDocumentUrl,
  isPrivateAddress,
  normalizeUrl,
  urlKey,
} from "@/lib/security/url";
import { isPathAllowed, parseRobots } from "@/lib/crawler/robots";

const ALLOWED = ["au.edu.pk", "khi.au.edu.pk", "khiportals.au.edu.pk"];

describe("URL normalization", () => {
  it("lowercases hosts, drops fragments and tracking params", () => {
    const normalized = normalizeUrl("HTTPS://KHI.AU.EDU.PK/Pages/Admission/fees_financial.aspx?utm_source=x&b=2&a=1#fees");
    expect(normalized).toBe("https://khi.au.edu.pk/Pages/Admission/fees_financial.aspx?a=1&b=2");
  });

  it("resolves relative links against the page URL", () => {
    expect(normalizeUrl("../Fee.aspx", "https://khi.au.edu.pk/Pages/Admission/how_to_apply.aspx")).toBe(
      "https://khi.au.edu.pk/Pages/Fee.aspx",
    );
  });

  it("rejects non-http schemes and embedded credentials", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("https://user:pass@khi.au.edu.pk/")).toBeNull();
  });

  it("produces the same dedupe key for case/trailing-slash variants", () => {
    expect(urlKey("https://au.edu.pk/Admission/Fee/")).toBe(urlKey("https://www.au.edu.pk/admission/fee"));
  });
});

describe("domain allowlist", () => {
  it("allows registered hosts and subdomains", () => {
    expect(isAllowedDomain("https://khi.au.edu.pk/Pages/Admission/fees_financial.aspx", ALLOWED)).toBe(true);
    expect(isAllowedDomain("https://khiportals.au.edu.pk/admissions", ALLOWED)).toBe(true);
  });

  it("does not allow lookalike or unrelated domains", () => {
    expect(isAllowedDomain("https://evilau.edu.pk/", ALLOWED)).toBe(false);
    expect(isAllowedDomain("https://au.edu.pk.evil.com/", ALLOWED)).toBe(false);
    expect(isAllowedDomain("https://pakadmissions.com/air-university", ALLOWED)).toBe(false);
    expect(isAllowedDomain("http://127.0.0.1/", ALLOWED)).toBe(false);
    expect(isAllowedDomain("http://localhost:3000/", ALLOWED)).toBe(false);
  });

  it("blocks internal network addresses (SSRF guard)", async () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.20.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    const blocked = await guardUrl("http://169.254.169.254/latest/meta-data/", { allowedDomains: ALLOWED });
    expect(blocked.ok).toBe(false);
  });

  it("classifies document and blocked asset extensions", () => {
    expect(isDocumentUrl("https://khi.au.edu.pk/files/prospectus.pdf")).toBe(true);
    expect(isBlockedAsset("https://khi.au.edu.pk/assets/logo.png")).toBe(true);
    expect(isDocumentUrl("https://khi.au.edu.pk/Pages/Admission/fees_financial.aspx")).toBe(false);
  });
});

describe("robots policy", () => {
  const wildcardRobots = `User-agent: *\nDisallow: /admin\nDisallow: /Pages/Private/\nAllow: /Pages/Private/public.aspx\nCrawl-delay: 2\nSitemap: https://khi.au.edu.pk/sitemap.xml\n`;
  const specificRobots = `User-agent: *\nDisallow: /\nCrawl-delay: 1\n\nUser-agent: KnowledgeBot\nDisallow: /private-for-bot\nCrawl-delay: 4\n`;

  it("parses sitemaps, crawl delay and wildcard groups", () => {
    const rules = parseRobots(wildcardRobots, "AU-KnowledgeBot/1.0");
    expect(rules.fetched).toBe(true);
    expect(rules.sitemaps).toEqual(["https://khi.au.edu.pk/sitemap.xml"]);
    expect(rules.crawlDelayMs).toBe(2000);
    expect(rules.disallow).toContain("/admin");
  });

  it("enforces disallow rules, including longest-match allow overrides", () => {
    const rules = parseRobots(wildcardRobots, "AU-KnowledgeBot/1.0");
    expect(isPathAllowed(rules, "https://khi.au.edu.pk/admin/panel")).toBe(false);
    expect(isPathAllowed(rules, "https://khi.au.edu.pk/Pages/Private/internal.aspx")).toBe(false);
    expect(isPathAllowed(rules, "https://khi.au.edu.pk/Pages/Private/public.aspx")).toBe(true);
    expect(isPathAllowed(rules, "https://khi.au.edu.pk/Pages/Admission/fees_financial.aspx")).toBe(true);
  });

  it("prefers a specific user-agent group over the wildcard group", () => {
    const rules = parseRobots(specificRobots, "AU-KnowledgeBot/1.0");
    expect(rules.crawlDelayMs).toBe(4000);
    expect(isPathAllowed(rules, "https://khi.au.edu.pk/Pages/Admission/fees_financial.aspx")).toBe(true);
    expect(isPathAllowed(rules, "https://khi.au.edu.pk/private-for-bot/page")).toBe(false);
  });

  it("permits paths when robots.txt was unavailable, with a recorded note", () => {
    const rules = parseRobots("", "AU-KnowledgeBot/1.0");
    expect(rules.fetched).toBe(true);
    expect(isPathAllowed(rules, "https://khi.au.edu.pk/anything")).toBe(true);
  });
});
