// Firecrawl-powered lead enrichment: scrapes the lead's website,
// extracts a contact email + a 1-2 sentence business summary,
// and updates the lead record. Returns what was found.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

interface Body {
  leadId: string;
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Pull plausible emails from text. Filter common placeholder domains.
function extractEmails(text: string): string[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const found = (text.match(re) ?? []).map((e) => e.toLowerCase());
  const blocked = ["example.com", "domain.com", "yourdomain.com", "email.com", "test.com"];
  const unique = Array.from(new Set(found)).filter(
    (e) => !blocked.some((b) => e.endsWith(`@${b}`)) && !e.endsWith(".png") && !e.endsWith(".jpg"),
  );
  // Prefer info@/hello@/contact@/sales@ first
  const priority = ["contact@", "hello@", "info@", "sales@", "support@", "team@"];
  unique.sort((a, b) => {
    const ap = priority.findIndex((p) => a.startsWith(p));
    const bp = priority.findIndex((p) => b.startsWith(p));
    return (ap === -1 ? 999 : ap) - (bp === -1 ? 999 : bp);
  });
  return unique;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) return json(500, { error: "FIRECRAWL_API_KEY not configured" });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) return json(401, { error: "Unauthorized" });

    const { leadId } = (await req.json()) as Body;
    if (!leadId) return json(400, { error: "leadId required" });

    const { data: lead, error: lerr } = await supabase
      .from("leads")
      .select("id, business_name, website, contact_email, notes, status")
      .eq("id", leadId)
      .maybeSingle();
    if (lerr) return json(500, { error: lerr.message });
    if (!lead) return json(404, { error: "Lead not found" });
    if (!lead.website) return json(400, { error: "Lead has no website to enrich" });

    let url = lead.website.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Scrape: markdown for parsing emails + AI summary
    const scrapeRes = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "summary", "links"],
        onlyMainContent: false,
      }),
    });

    const scrapeJson = await scrapeRes.json();
    if (!scrapeRes.ok) {
      return json(scrapeRes.status, {
        error: `Firecrawl error: ${scrapeJson?.error ?? scrapeRes.statusText}`,
      });
    }

    // v2 returns fields either at top level or under data
    const payload = scrapeJson.data ?? scrapeJson;
    const markdown: string = payload.markdown ?? "";
    const summary: string = payload.summary ?? "";
    const links: string[] = payload.links ?? [];

    // Pull mailto: links too
    const mailtoEmails = links
      .filter((l) => l.toLowerCase().startsWith("mailto:"))
      .map((l) => l.replace(/^mailto:/i, "").split("?")[0].toLowerCase());

    const emails = Array.from(new Set([...mailtoEmails, ...extractEmails(markdown)]));
    const bestEmail = emails[0] ?? null;

    // Build update — don't overwrite existing email/notes; append summary
    const updates: Record<string, unknown> = {};
    if (!lead.contact_email && bestEmail) updates.contact_email = bestEmail;

    if (summary) {
      const summaryBlock = `--- Enriched ${new Date().toISOString().slice(0, 10)} ---\n${summary}`;
      const existing = (lead.notes ?? "").trim();
      // Avoid duplicate summary
      if (!existing.includes(summary.slice(0, 60))) {
        updates.notes = existing ? `${existing}\n\n${summaryBlock}` : summaryBlock;
      }
    }

    if (lead.status === "new") updates.status = "enriched";

    if (Object.keys(updates).length > 0) {
      const { error: upErr } = await supabase.from("leads").update(updates).eq("id", leadId);
      if (upErr) return json(500, { error: upErr.message });
    }

    return json(200, {
      leadId,
      email: bestEmail,
      emailsFound: emails,
      summary,
      updated: Object.keys(updates),
    });
  } catch (e) {
    console.error("enrich-lead error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
