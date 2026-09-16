// Discovers U.S. pet-sitting businesses for the Pet Care Card partner campaign.
//
// Strategy: Firecrawl web search per city (public business sites + public
// directory listings), then a light scrape of each site to pull a PUBLIC
// business email/phone, services and intake signals. Scores 1-100 and inserts
// deduped leads (by root domain) straight onto the campaign.
//
// Only public, professional business info is collected. Aggregator/platform
// hosts are skipped so we reach the real business site.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const DEFAULT_CITIES: Array<{ city: string; state: string }> = [
  { city: "New York", state: "NY" },
  { city: "Los Angeles", state: "CA" },
  { city: "Chicago", state: "IL" },
  { city: "Houston", state: "TX" },
  { city: "Phoenix", state: "AZ" },
  { city: "Philadelphia", state: "PA" },
  { city: "San Antonio", state: "TX" },
  { city: "San Diego", state: "CA" },
  { city: "Dallas", state: "TX" },
  { city: "Austin", state: "TX" },
  { city: "Miami", state: "FL" },
  { city: "Denver", state: "CO" },
  { city: "Seattle", state: "WA" },
  { city: "Atlanta", state: "GA" },
  { city: "Boston", state: "MA" },
  { city: "Portland", state: "OR" },
  { city: "Nashville", state: "TN" },
  { city: "Charlotte", state: "NC" },
  { city: "Minneapolis", state: "MN" },
  { city: "Raleigh", state: "NC" },
  { city: "Tampa", state: "FL" },
  { city: "Sacramento", state: "CA" },
  { city: "Columbus", state: "OH" },
  { city: "Kansas City", state: "MO" },
  { city: "Salt Lake City", state: "UT" },
];

// Platforms/aggregators: useful to *search*, never to store as the business.
const HOST_BLOCKLIST = [
  "rover.com", "wag.com", "wagwalking.com", "care.com", "sittercity.com",
  "petsitters.org", "petsit.com", "yelp.com", "thumbtack.com", "angi.com",
  "nextdoor.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "tiktok.com", "youtube.com", "pinterest.com", "reddit.com",
  "quora.com", "wikipedia.org", "yellowpages.com", "bbb.org", "mapquest.com",
  "google.com", "maps.google.com", "bing.com", "duckduckgo.com", "amazon.com",
  "tripadvisor.com", "indeed.com", "ziprecruiter.com", "glassdoor.com",
  "medium.com", "substack.com", "eventbrite.com", "groupon.com", "chewy.com",
  "petco.com", "petsmart.com", "akc.org", "avma.org", "aspca.org",
  "petbacker.com", "vetster.com", "zippia.com", "ed2go.com", "petcareins.com",
  "petsitllc.com", "petsitterplus.com", "timetopet.com", "precisepetcare.com",
  "simplyfortheanimals.com", "udemy.com", "coursera.org", "salary.com",
  "payscale.com", "expertise.com", "bark.com", "porch.com", "homeguide.com",
];

const NON_US_TLDS = [".ng", ".uk", ".co.uk", ".ca", ".au", ".in", ".de", ".fr", ".nl", ".ie", ".nz", ".za", ".ph", ".sg"];

const GENERIC_EMAIL_PREFIXES = ["info", "hello", "contact", "office", "admin", "bookings", "book", "care", "support", "team", "sales", "inquiries", "pets"];

function rootDomain(urlStr: string): string | null {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHost(host: string): boolean {
  return HOST_BLOCKLIST.some((b) => host === b || host.endsWith(`.${b}`));
}

function looksNonUs(host: string): boolean {
  return NON_US_TLDS.some((t) => host.endsWith(t));
}

const GENERIC_TITLES = ["home", "about", "about us", "services", "our services", "welcome", "contact", "contact us", "commission", "pet care", "pet sitting", "index", "blog", "faq", "rates", "pricing", "reviews", "team"];

// Article / directory / jobs pages masquerading as businesses.
const NON_BUSINESS_PATTERNS = [
  /\bjobs?\b/i, /\bhiring\b/i, /\bcareers?\b/i, /\bsalary\b/i, /\bapply now\b/i,
  /\bideas\b/i, /\bhow to\b/i, /\bguide\b/i, /\bblog\b/i, /\bnews\b/i,
  /\btips\b/i, /\bchecklist\b/i, /\btemplate\b/i, /\bvs\.?\b/i,
  /\b(?:top|best|cheapest)\s+\d+/i, /^\d+\s/, /\bdirectory\b/i, /\blisting/i,
  /\bfind (?:a|the)\b/i, /\bnear me\b/i, /\bcost(?:s)?\b/i, /\bwhat is\b/i,
  /\bcourse\b/i, /\bcertification\b/i, /\bassociation\b/i, /\binsurance\b/i,
  /\bsoftware\b/i, /\bapp\b/i, /\bfranchise\b/i, /\bmarketplace\b/i,
];

const NON_BUSINESS_URL_PATTERNS = [/\/blog\//i, /\/jobs?\//i, /\/careers?\//i, /\/articles?\//i, /\/news\//i, /\/guides?\//i, /\/directory\//i, /\/search\b/i, /\/tag\//i, /\/category\//i];

function nameFromHost(host: string): string {
  return host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveBusinessName(title: string, host: string): string {
  const clean = (title || "").split(/[|·•\-–—:]/)[0].trim();
  if (clean.length > 2 && clean.length < 60 && !GENERIC_TITLES.includes(clean.toLowerCase())) return clean;
  return nameFromHost(host);
}

function pickEmail(text: string, host: string): string | null {
  const found = Array.from(
    text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g),
  ).map((m) => m[0].toLowerCase());
  const clean = found.filter(
    (e) =>
      !/\.(png|jpe?g|gif|webp|svg)$/.test(e) &&
      !e.includes("example.") &&
      !e.includes("sentry") &&
      !e.includes("wixpress") &&
      !e.includes("squarespace") &&
      !e.includes("godaddy") &&
      !e.includes("wordpress"),
  );
  if (clean.length === 0) return null;
  const bareHost = host.replace(/^www\./, "");
  const onDomain = clean.filter((e) => e.endsWith(`@${bareHost}`));
  const pool = onDomain.length ? onDomain : clean;
  const generic = pool.find((e) => GENERIC_EMAIL_PREFIXES.some((p) => e.startsWith(`${p}@`)));
  return generic ?? pool[0];
}

function pickPhone(text: string): string | null {
  const m = text.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return m ? m[0].trim() : null;
}

function pickSocial(text: string, kind: "instagram" | "facebook"): string | null {
  const re = kind === "instagram"
    ? /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+/
    : /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.\-\/]+/;
  const m = text.match(re);
  return m ? m[0] : null;
}

const SERVICE_TERMS: Array<[string, string]> = [
  ["pet sitting", "Pet sitting"],
  ["pet sitter", "Pet sitting"],
  ["house sitting", "House sitting"],
  ["overnight", "Overnight stays"],
  ["dog walking", "Dog walking"],
  ["dog walker", "Dog walking"],
  ["boarding", "Boarding"],
  ["daycare", "Daycare"],
  ["drop-in", "Drop-in visits"],
  ["drop in visit", "Drop-in visits"],
  ["cat sitting", "Cat sitting"],
  ["grooming", "Grooming"],
];

const INTAKE_TERMS = ["intake", "care instructions", "medication", "meds", "special needs", "feeding schedule", "vet information", "emergency contact", "new client form", "profile form", "questionnaire", "consultation"];
const RECURRING_TERMS = ["recurring", "weekly", "regular clients", "daily walks", "package", "subscription", "repeat clients"];
const TEAM_TERMS = ["our team", "our sitters", "meet the team", "our staff", "insured and bonded", "background check"];

function scoreLead(input: {
  text: string;
  email: string | null;
  phone: string | null;
  services: string[];
  usSignal: boolean;
}): { score: number; reasons: string[] } {
  const t = input.text.toLowerCase();
  let s = 20;
  const reasons: string[] = [];

  if (input.usSignal) { s += 12; reasons.push("U.S. business signals on site"); }
  if (input.services.length >= 1) { s += 10; reasons.push(`Offers ${input.services.slice(0, 3).join(", ").toLowerCase()}`); }
  if (input.services.length >= 3) { s += 8; reasons.push("Multiple pet-care services"); }
  if (input.email) s += 18;
  if (input.phone) s += 6;

  const intakeHits = INTAKE_TERMS.filter((k) => t.includes(k));
  if (intakeHits.length) {
    s += Math.min(16, 6 * intakeHits.length);
    reasons.push(`Collects detailed pet info (${intakeHits.slice(0, 3).join(", ")}) — exactly what a care card replaces`);
  }
  if (RECURRING_TERMS.some((k) => t.includes(k))) { s += 8; reasons.push("Recurring / repeat clients"); }
  if (TEAM_TERMS.some((k) => t.includes(k))) { s += 8; reasons.push("Small team of sitters"); }
  if (t.includes("book now") || t.includes("client portal") || t.includes("request service")) { s += 4; reasons.push("Active booking flow"); }

  return { score: Math.max(1, Math.min(100, s)), reasons };
}

interface Body {
  campaignId?: string;
  userId?: string;
  cities?: Array<{ city: string; state: string }>;
  cityCount?: number;
  perCity?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) return json(500, { error: "Firecrawl is not connected." });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    // Service-role client so the scheduled campaign engine can call this too.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => ({}))) as Body;

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: authData } = await supabase.auth.getUser(token);
    const userId = authData?.user?.id ?? body.userId ?? null;
    if (!userId) return json(401, { error: "Unauthorized" });
    const user = { id: userId };

    // Resolve the Pet Care Card campaign
    let campaignId = body.campaignId ?? null;
    if (!campaignId) {
      const { data: camp } = await supabase
        .from("campaigns")
        .select("id")
        .eq("user_id", user.id)
        .eq("mode", "partner_acquisition")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      campaignId = camp?.id ?? null;
    }
    if (!campaignId) return json(400, { error: "No Pet Care Card campaign found." });

    // Bounded work per run
    const perCity = Math.min(Math.max(body.perCity ?? 6, 1), 10);
    const cityCount = Math.min(Math.max(body.cityCount ?? 3, 1), 6);

    // Rotate cities: prefer ones we have the fewest leads from
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("website, root_domain, city, contact_email")
      .eq("user_id", user.id);
    const existingHosts = new Set<string>();
    const cityCounts = new Map<string, number>();
    for (const l of existingLeads ?? []) {
      const h = l.root_domain ?? (l.website ? rootDomain(l.website) : null);
      if (h) existingHosts.add(h);
      if (l.city) cityCounts.set(l.city, (cityCounts.get(l.city) ?? 0) + 1);
    }

    const pool = body.cities?.length ? body.cities : DEFAULT_CITIES;
    const targets = [...pool]
      .sort((a, b) => (cityCounts.get(a.city) ?? 0) - (cityCounts.get(b.city) ?? 0))
      .slice(0, cityCount);

    const inserted: Array<{ business_name: string; city: string; score: number; email: string | null }> = [];
    const skipped: string[] = [];
    const seen = new Set<string>();

    for (const target of targets) {
      const query = `independent pet sitting business "${target.city}" ${target.state} pet sitter dog walking house sitting -site:rover.com -site:care.com -site:yelp.com`;

      const searchRes = await fetch(`${FIRECRAWL_V2}/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: perCity * 2, location: "United States" }),
      });
      if (!searchRes.ok) {
        const t = await searchRes.text();
        console.error(`Firecrawl search ${searchRes.status}: ${t}`);
        continue;
      }
      const sj = await searchRes.json();
      const raw = sj.data;
      const items: Array<{ url: string; title?: string; description?: string }> =
        Array.isArray(raw) ? raw : (raw?.web ?? []);

      let addedForCity = 0;
      for (const item of items) {
        if (addedForCity >= perCity) break;
        if (!item.url) continue;
        const host = rootDomain(item.url);
        if (!host || isBlockedHost(host) || looksNonUs(host)) { skipped.push(host ?? item.url); continue; }
        if (existingHosts.has(host) || seen.has(host)) { skipped.push(host); continue; }

        // Reject articles, job posts, directories and listicles — we want real businesses.
        const titleStr = item.title ?? "";
        if (NON_BUSINESS_PATTERNS.some((re) => re.test(titleStr))) { skipped.push(`${host} (article/jobs page)`); continue; }
        if (NON_BUSINESS_URL_PATTERNS.some((re) => re.test(item.url))) { skipped.push(`${host} (not a business page)`); continue; }
        seen.add(host);

        // Light scrape of the business site for public contact + service info
        let pageText = `${item.title ?? ""} ${item.description ?? ""}`;
        try {
          const scrapeRes = await fetch(`${FIRECRAWL_V2}/scrape`, {
            method: "POST",
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: `https://${host}`, formats: ["markdown"], onlyMainContent: false, timeout: 20000 }),
          });
          if (scrapeRes.ok) {
            const scj = await scrapeRes.json();
            const md = scj?.data?.markdown ?? "";
            if (md) pageText = `${pageText}\n${md}`.slice(0, 40000);
          }
        } catch (e) {
          console.error(`scrape failed for ${host}`, e);
        }

        const lower = pageText.toLowerCase();

        // Must actually be pet care
        const services = Array.from(
          new Set(SERVICE_TERMS.filter(([k]) => lower.includes(k)).map(([, label]) => label)),
        );
        if (services.length === 0) { skipped.push(`${host} (not pet care)`); continue; }

        // U.S. signal: state abbrev/name, US phone format, or .com/.us with city mention
        const usSignal =
          new RegExp(`\\b${target.state}\\b`).test(pageText) ||
          lower.includes(target.city.toLowerCase()) ||
          /\b\d{5}(-\d{4})?\b/.test(pageText);
        if (!usSignal) { skipped.push(`${host} (no US signal)`); continue; }

        const email = pickEmail(pageText, host);
        const phone = pickPhone(pageText);
        const { score, reasons } = scoreLead({ text: pageText, email, phone, services, usSignal });

        const business_name = deriveBusinessName(item.title ?? host, host);
        const relevance = reasons.length
          ? `Pet Care Card fit: ${reasons.join("; ")}.`
          : "Pet Care Card fit: pet-care business that takes care instructions from owners.";

        const { error: insErr } = await supabase.from("leads").insert({
          user_id: user.id,
          campaign_id: campaignId,
          business_name,
          website: `https://${host}`,
          contact_email: email,
          phone,
          city: target.city,
          state: target.state,
          country: "United States",
          services: services.join(", "),
          relevance_reason: relevance,
          source_url: item.url,
          instagram_url: pickSocial(pageText, "instagram"),
          facebook_url: pickSocial(pageText, "facebook"),
          notes: item.description ?? null,
          enrichment_summary: `${business_name} — ${target.city}, ${target.state}. Services: ${services.join(", ")}. ${relevance}`,
          last_enriched_at: new Date().toISOString(),
          // Ready for drafting when we have a public business email
          status: email ? "enriched" : "new",
          score,
        });
        if (insErr) {
          console.error("insert lead failed", insErr.message);
          continue;
        }
        existingHosts.add(host);
        addedForCity++;
        inserted.push({ business_name, city: target.city, score, email });
      }
    }

    return json(200, {
      ok: true,
      cities: targets.map((t) => `${t.city}, ${t.state}`),
      inserted: inserted.length,
      withEmail: inserted.filter((i) => i.email).length,
      skipped: skipped.length,
      leads: inserted,
    });
  } catch (e) {
    console.error("discover-pet-sitters error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
