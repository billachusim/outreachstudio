// Shared enrichment helpers used by enrich-lead and campaign-tick.
// Extracts emails, phones, social handles, and an AI contact name
// from a Firecrawl scrape result.

const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

const EMAIL_BLOCKED_DOMAINS = [
  "example.com", "domain.com", "yourdomain.com", "email.com", "test.com",
  "sentry.io", "wixpress.com", "godaddy.com", "wordpress.com",
];

const EMAIL_PRIORITY = ["contact@", "hello@", "info@", "sales@", "support@", "team@"];

export function extractEmails(text: string): string[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const found = (text.match(re) ?? []).map((e) => e.toLowerCase());
  const unique = Array.from(new Set(found)).filter(
    (e) =>
      !EMAIL_BLOCKED_DOMAINS.some((b) => e.endsWith(`@${b}`)) &&
      !e.endsWith(".png") &&
      !e.endsWith(".jpg") &&
      !e.endsWith(".gif") &&
      !e.endsWith(".webp"),
  );
  unique.sort((a, b) => {
    const ap = EMAIL_PRIORITY.findIndex((p) => a.startsWith(p));
    const bp = EMAIL_PRIORITY.findIndex((p) => b.startsWith(p));
    return (ap === -1 ? 999 : ap) - (bp === -1 ? 999 : bp);
  });
  return unique;
}

// Pull plausible phone numbers — handles African formats like +234 803 ... or 0803-...
export function extractPhones(text: string): string[] {
  const re = /\+?\d[\d\s().-]{8,18}\d/g;
  const raw = text.match(re) ?? [];
  const cleaned = raw
    .map((p) => p.trim())
    .map((p) => p.replace(/\s+/g, " "))
    // strip if it's clearly a year/zip/SSN-like sequence
    .filter((p) => {
      const digits = p.replace(/\D/g, "");
      return digits.length >= 9 && digits.length <= 15;
    });
  return Array.from(new Set(cleaned));
}

export type SocialUrls = {
  linkedin_url?: string;
  instagram_url?: string;
  facebook_url?: string;
  x_url?: string;
};

export function extractSocials(links: string[]): SocialUrls {
  const result: SocialUrls = {};
  for (const link of links) {
    if (typeof link !== "string") continue;
    const l = link.toLowerCase();
    if (!result.linkedin_url && l.includes("linkedin.com/")) result.linkedin_url = link;
    else if (!result.instagram_url && l.includes("instagram.com/")) result.instagram_url = link;
    else if (!result.facebook_url && l.includes("facebook.com/")) result.facebook_url = link;
    else if (!result.x_url && (l.includes("twitter.com/") || l.includes("x.com/"))) result.x_url = link;
  }
  return result;
}

// Use the cheapest Lovable AI model to pull a likely contact name from scraped markdown.
// Returns null on any error or if AI says it can't find a name.
export async function extractContactName(
  apiKey: string,
  businessName: string,
  markdown: string,
): Promise<string | null> {
  if (!apiKey || !markdown || markdown.trim().length < 50) return null;
  try {
    const snippet = markdown.slice(0, 4000);
    const res = await fetch(LOVABLE_AI, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "Extract the founder/owner/CEO/primary contact person's full name from a website. Reply with only the name, or 'NONE' if no specific person is mentioned. No explanation.",
          },
          {
            role: "user",
            content: `Business: ${businessName}\n\nWebsite content:\n${snippet}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data?.choices?.[0]?.message?.content ?? "").trim();
    if (!raw || raw.toUpperCase().startsWith("NONE") || raw.length > 80 || raw.length < 3) return null;
    // strip quotes / trailing punctuation
    return raw.replace(/^["'`]+|["'`.!?,]+$/g, "").trim() || null;
  } catch {
    return null;
  }
}

// Build a final updates object for a lead from a Firecrawl scrape result.
export type EnrichmentResult = {
  contact_email?: string;
  phone?: string;
  contact_name?: string;
  enrichment_summary?: string;
  linkedin_url?: string;
  instagram_url?: string;
  facebook_url?: string;
  x_url?: string;
  last_enriched_at: string;
  notes?: string;
};

export async function buildEnrichmentUpdates(
  apiKey: string,
  lead: {
    business_name: string;
    contact_email?: string | null;
    phone?: string | null;
    contact_name?: string | null;
    notes?: string | null;
  },
  scrape: { markdown?: string; summary?: string; links?: string[] },
): Promise<EnrichmentResult> {
  const markdown = scrape.markdown ?? "";
  const summary = (scrape.summary ?? "").trim();
  const links = scrape.links ?? [];

  // Emails: mailto: + page text
  const mailtoEmails = links
    .filter((l) => typeof l === "string" && l.toLowerCase().startsWith("mailto:"))
    .map((l) => l.replace(/^mailto:/i, "").split("?")[0].toLowerCase());
  const emails = Array.from(new Set([...mailtoEmails, ...extractEmails(markdown)]));
  const bestEmail = emails[0] ?? null;

  // Phones
  const phones = extractPhones(markdown);
  const bestPhone = phones[0] ?? null;

  // Socials
  const socials = extractSocials(links);

  // Contact name via AI (only if we don't already have one)
  let contactName: string | null = null;
  if (!lead.contact_name) {
    contactName = await extractContactName(apiKey, lead.business_name, markdown);
  }

  const updates: EnrichmentResult = {
    last_enriched_at: new Date().toISOString(),
  };

  if (!lead.contact_email && bestEmail) updates.contact_email = bestEmail;
  if (!lead.phone && bestPhone) updates.phone = bestPhone;
  if (!lead.contact_name && contactName) updates.contact_name = contactName;
  if (summary) updates.enrichment_summary = summary;
  if (socials.linkedin_url) updates.linkedin_url = socials.linkedin_url;
  if (socials.instagram_url) updates.instagram_url = socials.instagram_url;
  if (socials.facebook_url) updates.facebook_url = socials.facebook_url;
  if (socials.x_url) updates.x_url = socials.x_url;

  // Append a brief note line about the enrichment, without duplicating the summary.
  const existingNotes = (lead.notes ?? "").trim();
  if (summary && !existingNotes.includes(summary.slice(0, 60))) {
    const block = `--- Enriched ${new Date().toISOString().slice(0, 10)} ---\n${summary}`;
    updates.notes = existingNotes ? `${existingNotes}\n\n${block}` : block;
  }

  return updates;
}

// Helpers for building region-aware Firecrawl search queries.
export type RegionContext = {
  region: string;
  countryCode: string; // lowercase 2-letter
};

export async function fetchUserRegion(
  supabase: any,
  userId: string,
): Promise<RegionContext> {
  const { data } = await supabase
    .from("profiles")
    .select("outreach_region, outreach_country_code")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    region: data?.outreach_region || "Nigeria",
    countryCode: (data?.outreach_country_code || "ng").toLowerCase(),
  };
}

export function buildRegionalQuery(baseQuery: string, region: RegionContext): string {
  // Bias both via TLD and quoted region name.
  return `${baseQuery} ("${region.region}" OR site:.${region.countryCode})`;
}

export function firecrawlLocationParam(region: RegionContext) {
  return { country: region.countryCode.toUpperCase(), languages: ["en"] };
}
