export type RobotsRules = {
  allow: string[];
  disallow: string[];
  crawlDelayMs: number | null;
  sitemaps: string[];
  fetched: boolean;
  note: string;
};

const EMPTY: RobotsRules = {
  allow: [],
  disallow: [],
  crawlDelayMs: null,
  sitemaps: [],
  fetched: false,
  note: "robots.txt not loaded",
};

const cache = new Map<string, { rules: RobotsRules; expires: number }>();

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay: number | null }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[]; delay: number | null } | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && value) current.disallow.push(value);
    if (key === "allow" && value) current.allow.push(value);
    if (key === "crawl-delay") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) current.delay = Math.max(0, parsed * 1000);
    }
  }

  const ua = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && ua.includes(agent)));
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const chosen = specific.length ? specific : wildcard;
  const rules: RobotsRules = {
    allow: chosen.flatMap((group) => group.allow),
    disallow: chosen.flatMap((group) => group.disallow),
    crawlDelayMs: chosen.find((group) => group.delay !== null)?.delay ?? null,
    sitemaps,
    fetched: true,
    note: `matched ${specific.length ? "specific" : wildcard.length ? "wildcard" : "no"} group`,
  };
  return rules;
}

export function isPathAllowed(rules: RobotsRules, url: string): boolean {
  if (!rules.fetched) return true;
  let pathname: string;
  try {
    const parsed = new URL(url);
    pathname = `${parsed.pathname}${parsed.search}`;
  } catch {
    return false;
  }
  const matches = (pattern: string) => {
    if (!pattern) return false;
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`);
    return regex.test(pathname);
  };
  const allowMatch = rules.allow.filter(matches).sort((a, b) => b.length - a.length)[0];
  const disallowMatch = rules.disallow.filter(matches).sort((a, b) => b.length - a.length)[0];
  if (!disallowMatch) return true;
  if (!allowMatch) return false;
  return allowMatch.length >= disallowMatch.length;
}

export async function getRobotsRules(
  origin: string,
  userAgent: string,
  fetcher: (url: string) => Promise<{ ok: boolean; body?: string; note: string }>,
): Promise<RobotsRules> {
  const cached = cache.get(origin);
  if (cached && cached.expires > Date.now()) return cached.rules;
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const result = await fetcher(robotsUrl);
  let rules: RobotsRules;
  if (!result.ok || !result.body) {
    rules = { ...EMPTY, note: `robots.txt unavailable (${result.note}); conservative defaults applied` };
  } else {
    rules = parseRobots(result.body, userAgent);
  }
  cache.set(origin, { rules, expires: Date.now() + 1000 * 60 * 30 });
  return rules;
}

export function clearRobotsCache() {
  cache.clear();
}
