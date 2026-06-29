// Shared Apify client for Outreach Studio.
// Runs an actor synchronously and returns dataset items.
// Uses run-sync-get-dataset-items so we don't need to poll.

const APIFY_BASE = "https://api.apify.com/v2";

export function getApifyToken(): string {
  const t = Deno.env.get("APIFY_API_TOKEN");
  if (!t) throw new Error("APIFY_API_TOKEN not configured");
  return t;
}

export interface ApifyRunOptions {
  /** Apify actor id, e.g. "apify/facebook-ads-scraper" — slash gets replaced with ~ internally. */
  actor: string;
  input: Record<string, unknown>;
  /** Server-side timeout in seconds; default 120. */
  timeoutSecs?: number;
  /** Hard limit on items pulled out of the dataset. */
  maxItems?: number;
}

export async function runApifyActor<T = any>(opts: ApifyRunOptions): Promise<T[]> {
  const token = getApifyToken();
  const actor = opts.actor.replace("/", "~");
  const timeout = opts.timeoutSecs ?? 120;
  const url = `${APIFY_BASE}/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${timeout}${
    opts.maxItems ? `&limit=${opts.maxItems}` : ""
  }`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.input ?? {}),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Apify ${actor} ${res.status}: ${txt.slice(0, 300)}`);
  }
  const items = await res.json().catch(() => []);
  return Array.isArray(items) ? items : [];
}

export function rootDomain(urlStr: string | null | undefined): string | null {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Standard host blocklist for ad-source landing pages (we want the advertiser's own site). */
export const AD_HOST_BLOCKLIST = new Set([
  "facebook.com", "instagram.com", "fb.com", "l.facebook.com",
  "linkedin.com", "lnkd.in",
  "youtube.com", "youtu.be", "tiktok.com", "x.com", "twitter.com",
  "google.com", "goo.gl", "maps.google.com",
  "bit.ly", "lnk.to", "rebrand.ly",
]);

export function isAdBlockedHost(host: string): boolean {
  if (AD_HOST_BLOCKLIST.has(host)) return true;
  for (const b of AD_HOST_BLOCKLIST) {
    if (host.endsWith(`.${b}`)) return true;
  }
  return false;
}
